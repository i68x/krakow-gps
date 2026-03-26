'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';

const TYPE_LABELS = { A: 'Autobusy', T: 'Tramwaje', M: 'Mobilis' };
const TYPE_COLORS = { A: '#f04444', T: '#3b82f6', M: '#10b981' };
const STATUS_MAP = { 0: 'INCOMING_AT', 1: 'STOPPED_AT', 2: 'IN_TRANSIT_TO' };
const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
function fmtDelay(sec) {
  const min = Math.round(sec / 60);
  if (min > 0) return `+${min} min`;
  if (min < 0) return `${min} min`;
  return 'Punktualnie';
}
function fmtDelayShort(sec) {
  const min = Math.round(sec / 60);
  if (min > 0) return `+${min}'`;
  if (min < 0) return `${min}'`;
  return '';
}
function nowSec() {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

export default function App() {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const markersRef = useRef(null);
  const stopsRef = useRef(null);
  const ghostMarkersRef = useRef(null);
  const driverMkr = useRef(null);

  // Core data
  const [vehicles, setVehicles] = useState([]);
  const [tripDelays, setTripDelays] = useState({});
  const [activeTypes, setActiveTypes] = useState({ A: true, T: true, M: true });
  const [routeFilter, setRouteFilter] = useState('');
  const [routeList, setRouteList] = useState({ A: [], T: [], M: [] });
  const [trips, setTrips] = useState({ A: {}, T: {}, M: {} });
  const [stops, setStops] = useState({});
  const [blocks, setBlocks] = useState({});
  const [stopRoutes, setStopRoutes] = useState({});
  const [calendars, setCalendars] = useState({});
  const [calDates, setCalDates] = useState({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  // Panels
  const [showStops, setShowStops] = useState(false); // stop search / departures
  const [showSchedule, setShowSchedule] = useState(false); // route schedule
  const [showGhosts, setShowGhosts] = useState(false);
  const [selectedStop, setSelectedStop] = useState(null); // {key, name, lat, lng}
  const [stopSearch, setStopSearch] = useState('');
  const [departures, setDepartures] = useState([]);
  const [depLoading, setDepLoading] = useState(false);
  const [scheduleRoute, setScheduleRoute] = useState(null); // {type, route}
  const [scheduleData, setScheduleData] = useState(null);
  const [scheduleTrips, setScheduleTrips] = useState([]);
  const [scheduleSelTrip, setScheduleSelTrip] = useState(null);

  // Ghost vehicles
  const [ghostVehicles, setGhostVehicles] = useState([]);

  // Driver mode
  const [driverMode, setDriverMode] = useState(false);
  const [driverType, setDriverType] = useState('A');
  const [driverRoute, setDriverRoute] = useState('');
  const [driverDir, setDriverDir] = useState(0);
  const [driverBrigade, setDriverBrigade] = useState('');
  const [driverPos, setDriverPos] = useState(null);
  const [driverDelay, setDriverDelay] = useState(null);
  const [driverStopTimes, setDriverStopTimes] = useState(null);
  const [driverNextStop, setDriverNextStop] = useState(null);
  const watchRef = useRef(null);

  // ═══════ LOAD STATIC DATA ═══════
  useEffect(() => {
    Promise.all([
      fetch('/data/route_list.json').then(r => r.json()),
      fetch('/data/trips_A.json').then(r => r.json()),
      fetch('/data/trips_T.json').then(r => r.json()),
      fetch('/data/trips_M.json').then(r => r.json()),
      fetch('/data/stops.json').then(r => r.json()),
      fetch('/data/blocks.json').then(r => r.json()),
      fetch('/data/stop_routes.json').then(r => r.json()),
      fetch('/data/calendars.json').then(r => r.json()),
      fetch('/data/calendar_dates.json').then(r => r.json()),
    ]).then(([rl, tA, tT, tM, st, bl, sr, cal, cd]) => {
      setRouteList(rl);
      setTrips({ A: tA, T: tT, M: tM });
      setStops(st);
      setBlocks(bl);
      setStopRoutes(sr);
      setCalendars(cal);
      setCalDates(cd);
    });
  }, []);

  // ═══════ INIT MAP ═══════
  useEffect(() => {
    if (mapInst.current) return;
    const map = L.map(mapRef.current, {
      center: [50.06, 19.945], zoom: 13,
      zoomControl: false, attributionControl: false,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://osm.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('ZTP Kraków')
      .addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    stopsRef.current = L.layerGroup().addTo(map);
    ghostMarkersRef.current = L.layerGroup().addTo(map);
    mapInst.current = map;
    return () => { map.remove(); mapInst.current = null; };
  }, []);

  // ═══════ FETCH VEHICLES + TRIP UPDATES ═══════
  const fetchData = useCallback(async () => {
    const types = Object.entries(activeTypes).filter(([, v]) => v).map(([k]) => k);
    if (!types.length) { setVehicles([]); setLoading(false); return; }
    try {
      const [vResults, tResults] = await Promise.all([
        Promise.all(types.map(t =>
          fetch(`/api/gtfs-rt?feed=vehicles_${t}`).then(r => r.json())
            .then(data => (data.entity || []).map(e => ({ ...e, _type: t })))
            .catch(() => [])
        )),
        Promise.all(types.map(t =>
          fetch(`/api/gtfs-rt?feed=trips_${t}`).then(r => r.json())
            .then(data => ({ type: t, entities: data.entity || [] }))
            .catch(() => ({ type: t, entities: [] }))
        )),
      ]);

      const allV = vResults.flat().filter(e => e.vehicle?.position).map(e => {
        const v = e.vehicle; const t = e._type;
        const tid = v.trip?.tripId || '';
        const ti = trips[t]?.[tid];
        return {
          id: e.id, type: t, tripId: tid,
          routeName: ti?.[0] || v.trip?.routeId || '?',
          headsign: ti?.[1] || '', direction: ti?.[2] ?? 0,
          blockId: ti?.[3] || '',
          brigade: (t === 'A' && ti?.[3] && blocks[ti[3]]) ? blocks[ti[3]] : '',
          serviceId: ti?.[4] || '',
          lat: v.position.latitude, lng: v.position.longitude,
          bearing: v.position.bearing || 0, speed: v.position.speed || 0,
          stopSeq: v.currentStopSequence || 0, stopId: v.stopId || '',
          status: STATUS_MAP[v.currentStatus] || 'IN_TRANSIT_TO',
          timestamp: v.timestamp || 0,
          vehicleLabel: v.vehicle?.label || '',
          licensePlate: v.vehicle?.licensePlate || '',
        };
      });
      setVehicles(allV);

      const delays = {};
      tResults.forEach(({ type, entities }) => {
        entities.forEach(e => {
          if (!e.tripUpdate) return;
          const tid = e.tripUpdate.trip?.tripId || e.id;
          let delay = e.tripUpdate.delay;
          if (delay == null) {
            const stu = e.tripUpdate.stopTimeUpdate;
            if (stu?.length) { const l = stu[stu.length - 1]; delay = l.arrival?.delay || l.departure?.delay || 0; }
          }
          delays[`${type}:${tid}`] = delay || 0;
        });
      });
      setTripDelays(delays);
      setLastUpdate(new Date());
      setLoading(false);
    } catch { setLoading(false); }
  }, [activeTypes, trips, blocks]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 12000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // ═══════ CHECK SERVICE ACTIVE ═══════
  const isServiceActive = useCallback((type, serviceId) => {
    const cal = calendars[type]?.[serviceId];
    const today = todayStr();
    const dow = new Date().getDay(); // 0=Sun

    // Check calendar_dates exceptions first
    const exceptions = calDates[type]?.[serviceId] || [];
    for (const [date, etype] of exceptions) {
      if (date === today) {
        if (etype === 1) return true;  // added
        if (etype === 2) return false; // removed
      }
    }

    if (!cal) return false;
    if (today < cal.start || today > cal.end) return false;
    return cal.days[dow === 0 ? 6 : dow - 1] === 1;
  }, [calendars, calDates]);

  // ═══════ GHOST VEHICLES ═══════
  useEffect(() => {
    if (!showGhosts || !Object.keys(trips.A).length) return;

    const ns = nowSec();
    const activeTrips = new Set(vehicles.map(v => `${v.type}:${v.tripId}`));
    const ghosts = [];

    for (const type of ['A', 'T', 'M']) {
      if (!activeTypes[type]) continue;
      const td = trips[type] || {};
      // We don't have stop_times loaded globally, so we check trip updates
      // A ghost is a trip in TripUpdates that's NOT in VehiclePositions
      // Simpler approach: check trips matching active services within time window
    }

    // Use trip updates as proxy — trips with updates but no GPS
    const tripsWithGPS = new Set(vehicles.map(v => `${v.type}:${v.tripId}`));
    const tripsWithUpdates = Object.keys(tripDelays);

    tripsWithUpdates.forEach(key => {
      if (tripsWithGPS.has(key)) return;
      const [type, tid] = [key.split(':')[0], key.substring(key.indexOf(':') + 1)];
      if (!activeTypes[type]) return;
      const ti = trips[type]?.[tid];
      if (!ti) return;
      if (routeFilter && ti[0] !== routeFilter) return;

      ghosts.push({
        type, tripId: tid, routeName: ti[0],
        headsign: ti[1], direction: ti[2],
        blockId: ti[3], delay: tripDelays[key] || 0,
        brigade: (type === 'A' && ti[3] && blocks[ti[3]]) ? blocks[ti[3]] : '',
      });
    });

    ghosts.sort((a, b) => {
      const na = a.routeName, nb = b.routeName;
      const ia = parseInt(na), ib = parseInt(nb);
      if (!isNaN(ia) && !isNaN(ib)) return ia - ib;
      return na.localeCompare(nb);
    });
    setGhostVehicles(ghosts);
  }, [showGhosts, vehicles, tripDelays, trips, blocks, activeTypes, routeFilter]);

  // ═══════ FILTER ═══════
  const filtered = useMemo(() =>
    vehicles.filter(v => {
      if (!activeTypes[v.type]) return false;
      if (routeFilter && v.routeName !== routeFilter) return false;
      return true;
    }), [vehicles, activeTypes, routeFilter]);

  // ═══════ RENDER VEHICLE MARKERS ═══════
  useEffect(() => {
    if (!markersRef.current) return;
    markersRef.current.clearLayers();

    filtered.forEach(v => {
      const delay = tripDelays[`${v.type}:${v.tripId}`] || 0;
      const delayMin = Math.round(delay / 60);
      const delayBorder = delayMin > 3 ? 'border-color:#ef4444' : '';
      const isSel = selectedVehicle === v.id;

      const icon = L.divIcon({
        className: '',
        html: `<div class="vehicle-marker type-${v.type}${isSel ? ' selected' : ''}" style="${delayBorder}">${v.routeName}</div>`,
        iconSize: [0, 0], iconAnchor: [14, 11],
      });

      const marker = L.marker([v.lat, v.lng], { icon, zIndexOffset: isSel ? 1000 : 0 });

      const stopName = v.stopId ? (stops[`${v.type}:${v.stopId}`]?.[0] || v.stopId) : '—';
      const statusIcon = v.status === 'STOPPED_AT' ? '🔴' : v.status === 'INCOMING_AT' ? '🟡' : '🟢';
      const statusTxt = v.status === 'STOPPED_AT' ? 'Na przystanku' : v.status === 'INCOMING_AT' ? 'Dojeżdża do' : 'W trasie do';
      const spd = v.speed ? (v.speed * 3.6).toFixed(0) : '0';
      const ds = fmtDelayShort(delay);
      const dc = delayMin > 3 ? '#ef4444' : delayMin > 0 ? '#f59e0b' : delayMin < 0 ? '#22c55e' : '#f59e0b';

      marker.bindPopup(`
        <div style="min-width:210px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="background:${TYPE_COLORS[v.type]};padding:2px 8px;border-radius:5px;font-family:var(--mono);font-weight:700;font-size:14px">${v.routeName}</span>
            <span style="font-size:13px;font-weight:600">${v.headsign}</span>
          </div>
          <div style="font-size:12px;line-height:1.9;color:var(--text2)">
            ${statusIcon} ${statusTxt}: <span style="color:var(--text)">${stopName}</span><br/>
            🚀 <span style="color:var(--text)">${spd} km/h</span><br/>
            ${v.licensePlate ? `🚌 <span style="color:var(--text)">${v.licensePlate}</span><br/>` : ''}
            ${v.brigade ? `📋 Brygada: <span style="color:var(--text)">${v.brigade}</span><br/>` : ''}
            ⏱ <span style="color:${dc};font-weight:600">${ds || 'Punktualnie'}</span>
          </div>
          <div style="margin-top:8px;display:flex;gap:6px">
            <button onclick="window.__openSchedule__('${v.type}','${v.routeName}','${v.tripId}')"
              style="padding:3px 10px;border-radius:6px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-size:11px;cursor:pointer;font-family:var(--font)">
              📋 Rozkład
            </button>
          </div>
        </div>`, { closeButton: true, maxWidth: 280 });

      marker.on('click', () => setSelectedVehicle(v.id));
      marker.addTo(markersRef.current);
    });
  }, [filtered, tripDelays, stops, selectedVehicle]);

  // Expose openSchedule to popup buttons
  useEffect(() => {
    window.__openSchedule__ = (type, route, tripId) => {
      setScheduleRoute({ type, route });
      setShowSchedule(true);
      setShowStops(false);
      setScheduleSelTrip(tripId);
      // Load schedule data
      fetch(`/data/st/${type}_${route}.json`).then(r => r.ok ? r.json() : null).then(data => {
        setScheduleData(data);
      });
    };
    return () => { delete window.__openSchedule__; };
  }, []);

  // ═══════ STOP SEARCH ═══════
  const stopSearchResults = useMemo(() => {
    if (!stopSearch || stopSearch.length < 2) return [];
    const q = stopSearch.toLowerCase();
    const results = [];
    for (const [key, val] of Object.entries(stops)) {
      if (val[0].toLowerCase().includes(q)) {
        const [type, sid] = [key.split(':')[0], key.substring(key.indexOf(':') + 1)];
        const routes = stopRoutes[key] || [];
        results.push({ key, type, stopId: sid, name: val[0], lat: val[1], lng: val[2], routes });
        if (results.length >= 30) break;
      }
    }
    // Deduplicate by name + type
    const seen = new Set();
    return results.filter(r => {
      const k = `${r.name}:${r.type}:${r.stopId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [stopSearch, stops, stopRoutes]);

  // ═══════ STOP DEPARTURES ═══════
  const loadDepartures = useCallback(async (stopKey) => {
    setDepLoading(true);
    setDepartures([]);
    const routes = stopRoutes[stopKey] || [];
    const [type] = stopKey.split(':');
    const sid = stopKey.substring(stopKey.indexOf(':') + 1);
    const ns = nowSec();
    const allDeps = [];

    // Load stop_times for each route serving this stop
    await Promise.all(routes.map(route =>
      fetch(`/data/st/${type}_${route}.json`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          for (const [tid, stopTimes] of Object.entries(data)) {
            const ti = trips[type]?.[tid];
            if (!ti) continue;
            // Check service
            const serviceId = ti[4];
            if (!isServiceActive(type, serviceId)) continue;

            for (const st of stopTimes) {
              if (st[0] === sid) {
                const arr = st[1];
                if (arr >= ns - 120 && arr <= ns + 7200) { // -2min to +2h
                  const delay = tripDelays[`${type}:${tid}`] || 0;
                  allDeps.push({
                    type, route, tripId: tid,
                    headsign: ti[1], direction: ti[2],
                    time: arr, delay,
                    brigade: (type === 'A' && ti[3] && blocks[ti[3]]) ? blocks[ti[3]] : '',
                  });
                }
                break;
              }
            }
          }
        })
        .catch(() => {})
    ));

    allDeps.sort((a, b) => a.time - b.time);
    setDepartures(allDeps);
    setDepLoading(false);
  }, [stopRoutes, trips, tripDelays, blocks, isServiceActive]);

  // Load departures when stop selected
  useEffect(() => {
    if (selectedStop) {
      loadDepartures(selectedStop.key);
    }
  }, [selectedStop, loadDepartures]);

  // ═══════ SCHEDULE DATA ═══════
  useEffect(() => {
    if (!scheduleRoute) return;
    fetch(`/data/st/${scheduleRoute.type}_${scheduleRoute.route}.json`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setScheduleData(null); setScheduleTrips([]); return; }
        setScheduleData(data);
        const ns = nowSec();
        const td = trips[scheduleRoute.type] || {};
        const tripList = Object.entries(data)
          .map(([tid, sts]) => {
            const ti = td[tid];
            if (!ti) return null;
            if (!isServiceActive(scheduleRoute.type, ti[4])) return null;
            const firstTime = sts[0]?.[1] || 0;
            const lastTime = sts[sts.length - 1]?.[1] || 0;
            return { tid, headsign: ti[1], direction: ti[2], firstTime, lastTime, stops: sts.length };
          })
          .filter(Boolean)
          .filter(t => t.lastTime >= ns - 600)
          .sort((a, b) => a.firstTime - b.firstTime);
        setScheduleTrips(tripList);
        // Auto-select current/next trip
        if (!scheduleSelTrip) {
          const cur = tripList.find(t => t.firstTime <= ns && t.lastTime >= ns) || tripList[0];
          if (cur) setScheduleSelTrip(cur.tid);
        }
      });
  }, [scheduleRoute, trips, isServiceActive]);

  const selectedTripStops = useMemo(() => {
    if (!scheduleData || !scheduleSelTrip) return [];
    const sts = scheduleData[scheduleSelTrip];
    if (!sts) return [];
    return sts.map(st => {
      const si = stops[`${scheduleRoute?.type}:${st[0]}`];
      return { stopId: st[0], time: st[1], seq: st[2], name: si?.[0] || st[0] };
    });
  }, [scheduleData, scheduleSelTrip, stops, scheduleRoute]);

  // ═══════ DRIVER MODE: GPS ═══════
  useEffect(() => {
    if (driverMode && !watchRef.current && navigator.geolocation) {
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
          setDriverPos(p);
          if (mapInst.current) {
            if (!driverMkr.current) {
              const ic = L.divIcon({
                className: '',
                html: `<div style="width:20px;height:20px;border-radius:50%;background:var(--gold);border:3px solid #fff;box-shadow:0 0 14px var(--gold);position:relative" class="gps-pulse"></div>`,
                iconSize: [20, 20], iconAnchor: [10, 10],
              });
              driverMkr.current = L.marker([p.lat, p.lng], { icon: ic, zIndexOffset: 2000 }).addTo(mapInst.current);
            } else driverMkr.current.setLatLng([p.lat, p.lng]);
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
      );
    }
    if (!driverMode && watchRef.current) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      driverMkr.current?.remove(); driverMkr.current = null;
      stopsRef.current?.clearLayers();
    }
    return () => { if (watchRef.current) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; } };
  }, [driverMode]);

  // Driver: load stop_times
  useEffect(() => {
    if (!driverMode || !driverRoute || !driverType) { setDriverStopTimes(null); return; }
    fetch(`/data/st/${driverType}_${driverRoute}.json`)
      .then(r => r.ok ? r.json() : null).then(setDriverStopTimes).catch(() => setDriverStopTimes(null));
  }, [driverMode, driverRoute, driverType]);

  // Driver: calculate delay
  useEffect(() => {
    if (!driverMode || !driverStopTimes || !driverPos) {
      setDriverDelay(null); setDriverNextStop(null); return;
    }
    const ns = nowSec();
    const td = trips[driverType] || {};
    const matching = Object.entries(driverStopTimes).filter(([tid]) => {
      const ti = td[tid]; if (!ti) return false;
      if (ti[2] !== driverDir) return false;
      if (driverBrigade) {
        const brig = blocks[ti[3]] || ti[3];
        if (brig !== driverBrigade && ti[3] !== driverBrigade) return false;
      }
      return true;
    });
    let bestTrip = null, bestDist = Infinity;
    for (const [tid, sts] of matching) {
      if (!sts?.length) continue;
      if (ns < sts[0][1] - 1800 || ns > sts[sts.length - 1][1] + 1800) continue;
      for (const st of sts) {
        const si = stops[`${driverType}:${st[0]}`]; if (!si) continue;
        const d = (si[1] - driverPos.lat) ** 2 + (si[2] - driverPos.lng) ** 2;
        if (d < bestDist) { bestDist = d; bestTrip = [tid, sts]; }
      }
    }
    if (!bestTrip) { setDriverDelay(null); setDriverNextStop(null); return; }
    const [, sts] = bestTrip;
    let cIdx = 0, cDist = Infinity;
    for (let i = 0; i < sts.length; i++) {
      const si = stops[`${driverType}:${sts[i][0]}`]; if (!si) continue;
      const d = (si[1] - driverPos.lat) ** 2 + (si[2] - driverPos.lng) ** 2;
      if (d < cDist) { cDist = d; cIdx = i; }
    }
    const nst = sts[cIdx];
    const sName = stops[`${driverType}:${nst[0]}`]?.[0] || nst[0];
    setDriverNextStop({ name: sName, scheduledTime: nst[1], idx: cIdx, total: sts.length });
    setDriverDelay(ns - nst[1]);

    if (stopsRef.current) {
      stopsRef.current.clearLayers();
      sts.forEach((st, i) => {
        const si = stops[`${driverType}:${st[0]}`]; if (!si) return;
        const isN = i === cIdx;
        const ic = L.divIcon({
          className: '',
          html: `<div class="stop-dot${isN ? ' active' : ''}"></div>`,
          iconSize: [isN ? 14 : 10, isN ? 14 : 10], iconAnchor: [isN ? 7 : 5, isN ? 7 : 5],
        });
        L.marker([si[1], si[2]], { icon: ic })
          .bindTooltip(`${si[0]} (${fmtTime(st[1])})`, { permanent: false })
          .addTo(stopsRef.current);
      });
    }
  }, [driverMode, driverStopTimes, driverPos, driverDir, driverBrigade, driverType, trips, stops, blocks]);

  useEffect(() => { if (!driverMode) stopsRef.current?.clearLayers(); }, [driverMode]);

  // ═══════ COMPUTED ═══════
  const allRoutes = useMemo(() => {
    const r = [];
    Object.entries(activeTypes).forEach(([t, on]) => {
      if (on && routeList[t]) routeList[t].forEach(x => { if (!r.includes(x)) r.push(x); });
    });
    return r;
  }, [activeTypes, routeList]);

  const driverRoutes = routeList[driverType] || [];
  const driverBrigades = useMemo(() => {
    if (!driverRoute || driverType !== 'A') return [];
    const td = trips.A || {}; const seen = new Set(); const list = [];
    Object.values(td).forEach(info => {
      if (info[0] !== driverRoute) return;
      const b = blocks[info[3]] || info[3];
      if (b && !seen.has(b)) { seen.add(b); list.push(b); }
    });
    return list.sort();
  }, [driverRoute, driverType, trips, blocks]);

  const driverHeadsigns = useMemo(() => {
    if (!driverRoute || !driverType) return ['Kier. 0', 'Kier. 1'];
    const td = trips[driverType] || {};
    const h = { 0: new Set(), 1: new Set() };
    Object.values(td).forEach(i => { if (i[0] === driverRoute && i[1]) h[i[2]]?.add(i[1]); });
    return [h[0].size ? [...h[0]][0] : 'Kier. 0', h[1].size ? [...h[1]][0] : 'Kier. 1'];
  }, [driverRoute, driverType, trips]);

  // ═══════ CLICK STOP ON MAP ═══════
  useEffect(() => {
    if (!mapInst.current) return;
    const map = mapInst.current;
    const onClick = (e) => {
      // Find closest stop within ~200m
      const cl = e.latlng;
      let best = null, bestD = 0.002; // ~200m
      for (const [key, val] of Object.entries(stops)) {
        const d = Math.abs(val[1] - cl.lat) + Math.abs(val[2] - cl.lng);
        if (d < bestD) { bestD = d; best = { key, name: val[0], lat: val[1], lng: val[2] }; }
      }
      if (best && map.getZoom() >= 14) {
        setSelectedStop(best);
        setShowStops(true);
        setStopSearch('');
      }
    };
    map.on('click', onClick);
    return () => map.off('click', onClick);
  }, [stops]);

  // ═══════ RENDER ═══════
  return (
    <div style={{ width: '100vw', height: '100dvh', position: 'relative' }}>
      <div ref={mapRef} id="map-container" />

      {/* ══ TOP BAR ══ */}
      <div className="panel top-bar fade-in" style={{
        top: 10, left: 10, right: 10, padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <div className="top-bar-row">
          <span className="logo" style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.5px', marginRight: 4 }}>
            🚍 KRK<span style={{ color: 'var(--gold)' }}>GPS</span>
          </span>
          <span className="count-badge">{filtered.length}</span>
        </div>

        <div className="top-bar-row" style={{ gap: 3 }}>
          {Object.entries(TYPE_LABELS).map(([t, lbl]) => (
            <button key={t}
              className={`btn btn-type ${activeTypes[t] ? 'active-' + t : ''}`}
              onClick={() => setActiveTypes(p => ({ ...p, [t]: !p[t] }))}
            >{lbl}</button>
          ))}
        </div>

        <div className="top-bar-row" style={{ flex: 1, minWidth: 100 }}>
          <select className="sel" value={routeFilter}
            onChange={e => setRouteFilter(e.target.value)}
            style={{ minWidth: 100, flex: '0 0 auto' }}>
            <option value="">Wszystkie</option>
            {allRoutes.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="top-bar-row" style={{ gap: 4 }}>
          <button className={`btn ${showStops ? 'active' : ''}`}
            onClick={() => { setShowStops(!showStops); setShowSchedule(false); }}>
            🚏 Odjazdy
          </button>
          <button className={`btn ${showGhosts ? 'active' : ''}`}
            onClick={() => setShowGhosts(!showGhosts)}>
            👻 Bez GPS <span className="count-badge" style={{ marginLeft: 2 }}>{ghostVehicles.length}</span>
          </button>
          <button className={`btn ${driverMode ? 'active' : ''}`}
            onClick={() => { setDriverMode(!driverMode); setShowStops(false); setShowSchedule(false); }}>
            🚐 Kierowca
          </button>
        </div>

        {lastUpdate && (
          <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            {lastUpdate.toLocaleTimeString('pl-PL')}
          </span>
        )}
      </div>

      {/* ══ STOP DEPARTURES PANEL ══ */}
      {showStops && (
        <div className="side-panel left fade-in">
          <div className="side-panel-header">
            <span style={{ fontSize: 15, fontWeight: 700 }}>🚏 Odjazdy</span>
            <button className="side-panel-close" onClick={() => setShowStops(false)}>✕</button>
          </div>

          {/* Search */}
          <div style={{ padding: '10px 14px', position: 'relative', flexShrink: 0 }}>
            <span style={{ position: 'absolute', left: 24, top: 20, color: 'var(--text3)', fontSize: 14 }}>🔍</span>
            <input
              className="search-input"
              placeholder="Szukaj przystanku..."
              value={stopSearch}
              onChange={e => setStopSearch(e.target.value)}
            />
          </div>

          <div className="side-panel-body">
            {/* Search results */}
            {stopSearch.length >= 2 && !selectedStop && (
              stopSearchResults.map(s => (
                <div key={s.key} className="dep-row" style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelectedStop(s);
                    setStopSearch('');
                    mapInst.current?.setView([s.lat, s.lng], 16);
                  }}>
                  <span style={{ fontSize: 16 }}>🚏</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                      {TYPE_LABELS[s.type]} • {s.routes.slice(0, 6).join(', ')}{s.routes.length > 6 ? '...' : ''}
                    </div>
                  </div>
                </div>
              ))
            )}

            {/* Selected stop departures */}
            {selectedStop && (
              <>
                <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>🚏</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedStop.name}</div>
                    </div>
                    <button className="side-panel-close" style={{ width: 24, height: 24, fontSize: 11 }}
                      onClick={() => setSelectedStop(null)}>←</button>
                  </div>
                </div>

                {depLoading ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--text2)' }}>
                    <div className="spinner" style={{ display: 'inline-block', width: 20, height: 20, border: '2px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%' }} />
                    <div style={{ marginTop: 8, fontSize: 12 }}>Ładuję odjazdy...</div>
                  </div>
                ) : departures.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--text2)', fontSize: 13 }}>
                    Brak odjazdów w najbliższych 2h
                  </div>
                ) : (
                  departures.slice(0, 40).map((dep, i) => {
                    const delayMin = Math.round(dep.delay / 60);
                    const realTime = dep.time + dep.delay;
                    const minTo = Math.max(0, Math.round((realTime - nowSec()) / 60));
                    return (
                      <div key={i} className="dep-row"
                        onClick={() => window.__openSchedule__?.(dep.type, dep.route, dep.tripId)}>
                        <span className={`route-badge type-${dep.type}`}>{dep.route}</span>
                        <div className="dep-headsign">{dep.headsign || `Kier. ${dep.direction}`}</div>
                        <div className="dep-time">{fmtTime(dep.time)}</div>
                        {delayMin !== 0 && (
                          <span className={`dep-delay ${delayMin > 0 ? 'late' : 'early'}`}>
                            {fmtDelayShort(dep.delay)}
                          </span>
                        )}
                        <span style={{
                          fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700,
                          color: minTo <= 1 ? 'var(--danger)' : minTo <= 5 ? 'var(--warning)' : 'var(--text)',
                          minWidth: 32, textAlign: 'right',
                        }}>
                          {minTo <= 0 ? '>>>' : `${minTo}'`}
                        </span>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {!stopSearch && !selectedStop && (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text2)', fontSize: 13 }}>
                Wyszukaj przystanek lub kliknij na mapie (zoom ≥ 14)
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ ROUTE SCHEDULE PANEL ══ */}
      {showSchedule && scheduleRoute && (
        <div className="side-panel right slide-right">
          <div className="side-panel-header">
            <span className={`route-badge type-${scheduleRoute.type}`} style={{ fontSize: 14, padding: '3px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontWeight: 700, color: '#fff' }}>
              {scheduleRoute.route}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Rozkład jazdy</span>
            <button className="side-panel-close" onClick={() => { setShowSchedule(false); setScheduleRoute(null); setScheduleSelTrip(null); }}>✕</button>
          </div>

          {/* Trip selector */}
          {scheduleTrips.length > 0 && (
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <select className="sel" style={{ width: '100%' }}
                value={scheduleSelTrip || ''}
                onChange={e => setScheduleSelTrip(e.target.value)}>
                {scheduleTrips.map(t => (
                  <option key={t.tid} value={t.tid}>
                    {fmtTime(t.firstTime)} → {fmtTime(t.lastTime)} • {t.headsign} (kier.{t.direction})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="side-panel-body">
            {selectedTripStops.length > 0 ? (
              selectedTripStops.map((st, i) => {
                const ns = nowSec();
                const isActive = Math.abs(st.time - ns) < 120;
                const isPast = st.time < ns - 60;
                return (
                  <div key={i} className={`sched-row ${isActive ? 'active' : ''}`}
                    style={{ opacity: isPast ? 0.4 : 1 }}>
                    <div className="sched-seq">{i + 1}</div>
                    <div className="sched-stop" style={{ fontWeight: isActive ? 600 : 400 }}>{st.name}</div>
                    <div className="sched-time">{fmtTime(st.time)}</div>
                  </div>
                );
              })
            ) : (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text2)', fontSize: 13 }}>
                Brak kursów do wyświetlenia
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ GHOST VEHICLES LIST ══ */}
      {showGhosts && ghostVehicles.length > 0 && (
        <div className="side-panel right slide-right" style={{ top: 70 }}>
          <div className="side-panel-header">
            <span style={{ fontSize: 15, fontWeight: 700 }}>👻 Pojazdy bez GPS</span>
            <span className="count-badge">{ghostVehicles.length}</span>
            <button className="side-panel-close" onClick={() => setShowGhosts(false)}>✕</button>
          </div>
          <div className="side-panel-body">
            {ghostVehicles.map((g, i) => {
              const delayMin = Math.round(g.delay / 60);
              return (
                <div key={i} className="ghost-row">
                  <span className="ghost-icon">👻</span>
                  <span className={`route-badge type-${g.type}`} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700, color: '#fff' }}>
                    {g.routeName}
                  </span>
                  <span style={{ flex: 1, fontSize: 12 }}>{g.headsign}</span>
                  {g.brigade && <span style={{ fontSize: 10, color: 'var(--text3)' }}>{g.brigade}</span>}
                  {delayMin !== 0 && (
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: delayMin > 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {fmtDelayShort(g.delay)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ DRIVER HUD ══ */}
      {driverMode && (
        <div className="panel driver-hud driver-bottom fade-in" style={{
          bottom: 14, left: 12, right: 12, padding: 14,
          maxHeight: '50dvh', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)' }}>🚐 Kierowca</span>
            {driverPos && <span style={{ fontSize: 10, color: 'var(--text3)' }}>GPS ±{driverPos.acc?.toFixed(0)}m</span>}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <select className="sel" style={{ flex: '1 1 70px' }} value={driverType}
              onChange={e => { setDriverType(e.target.value); setDriverRoute(''); setDriverBrigade(''); }}>
              <option value="A">Autobus</option><option value="T">Tramwaj</option><option value="M">Mobilis</option>
            </select>
            <select className="sel" style={{ flex: '1 1 70px' }} value={driverRoute}
              onChange={e => { setDriverRoute(e.target.value); setDriverBrigade(''); }}>
              <option value="">Linia</option>
              {driverRoutes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="sel" style={{ flex: '1 1 90px' }} value={driverDir}
              onChange={e => setDriverDir(parseInt(e.target.value))}>
              <option value={0}>{driverHeadsigns[0]}</option>
              <option value={1}>{driverHeadsigns[1]}</option>
            </select>
            {driverType === 'A' && driverBrigades.length > 0 && (
              <select className="sel" style={{ flex: '1 1 80px' }} value={driverBrigade}
                onChange={e => setDriverBrigade(e.target.value)}>
                <option value="">Brygada</option>
                {driverBrigades.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>

          {driverDelay !== null && driverNextStop ? (
            <div style={{
              background: 'var(--bg)', borderRadius: 12, padding: 14,
              textAlign: 'center', border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>
                {driverNextStop.idx + 1}/{driverNextStop.total}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{driverNextStop.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>Rozkład: {fmtTime(driverNextStop.scheduledTime)}</div>
              <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1, margin: '10px 0 6px', fontFamily: 'var(--mono)' }}
                className={driverDelay > 60 ? 'delay-positive' : driverDelay < -60 ? 'delay-negative' : 'delay-zero'}>
                {fmtDelay(driverDelay)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                {driverDelay > 120 ? '⚠️ Opóźnienie' : driverDelay < -120 ? '⏩ Przed czasem' : '✅ W rozkładzie'}
              </div>
            </div>
          ) : driverRoute ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text2)', fontSize: 13 }}>
              {!driverPos ? '📍 Czekam na GPS...' : '🔍 Szukam kursu...'}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text2)', fontSize: 13 }}>
              Wybierz linię
            </div>
          )}
        </div>
      )}

      {/* ══ LOADING ══ */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(8,11,16,0.92)', backdropFilter: 'blur(10px)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🚍</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Ładowanie pojazdów...</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>gtfs.ztp.krakow.pl</div>
          </div>
        </div>
      )}
    </div>
  );
}
