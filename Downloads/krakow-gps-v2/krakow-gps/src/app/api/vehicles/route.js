import protobuf from 'protobufjs';
import fs from 'fs';
import path from 'path';

const PROTO_DEF = `
syntax = "proto2";
package transit_realtime;
message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
message FeedHeader { required string gtfs_realtime_version = 1; optional uint64 timestamp = 3; }
message FeedEntity { required string id = 1; optional VehiclePosition vehicle = 4; optional TripUpdate trip_update = 3; }
message TripUpdate { optional TripDescriptor trip = 1; repeated StopTimeUpdate stop_time_update = 2; optional int32 delay = 5;
  message StopTimeUpdate { optional uint32 stop_sequence = 1; optional StopTimeEvent arrival = 2; optional StopTimeEvent departure = 3; optional string stop_id = 4; } }
message StopTimeEvent { optional int32 delay = 1; optional int64 time = 2; }
message VehiclePosition { optional TripDescriptor trip = 1; optional Position position = 2; optional uint32 current_stop_sequence = 3; optional int32 current_status = 4; optional uint64 timestamp = 5; optional string stop_id = 7; optional VehicleDescriptor vehicle = 8; optional int32 occupancy_status = 9; }
message Position { required float latitude = 1; required float longitude = 2; optional float bearing = 3; optional float speed = 5; }
message TripDescriptor { optional string trip_id = 1; optional string route_id = 5; optional uint32 direction_id = 6; }
message VehicleDescriptor { optional string id = 1; optional string label = 2; optional string license_plate = 3; }
`;

let cachedRoot = null;
function getRoot() {
  if (!cachedRoot) cachedRoot = protobuf.parse(PROTO_DEF, { keepCase: false }).root;
  return cachedRoot;
}

// Load static trip data
let tripsCache = null;
function getTrips() {
  if (!tripsCache) {
    tripsCache = {};
    for (const t of ['A', 'T', 'M']) {
      try {
        const raw = fs.readFileSync(path.join(process.cwd(), 'public', 'data', `trips_${t}.json`), 'utf8');
        tripsCache[t] = JSON.parse(raw);
      } catch { tripsCache[t] = {}; }
    }
  }
  return tripsCache;
}

let blocksCache = null;
function getBlocks() {
  if (!blocksCache) {
    try {
      blocksCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'blocks.json'), 'utf8'));
    } catch { blocksCache = {}; }
  }
  return blocksCache;
}

let stopsCache = null;
function getStops() {
  if (!stopsCache) {
    try {
      stopsCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'stops.json'), 'utf8'));
    } catch { stopsCache = {}; }
  }
  return stopsCache;
}

const STATUS_MAP = { 0: 'INCOMING_AT', 1: 'STOPPED_AT', 2: 'IN_TRANSIT_TO' };

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get('type'); // A, T, M or null for all
  const routeFilter = searchParams.get('route'); // route short name

  const types = typeFilter ? [typeFilter] : ['A', 'T', 'M'];
  const trips = getTrips();
  const blocks = getBlocks();
  const stops = getStops();
  const root = getRoot();
  const FeedMessage = root.lookupType('transit_realtime.FeedMessage');

  try {
    // Fetch vehicles and trip updates in parallel
    const [vResults, tResults] = await Promise.all([
      Promise.all(types.map(t =>
        fetch(`https://gtfs.ztp.krakow.pl/VehiclePositions_${t}.pb`, {
          headers: { 'User-Agent': 'KrakowGPS/1.0' }, cache: 'no-store',
        }).then(r => r.arrayBuffer()).then(buf => {
          const msg = FeedMessage.decode(new Uint8Array(buf));
          return { type: t, entities: FeedMessage.toObject(msg, { longs: Number, defaults: true }).entity || [] };
        }).catch(() => ({ type: t, entities: [] }))
      )),
      Promise.all(types.map(t =>
        fetch(`https://gtfs.ztp.krakow.pl/TripUpdates_${t}.pb`, {
          headers: { 'User-Agent': 'KrakowGPS/1.0' }, cache: 'no-store',
        }).then(r => r.arrayBuffer()).then(buf => {
          const msg = FeedMessage.decode(new Uint8Array(buf));
          return { type: t, entities: FeedMessage.toObject(msg, { longs: Number, defaults: true }).entity || [] };
        }).catch(() => ({ type: t, entities: [] }))
      )),
    ]);

    // Build delay map
    const delays = {};
    tResults.forEach(({ type, entities }) => {
      entities.forEach(e => {
        if (!e.tripUpdate) return;
        const tid = e.tripUpdate.trip?.tripId || e.id;
        let delay = e.tripUpdate.delay;
        if (delay == null) {
          const stu = e.tripUpdate.stopTimeUpdate;
          if (stu?.length) {
            const last = stu[stu.length - 1];
            delay = last.arrival?.delay || last.departure?.delay || 0;
          }
        }
        delays[`${type}:${tid}`] = delay || 0;
      });
    });

    // Build vehicles
    const vehicles = [];
    const now = Math.floor(Date.now() / 1000);

    vResults.forEach(({ type, entities }) => {
      entities.forEach(e => {
        if (!e.vehicle?.position) return;
        const v = e.vehicle;
        const tid = v.trip?.tripId || '';
        const tripInfo = trips[type]?.[tid];
        const routeName = tripInfo?.[0] || v.trip?.routeId || '?';
        
        if (routeFilter && routeName !== routeFilter) return;

        const headsign = tripInfo?.[1] || '';
        const direction = tripInfo?.[2] ?? 0;
        const blockId = tripInfo?.[3] || '';
        const brigade = (type === 'A' && blockId && blocks[blockId]) ? blocks[blockId] : '';
        const stopId = v.stopId || '';
        const stopInfo = stops[`${type}:${stopId}`];
        const delaySec = delays[`${type}:${tid}`] || 0;

        vehicles.push({
          id: e.id,
          type,
          route: routeName,
          headsign,
          direction,
          brigade,
          lat: v.position.latitude,
          lng: v.position.longitude,
          bearing: v.position.bearing || 0,
          speed: v.position.speed ? +(v.position.speed * 3.6).toFixed(1) : 0,
          stop: stopInfo ? stopInfo[0] : stopId,
          stopId,
          status: STATUS_MAP[v.currentStatus] || 'IN_TRANSIT_TO',
          delay: delaySec,
          delayMin: Math.round(delaySec / 60),
          vehicle: v.vehicle?.licensePlate || v.vehicle?.label || e.id,
          timestamp: v.timestamp || 0,
          age: now - (v.timestamp || now),
          tripId: tid,
          blockId,
        });
      });
    });

    return Response.json({
      timestamp: now,
      count: vehicles.length,
      vehicles,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=5',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      },
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
