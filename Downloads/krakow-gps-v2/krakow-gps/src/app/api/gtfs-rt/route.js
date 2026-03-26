import protobuf from 'protobufjs';

const FEED_URLS = {
  'vehicles_A': 'https://gtfs.ztp.krakow.pl/VehiclePositions_A.pb',
  'vehicles_T': 'https://gtfs.ztp.krakow.pl/VehiclePositions_T.pb',
  'vehicles_M': 'https://gtfs.ztp.krakow.pl/VehiclePositions_M.pb',
  'trips_A': 'https://gtfs.ztp.krakow.pl/TripUpdates_A.pb',
  'trips_T': 'https://gtfs.ztp.krakow.pl/TripUpdates_T.pb',
  'trips_M': 'https://gtfs.ztp.krakow.pl/TripUpdates_M.pb',
  'alerts_A': 'https://gtfs.ztp.krakow.pl/ServiceAlerts_A.pb',
  'alerts_T': 'https://gtfs.ztp.krakow.pl/ServiceAlerts_T.pb',
  'alerts_M': 'https://gtfs.ztp.krakow.pl/ServiceAlerts_M.pb',
};

const PROTO_DEF = `
syntax = "proto2";
package transit_realtime;

message FeedMessage {
  required FeedHeader header = 1;
  repeated FeedEntity entity = 2;
}
message FeedHeader {
  required string gtfs_realtime_version = 1;
  optional uint64 timestamp = 3;
}
message FeedEntity {
  required string id = 1;
  optional bool is_deleted = 2;
  optional TripUpdate trip_update = 3;
  optional VehiclePosition vehicle = 4;
  optional Alert alert = 5;
}
message TripUpdate {
  optional TripDescriptor trip = 1;
  repeated StopTimeUpdate stop_time_update = 2;
  optional VehicleDescriptor vehicle = 3;
  optional uint64 timestamp = 4;
  optional int32 delay = 5;
  message StopTimeUpdate {
    optional uint32 stop_sequence = 1;
    optional StopTimeEvent arrival = 2;
    optional StopTimeEvent departure = 3;
    optional string stop_id = 4;
    optional int32 schedule_relationship = 5;
  }
}
message StopTimeEvent {
  optional int32 delay = 1;
  optional int64 time = 2;
  optional int32 uncertainty = 3;
}
message VehiclePosition {
  optional TripDescriptor trip = 1;
  optional Position position = 2;
  optional uint32 current_stop_sequence = 3;
  optional int32 current_status = 4;
  optional uint64 timestamp = 5;
  optional int32 congestion_level = 6;
  optional string stop_id = 7;
  optional VehicleDescriptor vehicle = 8;
  optional int32 occupancy_status = 9;
}
message Position {
  required float latitude = 1;
  required float longitude = 2;
  optional float bearing = 3;
  optional double odometer = 4;
  optional float speed = 5;
}
message TripDescriptor {
  optional string trip_id = 1;
  optional string start_time = 2;
  optional string start_date = 3;
  optional int32 schedule_relationship = 4;
  optional string route_id = 5;
  optional uint32 direction_id = 6;
}
message VehicleDescriptor {
  optional string id = 1;
  optional string label = 2;
  optional string license_plate = 3;
}
message Alert {
  repeated TimeRange active_period = 1;
  repeated EntitySelector informed_entity = 5;
  optional int32 cause = 6;
  optional int32 effect = 7;
  optional TranslatedString header_text = 10;
  optional TranslatedString description_text = 11;
}
message TimeRange {
  optional uint64 start = 1;
  optional uint64 end = 2;
}
message EntitySelector {
  optional string agency_id = 1;
  optional string route_id = 2;
  optional int32 route_type = 3;
  optional TripDescriptor trip = 4;
  optional string stop_id = 5;
}
message TranslatedString {
  repeated Translation translation = 1;
  message Translation {
    required string text = 1;
    optional string language = 2;
  }
}
`;

let cachedRoot = null;
function getRoot() {
  if (!cachedRoot) {
    cachedRoot = protobuf.parse(PROTO_DEF, { keepCase: false }).root;
  }
  return cachedRoot;
}

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const feed = searchParams.get('feed');

  if (!feed || !FEED_URLS[feed]) {
    return Response.json({ error: 'Invalid feed' }, { status: 400 });
  }

  try {
    const res = await fetch(FEED_URLS[feed], {
      headers: { 'User-Agent': 'KrakowGPS/1.0' },
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
    const obj = FeedMessage.toObject(message, {
      longs: Number,
      enums: Number,
      defaults: true,
    });

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
