import protobuf from 'protobufjs';
import fs from 'fs';
import path from 'path';

const PROTO_DEF = `
syntax = "proto2";
package transit_realtime;
message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
message FeedHeader { required string gtfs_realtime_version = 1; optional uint64 timestamp = 3; }
message FeedEntity { required string id = 1; optional VehiclePosition vehicle = 4; optional TripUpdate trip_update = 3; optional Alert alert = 5; }
message TripUpdate { optional TripDescriptor trip = 1; repeated StopTimeUpdate stop_time_update = 2; optional VehicleDescriptor vehicle = 3; optional uint64 timestamp = 4; optional int32 delay = 5;
  message StopTimeUpdate { optional uint32 stop_sequence = 1; optional StopTimeEvent arrival = 2; optional StopTimeEvent departure = 3; optional string stop_id = 4; optional int32 schedule_relationship = 5; } }
message StopTimeEvent { optional int32 delay = 1; optional int64 time = 2; optional int32 uncertainty = 3; }
message VehiclePosition { optional TripDescriptor trip = 1; optional Position position = 2; optional uint32 current_stop_sequence = 3; optional int32 current_status = 4; optional uint64 timestamp = 5; optional string stop_id = 7; optional VehicleDescriptor vehicle = 8; optional int32 occupancy_status = 9; }
message Position { required float latitude = 1; required float longitude = 2; optional float bearing = 3; optional float speed = 5; }
message TripDescriptor { optional string trip_id = 1; optional string route_id = 5; optional uint32 direction_id = 6; optional string start_time = 2; optional string start_date = 3; optional int32 schedule_relationship = 4; }
message VehicleDescriptor { optional string id = 1; optional string label = 2; optional string license_plate = 3; }
message Alert { repeated TimeRange active_period = 1; repeated EntitySelector informed_entity = 5; optional int32 cause = 6; optional int32 effect = 7; optional TranslatedString header_text = 10; optional TranslatedString description_text = 11; }
message TimeRange { optional uint64 start = 1; optional uint64 end = 2; }
message EntitySelector { optional string agency_id = 1; optional string route_id = 2; optional int32 route_type = 3; optional TripDescriptor trip = 4; optional string stop_id = 5; }
message TranslatedString { repeated Translation translation = 1; message Translation { required string text = 1; optional string language = 2; } }
`;

let cachedRoot = null;
function getRoot() {
  if (!cachedRoot) cachedRoot = protobuf.parse(PROTO_DEF, { keepCase: false }).root;
  return cachedRoot;
}

const FEED_URLS = {
  vehicles_A: 'https://gtfs.ztp.krakow.pl/VehiclePositions_A.pb',
  vehicles_T: 'https://gtfs.ztp.krakow.pl/VehiclePositions_T.pb',
  vehicles_M: 'https://gtfs.ztp.krakow.pl/VehiclePositions_M.pb',
  trips_A: 'https://gtfs.ztp.krakow.pl/TripUpdates_A.pb',
  trips_T: 'https://gtfs.ztp.krakow.pl/TripUpdates_T.pb',
  trips_M: 'https://gtfs.ztp.krakow.pl/TripUpdates_M.pb',
  alerts_A: 'https://gtfs.ztp.krakow.pl/ServiceAlerts_A.pb',
  alerts_T: 'https://gtfs.ztp.krakow.pl/ServiceAlerts_T.pb',
  alerts_M: 'https://gtfs.ztp.krakow.pl/ServiceAlerts_M.pb',
};

// Load schedule data for delay computation
let tripsCache = {};
let stCache = {};

function loadTrips(type) {
  if (tripsCache[type]) return tripsCache[type];
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'public', 'data', `trips_${type}.json`), 'utf8');
    tripsCache[type] = JSON.parse(raw);
  } catch { tripsCache[type] = {}; }
  return tripsCache[type];
}

function loadStopTimes(type, route) {
  const key = `${type}_${route}`;
  if (stCache[key]) return stCache[key];
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'st', `${key}.json`), 'utf8');
    stCache[key] = JSON.parse(raw);
  } catch { stCache[key] = {}; }
  return stCache[key];
}

function getMidnightCET() {
  // CET = UTC+1, CEST = UTC+2 (from last Sunday of March to last Sunday of October)
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const stdOff = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDST = now.getTimezoneOffset() < stdOff;
  // Just use UTC+1 for CET, UTC+2 for CEST
  const offset = 1; // Kraków is CET/CEST, but server may be UTC
  const cetNow = new Date(now.getTime() + offset * 3600000);
  const midnight = new Date(cetNow);
  midnight.setUTCHours(0, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000) - offset * 3600;
}

// Compute delay for a TripUpdate entity
function computeDelay(entity, type) {
  const tu = entity.tripUpdate;
  if (!tu) return null;

  // If explicit delay field is non-zero, use it
  if (tu.delay && tu.delay !== 0) return tu.delay;

  // Check stop_time_updates for explicit delays
  const stus = tu.stopTimeUpdate || [];
  for (const stu of stus) {
    const d = stu.arrival?.delay || stu.departure?.delay;
    if (d && d !== 0) return d;
  }

  // Compute from absolute arrival times vs schedule
  const tripId = tu.trip?.tripId;
  if (!tripId || !stus.length) return null;

  const trips = loadTrips(type);
  const ti = trips[tripId];
  if (!ti) return null;

  const routeName = ti[0];
  const stData = loadStopTimes(type, routeName);
  const tripStops = stData[tripId];
  if (!tripStops) return null;

  // Build schedule lookup: stop_id -> scheduled seconds since midnight
  const schedMap = {};
  for (const s of tripStops) {
    schedMap[s[0]] = s[1]; // s = [stop_id, arrival_sec, sequence]
  }

  const midnightTs = getMidnightCET();
  let totalDelay = 0;
  let count = 0;

  for (const stu of stus) {
    const stopId = stu.stopId;
    const predTime = stu.arrival?.time || stu.departure?.time;
    if (!predTime || !stopId) continue;

    const schedSec = schedMap[stopId];
    if (schedSec == null) continue;

    const predSec = predTime - midnightTs; // predicted seconds since midnight
    const delay = predSec - schedSec;

    // Sanity check: delay should be between -30min and +60min
    if (delay > -1800 && delay < 3600) {
      totalDelay += delay;
      count++;
    }
  }

  return count > 0 ? Math.round(totalDelay / count) : null;
}

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const feed = searchParams.get('feed');

  if (!feed || !FEED_URLS[feed]) {
    return Response.json({ error: 'Invalid feed. Valid: ' + Object.keys(FEED_URLS).join(', ') }, { status: 400 });
  }

  try {
    const res = await fetch(FEED_URLS[feed], {
      headers: { 'User-Agent': 'KrakowGPS/2.0' },
      cache: 'no-store',
    });

    if (!res.ok) {
      return Response.json({ error: `Upstream: ${res.status}` }, { status: 502 });
    }

    const buffer = await res.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    const root = getRoot();
    const FeedMessage = root.lookupType('transit_realtime.FeedMessage');
    const message = FeedMessage.decode(uint8);
    const obj = FeedMessage.toObject(message, { longs: Number, enums: Number, defaults: true });

    // For trip updates: compute delays from absolute timestamps
    if (feed.startsWith('trips_')) {
      const type = feed.split('_')[1]; // A, T, or M
      if (obj.entity) {
        for (const entity of obj.entity) {
          if (entity.tripUpdate) {
            const computed = computeDelay(entity, type);
            if (computed !== null) {
              entity.tripUpdate._computedDelay = computed;
            }
          }
        }
      }
    }

    return Response.json(obj, {
      headers: {
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=5',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('GTFS-RT proxy error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
