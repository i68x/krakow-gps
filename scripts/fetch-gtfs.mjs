#!/usr/bin/env node
/**
 * Downloads fresh GTFS data from gtfs.ztp.krakow.pl and processes into JSON.
 * Runs during `npm run build` (prebuild step).
 */
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import AdmZip from 'adm-zip';

const BASE = 'https://gtfs.ztp.krakow.pl';
const TYPES = ['A', 'T', 'M'];
const OUT = path.join(process.cwd(), 'public', 'data');
const TMP = path.join(process.cwd(), '.gtfs-tmp');

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

async function downloadFile(url, dest) {
  console.log(`  Downloading ${url}...`);
  const res = await fetch(url, { headers: { 'User-Agent': 'KrakowGPS-Build/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

function readCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    // Simple CSV parse handling quoted fields
    const vals = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

function timeToSec(ts) {
  const [h, m, s] = ts.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

async function main() {
  console.log('=== GTFS Updater ===');
  console.log(`Time: ${new Date().toISOString()}`);

  ensureDir(TMP);
  ensureDir(OUT);
  ensureDir(path.join(OUT, 'st'));
  ensureDir(path.join(OUT, 'shapes'));

  // 1. Download GTFS ZIPs
  for (const t of TYPES) {
    const zipName = `GTFS_KRK_${t}.zip`;
    const zipPath = path.join(TMP, zipName);
    const extractDir = path.join(TMP, t);

    try {
      await downloadFile(`${BASE}/${zipName}`, zipPath);
      ensureDir(extractDir);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
      console.log(`  Extracted ${zipName}`);
    } catch (e) {
      console.error(`  WARN: Failed to download ${zipName}: ${e.message}`);
      // Check if we have existing data
      if (fs.existsSync(path.join(OUT, `trips_${t}.json`))) {
        console.log(`  Using existing data for ${t}`);
        continue;
      }
      throw e;
    }
  }

  // 2. Process routes
  const routes = {};
  for (const t of TYPES) {
    routes[t] = {};
    const file = path.join(TMP, t, 'routes.txt');
    if (!fs.existsSync(file)) continue;
    for (const row of readCSV(file)) {
      routes[t][row.route_id] = { n: row.route_short_name, t: parseInt(row.route_type || '3') };
    }
  }
  fs.writeFileSync(path.join(OUT, 'routes.json'), JSON.stringify(routes));
  console.log('Routes processed');

  // 3. Process trips
  const allTrips = {};
  for (const t of TYPES) {
    allTrips[t] = {};
    const file = path.join(TMP, t, 'trips.txt');
    if (!fs.existsSync(file)) continue;
    for (const row of readCSV(file)) {
      const rid = row.route_id;
      const rn = routes[t][rid]?.n || '?';
      allTrips[t][row.trip_id] = [
        rn,
        row.trip_headsign || '',
        parseInt(row.direction_id || '0'),
        row.block_id || '',
        row.service_id || '',
      ];
    }
    fs.writeFileSync(path.join(OUT, `trips_${t}.json`), JSON.stringify(allTrips[t]));
    console.log(`  trips_${t}: ${Object.keys(allTrips[t]).length} trips`);
  }

  // 4. Process stops
  const allStops = {};
  for (const t of TYPES) {
    const file = path.join(TMP, t, 'stops.txt');
    if (!fs.existsSync(file)) continue;
    for (const row of readCSV(file)) {
      allStops[`${t}:${row.stop_id}`] = [row.stop_name, parseFloat(row.stop_lat), parseFloat(row.stop_lon)];
    }
  }
  fs.writeFileSync(path.join(OUT, 'stops.json'), JSON.stringify(allStops));
  console.log(`Stops: ${Object.keys(allStops).length}`);

  // 5. Route list
  const routeList = {};
  for (const t of TYPES) {
    const names = [...new Set(Object.values(routes[t]).map(r => r.n))];
    names.sort((a, b) => {
      const ia = parseInt(a), ib = parseInt(b);
      if (!isNaN(ia) && !isNaN(ib)) return ia - ib;
      if (!isNaN(ia)) return -1;
      if (!isNaN(ib)) return 1;
      return a.localeCompare(b);
    });
    routeList[t] = names;
  }
  fs.writeFileSync(path.join(OUT, 'route_list.json'), JSON.stringify(routeList));

  // 6. Blocks
  const blocksAll = {};
  const blockRoute = {};

  // A blocks
  const blocksFile = path.join(TMP, 'A', 'blocks.txt');
  if (fs.existsSync(blocksFile)) {
    for (const row of readCSV(blocksFile)) {
      blocksAll[`A:${row.block_id}`] = row.shift;
      const routeNum = row.shift.split('-')[0];
      blockRoute[`A:${row.block_id}`] = routeNum;
    }
  }

  // T blocks from trips
  for (const row of readCSV(path.join(TMP, 'T', 'trips.txt'))) {
    if (row.block_id) {
      blocksAll[`T:${row.block_id}`] = row.block_id;
      const rn = routes.T[row.route_id]?.n;
      if (rn && !blockRoute[`T:${row.block_id}`]) {
        blockRoute[`T:${row.block_id}`] = rn;
      }
    }
  }

  // M blocks from trips
  for (const row of readCSV(path.join(TMP, 'M', 'trips.txt'))) {
    if (row.block_id) {
      blocksAll[`M:${row.block_id}`] = row.block_id;
    }
  }

  fs.writeFileSync(path.join(OUT, 'blocks_all.json'), JSON.stringify(blocksAll));
  fs.writeFileSync(path.join(OUT, 'block_route.json'), JSON.stringify(blockRoute));
  console.log(`Blocks: ${Object.keys(blocksAll).length}, BlockRoutes: ${Object.keys(blockRoute).length}`);

  // 7. M route map
  const mRM = {};
  for (const [rid, r] of Object.entries(routes.M || {})) mRM[rid] = r.n;
  fs.writeFileSync(path.join(OUT, 'm_route_map.json'), JSON.stringify(mRM));

  // 8. Calendars
  const calendars = {};
  const calDates = {};
  for (const t of TYPES) {
    calendars[t] = {};
    const file = path.join(TMP, t, 'calendar.txt');
    if (fs.existsSync(file)) {
      for (const row of readCSV(file)) {
        calendars[t][row.service_id] = {
          days: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => parseInt(row[d] || '0')),
          start: row.start_date, end: row.end_date,
        };
      }
    }
    calDates[t] = {};
    const cdFile = path.join(TMP, t, 'calendar_dates.txt');
    if (fs.existsSync(cdFile)) {
      for (const row of readCSV(cdFile)) {
        if (!calDates[t][row.service_id]) calDates[t][row.service_id] = [];
        calDates[t][row.service_id].push([row.date, parseInt(row.exception_type)]);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'calendars.json'), JSON.stringify(calendars));
  fs.writeFileSync(path.join(OUT, 'calendar_dates.json'), JSON.stringify(calDates));

  // 9. Stop routes index
  const stopRoutes = {};
  for (const t of TYPES) {
    const tripRoute = {};
    for (const [tid, info] of Object.entries(allTrips[t])) tripRoute[tid] = info[0];
    const file = path.join(TMP, t, 'stop_times.txt');
    if (!fs.existsSync(file)) continue;
    const sr = {};
    for (const row of readCSV(file)) {
      const rn = tripRoute[row.trip_id];
      if (!rn) continue;
      if (!sr[row.stop_id]) sr[row.stop_id] = new Set();
      sr[row.stop_id].add(rn);
    }
    for (const [sid, rts] of Object.entries(sr)) {
      const sorted = [...rts].sort((a, b) => {
        const ia = parseInt(a), ib = parseInt(b);
        if (!isNaN(ia) && !isNaN(ib)) return ia - ib;
        return a.localeCompare(b);
      });
      stopRoutes[`${t}:${sid}`] = sorted;
    }
  }
  fs.writeFileSync(path.join(OUT, 'stop_routes.json'), JSON.stringify(stopRoutes));
  console.log(`StopRoutes: ${Object.keys(stopRoutes).length}`);

  // 10. Stop times per route (chunked)
  for (const t of TYPES) {
    const tripRoute = {};
    for (const [tid, info] of Object.entries(allTrips[t])) tripRoute[tid] = info[0];
    const byRoute = {};
    const file = path.join(TMP, t, 'stop_times.txt');
    if (!fs.existsSync(file)) continue;
    for (const row of readCSV(file)) {
      const rn = tripRoute[row.trip_id];
      if (!rn) continue;
      if (!byRoute[rn]) byRoute[rn] = {};
      if (!byRoute[rn][row.trip_id]) byRoute[rn][row.trip_id] = [];
      byRoute[rn][row.trip_id].push([row.stop_id, timeToSec(row.arrival_time), parseInt(row.stop_sequence)]);
    }
    for (const [rn, trips] of Object.entries(byRoute)) {
      for (const tid of Object.keys(trips)) {
        trips[tid].sort((a, b) => a[2] - b[2]);
      }
      fs.writeFileSync(path.join(OUT, 'st', `${t}_${rn}.json`), JSON.stringify(trips));
    }
    console.log(`  st/${t}_*: ${Object.keys(byRoute).length} routes`);
  }

  // 11. Shapes per route (simplified)
  for (const t of TYPES) {
    const shapes = {};
    const shFile = path.join(TMP, t, 'shapes.txt');
    if (!fs.existsSync(shFile)) continue;
    for (const row of readCSV(shFile)) {
      if (!shapes[row.shape_id]) shapes[row.shape_id] = [];
      shapes[row.shape_id].push([parseInt(row.shape_pt_sequence), parseFloat(row.shape_pt_lat), parseFloat(row.shape_pt_lon)]);
    }
    // shape_id -> sorted points
    for (const sid of Object.keys(shapes)) {
      shapes[sid].sort((a, b) => a[0] - b[0]);
      shapes[sid] = shapes[sid].map(p => [Math.round(p[1] * 100000) / 100000, Math.round(p[2] * 100000) / 100000]);
    }
    // route -> shape_ids
    const routeShapes = {};
    const tripsFile = path.join(TMP, t, 'trips.txt');
    if (!fs.existsSync(tripsFile)) continue;
    for (const row of readCSV(tripsFile)) {
      const rn = routes[t][row.route_id]?.n;
      if (!rn || !row.shape_id) continue;
      if (!routeShapes[rn]) routeShapes[rn] = new Set();
      routeShapes[rn].add(row.shape_id);
    }
    for (const [rn, sids] of Object.entries(routeShapes)) {
      const sorted = [...sids].sort((a, b) => (shapes[b]?.length || 0) - (shapes[a]?.length || 0));
      const data = sorted.slice(0, 2).map(sid => {
        let pts = shapes[sid] || [];
        if (pts.length > 200) {
          const step = Math.max(1, Math.floor(pts.length / 150));
          pts = pts.filter((_, i) => i % step === 0);
          if (pts[pts.length - 1] !== shapes[sid][shapes[sid].length - 1]) pts.push(shapes[sid][shapes[sid].length - 1]);
        }
        return pts;
      });
      fs.writeFileSync(path.join(OUT, 'shapes', `${t}_${rn}.json`), JSON.stringify(data));
    }
    console.log(`  shapes/${t}_*: ${Object.keys(routeShapes).length} routes`);
  }

  // 12. Feed info with timestamps
  const feedInfo = {
    A: new Date().toISOString().replace('T', ' ').substring(0, 19),
    T: new Date().toISOString().replace('T', ' ').substring(0, 19),
    M: new Date().toISOString().replace('T', ' ').substring(0, 19),
    updated: new Date().toISOString(),
  };
  // Try to read actual feed_info from GTFS
  for (const t of TYPES) {
    const fiFile = path.join(TMP, t, 'feed_info.txt');
    if (fs.existsSync(fiFile)) {
      const rows = readCSV(fiFile);
      if (rows[0]?.feed_version) feedInfo[t] = rows[0].feed_version;
    }
  }
  fs.writeFileSync(path.join(OUT, 'feed_info.json'), JSON.stringify(feedInfo));

  // Cleanup
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log('\n=== GTFS Update Complete ===');
  console.log(`Feed info: ${JSON.stringify(feedInfo)}`);
}

main().catch(e => {
  console.error('GTFS update failed:', e);
  // Don't fail the build if we have existing data
  if (fs.existsSync(path.join(OUT, 'trips_A.json'))) {
    console.log('Using existing data, continuing build...');
    process.exit(0);
  }
  process.exit(1);
});
