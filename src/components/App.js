'use client';
import{useState,useEffect,useRef,useCallback,useMemo}from'react';
import L from'leaflet';

/* ═══ CONSTANTS ═══ */
const TL={A:'Autobusy',T:'Tramwaje',M:'Mobilis'};
const TC={A:'#dc2626',T:'#2563eb',M:'#059669'};
const SM={0:'INCOMING_AT',1:'STOPPED_AT',2:'IN_TRANSIT_TO'};
const HCAP='a0da6480-998e-4be2-9a56-3058e0feabfe';
const REFRESH_INTERVAL=15000;

/* ═══ HELPERS ═══ */
const ft=s=>`${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}`;
const fd=s=>{const m=Math.round(s/60);return m>0?`+${m} min`:m<0?`${m} min`:'0 min';};
const fds=s=>{const m=Math.round(s/60);return m>0?`+${m}'`:m<0?`${m}'`:'0\'';};
const nsc=()=>{const d=new Date();return d.getHours()*3600+d.getMinutes()*60+d.getSeconds();};
const tds=()=>{const d=new Date();return`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;};
const xBlock=tid=>{const m=tid.match(/^(block_\d+)/);return m?m[1]:'';};
const hav=(a,b,c,d)=>{const R=6371e3,dL=(c-a)*Math.PI/180,dN=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};
const fmtAge=ts=>{if(!ts)return'?';const s=Math.round(Date.now()/1000-ts);if(s<60)return`${s}s temu`;if(s<3600)return`${Math.floor(s/60)}m temu`;return`${Math.floor(s/3600)}h temu`;};
const isStale=ts=>ts&&(Date.now()/1000-ts)>300; // >5 minutes

function gmapsUrl(coords){
  if(!coords||coords.length<2)return null;
  const o=coords[0],d=coords[coords.length-1];
  const step=Math.max(1,Math.floor((coords.length-2)/18));
  const wps=[];for(let i=1;i<coords.length-1;i+=step)wps.push(`${coords[i][0]},${coords[i][1]}`);
  return`https://www.google.com/maps/dir/${o[0]},${o[1]}/${wps.join('/')}/${d[0]},${d[1]}`;
}

/* ═══ MAIN COMPONENT ═══ */
export default function App(){
const mapRef=useRef(null),mapI=useRef(null);
const mkL=useRef(null),stL=useRef(null),shpL=useRef(null),jamL=useRef(null),allStL=useRef(null);
const markerMap=useRef(new Map());
const prevPos=useRef(new Map());

/* ── State ── */
const[veh,setVeh]=useState([]);
const[delays,setDelays]=useState({}); // key -> delay_seconds, null = no data
const[at,setAt]=useState({A:true,T:true,M:true});
const[rf,setRf]=useState('');
const[rl,setRl]=useState({A:[],T:[],M:[]});
const[trips,setTrips]=useState({A:{},T:{},M:{}});
const[stops,setStops]=useState({});
const[bAll,setBAll]=useState({});
const[bRoute,setBR]=useState({});
const[sR,setSR]=useState({});
const[cals,setCals]=useState({});
const[cDts,setCd]=useState({});
const[mRM,setMRM]=useState({});
const[fi,setFi]=useState({});
const[loading,setLoading]=useState(true);
const[lastUpd,setLastUpd]=useState(null);
const[gpsTs,setGpsTs]=useState({});
const[clock,setClock]=useState('');
const[alerts,setAlerts]=useState([]);
const[jams,setJams]=useState([]);
const[staleDays,setStaleDays]=useState(0);

/* Panels */
const[shAl,setShAl]=useState(false);
const[pSt,setPSt]=useState(false);
const[pSc,setPSc]=useState(false);
const[pGh,setPGh]=useState(false);
const[pDo,setPDo]=useState(false);
const[pStat,setPStat]=useState(false);
const[showStops,setShowStops]=useState(false); // show all stops on map
const[selSt,setSelSt]=useState(null);
const[ss,setSs]=useState('');
const[deps,setDeps]=useState([]);
const[dl2,setDl2]=useState(false);
const[scR,setScR]=useState(null);
const[scD,setScD]=useState(null);
const[scTs,setScTs]=useState([]);
const[scSel,setScSel]=useState(null);
const[gh,setGh]=useState([]);
const[shW,setShW]=useState(true);
const[shRef,setShRef]=useState(false);
const[refSt,setRefSt]=useState('');
const[refCool,setRefCool]=useState(0);

/* Driver */
const[drv,setDrv]=useState(false);
const[dT,setDT]=useState('A');
const[dR,setDR]=useState('');
const[dD,setDD]=useState(0);
const[dB,setDB]=useState('');
const[dPos,setDPos]=useState(null);
const[dDel,setDDel]=useState(null);
const[dST,setDST]=useState(null);
const[dNx,setDNx]=useState(null);
const[dPrev,setDPrev]=useState(null);
const[dNN,setDNN]=useState(null);
const[dDist,setDDist]=useState(null);
const wRef=useRef(null);

/* ── Clock ── */
useEffect(()=>{const iv=setInterval(()=>{const d=new Date();setClock(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`);},500);return()=>clearInterval(iv);},[]);

/* ── Load static data ── */
useEffect(()=>{Promise.all([
  fetch('/data/route_list.json').then(r=>r.json()),
  fetch('/data/trips_A.json').then(r=>r.json()),
  fetch('/data/trips_T.json').then(r=>r.json()),
  fetch('/data/trips_M.json').then(r=>r.json()),
  fetch('/data/stops.json').then(r=>r.json()),
  fetch('/data/blocks_all.json').then(r=>r.json()),
  fetch('/data/block_route.json').then(r=>r.json()),
  fetch('/data/stop_routes.json').then(r=>r.json()),
  fetch('/data/calendars.json').then(r=>r.json()),
  fetch('/data/calendar_dates.json').then(r=>r.json()),
  fetch('/data/m_route_map.json').then(r=>r.json()),
  fetch('/data/feed_info.json').then(r=>r.json()),
]).then(([rl,tA,tT,tM,st,ba,br,sr,c,cd,mr,fi])=>{
  setRl(rl);setTrips({A:tA,T:tT,M:tM});setStops(st);setBAll(ba);setBR(br);setSR(sr);setCals(c);setCd(cd);setMRM(mr);setFi(fi);
  if(fi.updated)setStaleDays(Math.floor((Date.now()-new Date(fi.updated).getTime())/864e5));
});},[]);

/* ── Refresh ── */
useEffect(()=>{fetch('/api/refresh').then(r=>r.json()).then(d=>{if(d.cooldownRemaining>0)setRefCool(d.cooldownRemaining);if(d.daysSinceUpdate)setStaleDays(d.daysSinceUpdate);}).catch(()=>{});},[]);
useEffect(()=>{if(refCool<=0)return;const iv=setInterval(()=>setRefCool(p=>Math.max(0,p-1)),1000);return()=>clearInterval(iv);},[refCool]);
const doRefresh=useCallback(async token=>{setRefSt('Weryfikuję...');
  try{const r=await fetch('/api/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const d=await r.json();
    if(d.success){setRefSt('Aktualizacja uruchomiona! Dane za ~2-3 min.');setRefCool(2700);}else setRefSt(d.error||'Błąd');}catch{setRefSt('Błąd sieci');}
},[]);
useEffect(()=>{window.__hcb__=token=>doRefresh(token);return()=>{delete window.__hcb__;};},[doRefresh]);
useEffect(()=>{if(!shRef||refCool>0)return;const t=setTimeout(()=>{const el=document.getElementById('hcap');
  if(el&&window.hcaptcha){try{el.innerHTML='';window.hcaptcha.render(el,{sitekey:HCAP,callback:'__hcb__',theme:'dark'});}catch{}}},300);return()=>clearTimeout(t);},[shRef,refCool]);

/* ── Map init ── */
useEffect(()=>{if(mapI.current)return;
  const map=L.map(mapRef.current,{center:[50.06,19.945],zoom:13,zoomControl:false,attributionControl:false});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.control.attribution({position:'bottomleft',prefix:false}).addAttribution('© <a href="https://osm.org">OSM</a> · ZTP Kraków · krkgps.pl').addTo(map);
  mkL.current=L.layerGroup().addTo(map);stL.current=L.layerGroup().addTo(map);
  shpL.current=L.layerGroup().addTo(map);jamL.current=L.layerGroup().addTo(map);
  allStL.current=L.layerGroup().addTo(map);
  mapI.current=map;
  return()=>{map.remove();mapI.current=null;};
},[]);

/* ── Route resolver ── */
const resolveRoute=useCallback((type,tripId,rtRouteId)=>{
  const ti=trips[type]?.[tripId];
  if(ti?.[0]&&ti[0]!=='?')return ti[0];
  // Fallback: block_route map
  if(type==='A'||type==='T'){const bid=xBlock(tripId);if(bid){const r=bRoute[`${type}:${bid}`];if(r)return r;}}
  // M: routeId from RT
  if(type==='M'&&rtRouteId)return mRM[rtRouteId]||rtRouteId;
  return rtRouteId||'?';
},[trips,bRoute,mRM]);
const getBrig=useCallback((type,bid)=>bAll[`${type}:${bid}`]||bid||'',[bAll]);

/* ═══ FETCH DATA ═══ */
const fetchData=useCallback(async()=>{
  const ts=Object.entries(at).filter(([,v])=>v).map(([k])=>k);
  if(!ts.length){setVeh([]);setLoading(false);return;}
  try{
    const[vR,tR,aR]=await Promise.all([
      Promise.all(ts.map(t=>fetch(`/api/gtfs-rt?feed=vehicles_${t}`).then(r=>r.json()).then(d=>({t,e:d.entity||[],hts:d.header?.timestamp||0})).catch(()=>({t,e:[],hts:0})))),
      Promise.all(ts.map(t=>fetch(`/api/gtfs-rt?feed=trips_${t}`).then(r=>r.json()).then(d=>({t,e:d.entity||[]})).catch(()=>({t,e:[]})))),
      Promise.all(ts.map(t=>fetch(`/api/gtfs-rt?feed=alerts_${t}`).then(r=>r.json()).then(d=>(d.entity||[]).map(e=>({...e,_t:t}))).catch(()=>[]))),
    ]);
    const gt={};vR.forEach(({t,hts})=>{if(hts)gt[t]=hts;});setGpsTs(gt);

    /* ── Parse delays: use _computedDelay from server or explicit delay ── */
    const dl=new Map(); // use Map so we can distinguish "0" from "not present"
    tR.forEach(({t,e})=>e.forEach(x=>{
      if(!x.tripUpdate)return;
      const tid=x.tripUpdate.trip?.tripId||x.id;
      const key=`${t}:${tid}`;
      // Priority: _computedDelay (server-computed from absolute times) > explicit delay > STU delays
      let d=x.tripUpdate._computedDelay;
      if(d==null){d=x.tripUpdate.delay;}
      if(d==null||d===0){const stu=x.tripUpdate.stopTimeUpdate;
        if(stu?.length){for(const s of stu){const sd=s.arrival?.delay||s.departure?.delay;if(sd!=null&&sd!==0){d=sd;break;}}}}
      dl.set(key,d??0); // Store 0 explicitly — means "on time", not "no data"
    }));
    const dlObj={};dl.forEach((v,k)=>dlObj[k]=v);
    setDelays(dlObj);

    /* ── Parse vehicles ── */
    const now=Date.now()/1000;
    const allV=vR.flatMap(({t,e})=>e.filter(x=>x.vehicle?.position).map(x=>{
      const v=x.vehicle,tid=v.trip?.tripId||'',rtR=v.trip?.routeId||'';
      const ti=trips[t]?.[tid];
      const rn=resolveRoute(t,tid,rtR);
      const spd=v.position.speed||0,spdKmh=spd*3.6;
      const stale=isStale(v.timestamp);

      // Jam detection: compare with previous position
      const prev=prevPos.current.get(x.id);
      let inJam=false;
      if(prev&&spdKmh<5&&!stale){
        const dist=hav(prev.lat,prev.lng,v.position.latitude,v.position.longitude);
        const dt=Math.abs((v.timestamp||now)-prev.ts);
        if(dist<30&&dt>20&&v.currentStatus!==1)inJam=true;
      }
      prevPos.current.set(x.id,{lat:v.position.latitude,lng:v.position.longitude,ts:v.timestamp||now});

      const delay=dlObj[`${t}:${tid}`]??null; // null = no TripUpdate data
      const hasDelay=dl.has(`${t}:${tid}`);

      // Bearing/direction from vehicle data
      const bear=v.position.bearing||0;

      // Detour: check distance from nearest stop
      let onDetour=false;
      if(ti&&v.stopId){
        const nextStop=stops[`${t}:${v.stopId}`];
        if(nextStop){
          const distToStop=hav(v.position.latitude,v.position.longitude,nextStop[1],nextStop[2]);
          if(distToStop>2000&&spdKmh>10)onDetour=true; // >2km from next stop while moving
        }
      }

      return{id:x.id,type:t,tripId:tid,rn,hs:ti?.[1]||'',dir:ti?.[2]??0,
        bid:ti?.[3]||'',brig:getBrig(t,ti?.[3]||''),
        lat:v.position.latitude,lng:v.position.longitude,bear,spd,spdKmh,
        stId:v.stopId||'',status:SM[v.currentStatus]||'IN_TRANSIT_TO',
        ts:v.timestamp||0,lp:v.vehicle?.licensePlate||'',
        inJam,stale,delay,hasDelay,onDetour};
    }));
    setVeh(allV);

    /* ── Traffic jams: 4+ slow vehicles in <200m ── */
    const slowV=allV.filter(v=>v.inJam&&v.rn!=='?');
    const jc=[],used=new Set();
    slowV.forEach((v,i)=>{if(used.has(i))return;const cl=[v];used.add(i);
      slowV.forEach((v2,j)=>{if(!used.has(j)&&hav(v.lat,v.lng,v2.lat,v2.lng)<200){cl.push(v2);used.add(j);}});
      if(cl.length>=4){
        const cLat=cl.reduce((s,c)=>s+c.lat,0)/cl.length;
        const cLng=cl.reduce((s,c)=>s+c.lng,0)/cl.length;
        jc.push({lat:cLat,lng:cLng,count:cl.length,routes:[...new Set(cl.map(c=>c.rn))]});}});

    /* ── Line-level congestion: 4+ vehicles on same route with >4min delay ── */
    const routeDelays={};
    allV.forEach(v=>{if(v.hasDelay&&v.delay>240&&v.rn!=='?'){
      const k=v.rn;if(!routeDelays[k])routeDelays[k]=[];routeDelays[k].push(v);}});
    Object.entries(routeDelays).forEach(([rn,vs])=>{
      if(vs.length>=4){
        // Calculate center and direction
        const lat=vs.reduce((s,v)=>s+v.lat,0)/vs.length;
        const lng=vs.reduce((s,v)=>s+v.lng,0)/vs.length;
        jc.push({lat,lng,count:vs.length,routes:[rn],isLine:true,
          avgDelay:Math.round(vs.reduce((s,v)=>s+v.delay,0)/vs.length)});}});
    setJams(jc);

    /* ── Alerts ── */
    setAlerts(aR.flat().filter(e=>e.alert).map(e=>{const a=e.alert;
      return{type:e._t,header:a.headerText?.translation?.[0]?.text||'',
        desc:a.descriptionText?.translation?.[0]?.text||'',
        routes:(a.informedEntity||[]).map(i=>i.routeId).filter(Boolean)};
    }).filter(a=>a.header||a.desc));

    setLastUpd(new Date());setLoading(false);
  }catch(e){console.error('Fetch:',e);setLoading(false);}
},[at,trips,resolveRoute,getBrig,stops]);

useEffect(()=>{fetchData();const iv=setInterval(fetchData,REFRESH_INTERVAL);return()=>clearInterval(iv);},[fetchData]);

const isAct=useCallback((type,sid)=>{const today=tds(),dow=new Date().getDay();
  const exc=cDts[type]?.[sid]||[];for(const[d,e]of exc){if(d===today){if(e===1)return true;if(e===2)return false;}}
  const c=cals[type]?.[sid];if(!c)return false;if(today<c.start||today>c.end)return false;return c.days[dow===0?6:dow-1]===1;},[cals,cDts]);

/* ── Ghosts ── */
useEffect(()=>{if(!pGh)return;const wg=new Set(veh.map(v=>`${v.type}:${v.tripId}`));const gs=[];
  Object.keys(delays).forEach(k=>{if(wg.has(k))return;const[t,...r]=k.split(':');const tid=r.join(':');if(!at[t])return;
    const rn=resolveRoute(t,tid,'');if(rf&&rn!==rf)return;const ti=trips[t]?.[tid];
    gs.push({type:t,rn,hs:ti?.[1]||'',delay:delays[k]||0,brig:getBrig(t,ti?.[3]||'')});});
  gs.sort((a,b)=>{const ia=parseInt(a.rn),ib=parseInt(b.rn);if(!isNaN(ia)&&!isNaN(ib))return ia-ib;return a.rn.localeCompare(b.rn);});setGh(gs);
},[pGh,veh,delays,trips,at,rf,resolveRoute,getBrig]);

/* ── Stats ── */
const stats=useMemo(()=>{if(!pStat||!veh.length)return{top:[],avg:{},n:0};const rd={};
  veh.forEach(v=>{if(!v.hasDelay)return;const k=`${v.type}:${v.rn}`;if(!rd[k])rd[k]={type:v.type,rn:v.rn,ds:[],n:0};rd[k].ds.push(v.delay);rd[k].n++;});
  const top=Object.values(rd).map(r=>({...r,avg:r.ds.reduce((a,b)=>a+b,0)/r.ds.length,max:Math.max(...r.ds),late:r.ds.filter(d=>d>240).length})).sort((a,b)=>b.avg-a.avg).slice(0,15);
  const avg={};['A','T','M'].forEach(t=>{const vs=veh.filter(v=>v.type===t&&v.hasDelay);const ds=vs.map(v=>v.delay);avg[t]=ds.length?Math.round(ds.reduce((a,b)=>a+b,0)/ds.length):0;});
  return{top,avg,n:veh.length};},[pStat,veh]);

const filt=useMemo(()=>veh.filter(v=>{if(!at[v.type])return false;if(rf&&v.rn!==rf)return false;return true;}),[veh,at,rf]);

/* ── Show all stops on map ── */
useEffect(()=>{if(!allStL.current)return;allStL.current.clearLayers();
  if(!showStops||!mapI.current)return;
  const zoom=mapI.current.getZoom();if(zoom<14)return;
  const bounds=mapI.current.getBounds();
  for(const[k,v]of Object.entries(stops)){
    if(v[1]<bounds.getSouth()||v[1]>bounds.getNorth()||v[2]<bounds.getWest()||v[2]>bounds.getEast())continue;
    const[type]=k.split(':');
    const ic=L.divIcon({className:'',html:`<div class="stop-dot" style="background:${TC[type]};width:6px;height:6px;border-width:1px"></div>`,iconSize:[6,6],iconAnchor:[3,3]});
    const m=L.marker([v[1],v[2]],{icon:ic});
    const routes=sR[k]||[];
    m.bindTooltip(`<b>${v[0]}</b><br/>${TL[type]} · ${routes.slice(0,8).join(', ')}`,{direction:'top',offset:[0,-4]});
    m.on('click',()=>{setSelSt({key:k,name:v[0],lat:v[1],lng:v[2]});setPSt(true);setSs('');});
    m.addTo(allStL.current);
  }
},[showStops,stops,sR]);
// Refresh stops on map move
useEffect(()=>{if(!mapI.current||!showStops)return;const map=mapI.current;
  const fn=()=>{allStL.current?.clearLayers();
    if(map.getZoom()<14)return;const bounds=map.getBounds();
    for(const[k,v]of Object.entries(stops)){
      if(v[1]<bounds.getSouth()||v[1]>bounds.getNorth()||v[2]<bounds.getWest()||v[2]>bounds.getEast())continue;
      const[type]=k.split(':');
      const ic=L.divIcon({className:'',html:`<div class="stop-dot" style="background:${TC[type]};width:6px;height:6px;border-width:1px"></div>`,iconSize:[6,6],iconAnchor:[3,3]});
      L.marker([v[1],v[2]],{icon:ic}).bindTooltip(`<b>${v[0]}</b>`,{direction:'top'}).addTo(allStL.current);
    }};
  map.on('moveend',fn);return()=>map.off('moveend',fn);
},[showStops,stops]);

/* ── Shapes ── */
useEffect(()=>{if(!shpL.current)return;shpL.current.clearLayers();if(!rf)return;
  Object.entries(at).filter(([,v])=>v).forEach(([t])=>{fetch(`/data/shapes/${t}_${rf}.json`).then(r=>r.ok?r.json():null).then(d=>{
    if(!d||!shpL.current)return;d.forEach(pts=>{if(pts.length>=2)L.polyline(pts,{color:TC[t],weight:3,opacity:.3,dashArray:'6 4'}).addTo(shpL.current);});}).catch(()=>{});});},[rf,at]);

/* ── Jam markers ── */
useEffect(()=>{if(!jamL.current)return;jamL.current.clearLayers();
  jams.forEach(j=>{const sz=j.isLine?50:Math.min(60,24+j.count*6);
    const label=j.isLine?`Linia ${j.routes[0]}: ${j.count}× opóźniona`:`${j.count} pojazdów w zatorze`;
    const ic=L.divIcon({className:'',html:`<div class="jam-mk" style="width:${sz}px;height:${sz}px;${j.isLine?'border-color:rgba(255,140,0,.5);background:rgba(255,140,0,.1)':''}">⚠</div>`,iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]});
    L.marker([j.lat,j.lng],{icon:ic,zIndexOffset:500}).bindPopup(`<b style="color:var(--red)">${label}</b><br/>Linie: ${j.routes.join(', ')}${j.avgDelay?`<br/>Śr. opóźnienie: +${Math.round(j.avgDelay/60)} min`:''}`).addTo(jamL.current);});
},[jams]);

/* ═══ SMOOTH MARKERS WITH DIRECTION ARROWS ═══ */
useEffect(()=>{
  if(!mkL.current)return;
  const currentIds=new Set(filt.map(v=>v.id));

  // Remove markers for vehicles no longer visible
  markerMap.current.forEach((mk,id)=>{if(!currentIds.has(id)){mkL.current.removeLayer(mk);markerMap.current.delete(id);}});

  filt.forEach(v=>{
    const dm=v.hasDelay?Math.round(v.delay/60):null;
    const isLate=dm!==null&&dm>3;
    const cls=`vm vm-${v.type}${isLate?' vm-late':''}${v.inJam?' vm-jam':''}${v.stale?' vm-stale':''}`;

    // Arrow character based on bearing
    const arrows=['↑','↗','→','↘','↓','↙','←','↖'];
    const arrowIdx=Math.round(((v.bear%360)+360)%360/45)%8;
    const arrow=v.bear?arrows[arrowIdx]:'';

    const existing=markerMap.current.get(v.id);
    if(existing){
      // Smooth move existing marker
      existing.setLatLng([v.lat,v.lng]);
      const el=existing.getElement();
      if(el){const d=el.querySelector('.vm');if(d){d.className=cls;d.innerHTML=`${arrow?`<span style="font-size:9px;margin-right:1px">${arrow}</span>`:''}${v.rn}`;}}
    }else{
      // Create new marker
      const ic=L.divIcon({className:'',
        html:`<div class="${cls}">${arrow?`<span style="font-size:9px;margin-right:1px">${arrow}</span>`:''}${v.rn}</div>`,
        iconSize:[0,0],iconAnchor:[18,12]});
      const mk=L.marker([v.lat,v.lng],{icon:ic});

      // Popup content
      const sn=v.stId?(stops[`${v.type}:${v.stId}`]?.[0]||v.stId):'—';
      const si=v.status==='STOPPED_AT'?'Na przystanku':v.status==='INCOMING_AT'?'Dojeżdża do':'W trasie do';
      const delayTxt=v.hasDelay?(dm>0?`<b style="color:var(--red)">${fds(v.delay)}</b>`:dm<0?`<b style="color:var(--green)">${fds(v.delay)}</b>`:`<b style="color:var(--gold)">0 min</b>`):'<span style="color:var(--text3)">brak danych</span>';
      const age=fmtAge(v.ts);

      mk.bindPopup(`<div style="min-width:230px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="background:${TC[v.type]};padding:4px 14px;border-radius:7px;font:700 17px var(--mono);color:#fff">${v.rn}</span>
          <div><div style="font-weight:700;font-size:14px">${v.hs||'—'}</div>
          <div style="font-size:10px;color:var(--text3)">${TL[v.type]} · kierunek ${v.dir}</div></div></div>
        <div style="font-size:12px;line-height:2.2;color:var(--text2)">
          ${si}: <b style="color:var(--text)">${sn}</b><br/>
          Prędkość: <b style="color:var(--text)">${v.spdKmh.toFixed(0)} km/h</b>
          ${v.lp?`<br/>Pojazd: <b style="color:var(--text)">${v.lp}</b>`:''}
          ${v.brig?`<br/>Brygada: <b style="color:var(--text)">${v.brig}</b>`:''}
          <br/>Opóźnienie: ${delayTxt}
          ${v.inJam?'<br/><b style="color:var(--red)">W korku</b>':''}
          ${v.onDetour?'<br/><b style="color:var(--gold)">Objazd</b>':''}
          ${v.stale?'<br/><b style="color:var(--text3)">GPS nieaktualny</b>':''}
          <br/><span style="color:var(--text3)">GPS: ${age}</span></div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button onclick="window.__oS__('${v.type}','${v.rn}','${v.tripId}')" style="flex:1;padding:7px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font:600 12px var(--font);cursor:pointer">Rozkład</button>
          <button onclick="window.__nav__('${v.type}','${v.tripId}')" style="flex:1;padding:7px;border-radius:8px;background:#1a5c30;border:1px solid #2a7b45;color:#fff;font:600 12px var(--font);cursor:pointer">Nawigacja</button>
        </div></div>`,{closeButton:true,maxWidth:320});
      mk.addTo(mkL.current);
      markerMap.current.set(v.id,mk);
    }
  });
},[filt,stops]);

/* ── Popup handlers ── */
useEffect(()=>{
  window.__oS__=(t,r,tid)=>{setScR({type:t,route:r});setPSc(true);setPSt(false);setScSel(tid);};
  window.__nav__=(type,tripId)=>{
    const ti=trips[type]?.[tripId];if(!ti)return;
    fetch(`/data/st/${type}_${ti[0]}.json`).then(r=>r.ok?r.json():null).then(data=>{
      if(!data?.[tripId])return;
      const coords=data[tripId].map(s=>{const si=stops[`${type}:${s[0]}`];return si?[si[1],si[2]]:null;}).filter(Boolean);
      const url=gmapsUrl(coords);if(url)window.open(url,'_blank');
    });
  };
  return()=>{delete window.__oS__;delete window.__nav__;};
},[trips,stops]);

/* ── Stop search & departures ── */
const ssr=useMemo(()=>{if(!ss||ss.length<2)return[];const q=ss.toLowerCase(),res=[];
  for(const[k,v]of Object.entries(stops)){if(v[0].toLowerCase().includes(q)){const[t]=k.split(':');res.push({key:k,type:t,name:v[0],lat:v[1],lng:v[2],routes:sR[k]||[]});if(res.length>=25)break;}}
  const seen=new Set();return res.filter(r=>{if(seen.has(r.key))return false;seen.add(r.key);return true;});},[ss,stops,sR]);

const loadDeps=useCallback(async sk=>{setDl2(true);setDeps([]);const routes=sR[sk]||[];
  const[type]=sk.split(':'),sid=sk.substring(sk.indexOf(':')+1),n=nsc(),all=[];
  await Promise.all(routes.map(route=>fetch(`/data/st/${type}_${route}.json`).then(r=>r.ok?r.json():null).then(data=>{
    if(!data)return;for(const[tid,sts]of Object.entries(data)){const ti=trips[type]?.[tid];if(!ti||!isAct(type,ti[4]))continue;
      for(const s of sts){if(s[0]===sid&&s[1]>=n-120&&s[1]<=n+7200){all.push({type,route,tid,hs:ti[1],dir:ti[2],time:s[1],delay:delays[`${type}:${tid}`]??null});break;}}}}).catch(()=>{})));
  all.sort((a,b)=>a.time-b.time);setDeps(all);setDl2(false);},[sR,trips,delays,isAct]);
useEffect(()=>{if(selSt)loadDeps(selSt.key);},[selSt,loadDeps]);

/* ── Schedule ── */
useEffect(()=>{if(!scR)return;fetch(`/data/st/${scR.type}_${scR.route}.json`).then(r=>r.ok?r.json():null).then(data=>{
  if(!data){setScD(null);setScTs([]);return;}setScD(data);const n=nsc(),td=trips[scR.type]||{};
  const tl=Object.entries(data).map(([tid,sts])=>{const ti=td[tid];if(!ti||!isAct(scR.type,ti[4]))return null;
    return{tid,hs:ti[1],dir:ti[2],ft:sts[0]?.[1]||0,lt:sts[sts.length-1]?.[1]||0};}).filter(Boolean).filter(t=>t.lt>=n-600).sort((a,b)=>a.ft-b.ft);
  setScTs(tl);if(!scSel||!data[scSel]){const c=tl.find(t=>t.ft<=n&&t.lt>=n)||tl[0];if(c)setScSel(c.tid);}});},[scR,trips,isAct]);

const sTS=useMemo(()=>{if(!scD||!scSel)return[];const sts=scD[scSel];if(!sts)return[];
  return sts.map(s=>({sid:s[0],time:s[1],name:stops[`${scR?.type}:${s[0]}`]?.[0]||s[0],lat:stops[`${scR?.type}:${s[0]}`]?.[1],lng:stops[`${scR?.type}:${s[0]}`]?.[2]}));},[scD,scSel,stops,scR]);

useEffect(()=>{if(!stL.current)return;stL.current.clearLayers();if(!pSc||!sTS.length)return;
  sTS.forEach(s=>{if(!s.lat)return;const n=nsc(),isA=Math.abs(s.time-n)<120;
    const ic=L.divIcon({className:'',html:`<div class="stop-dot${isA?' act':''}"></div>`,iconSize:[isA?16:8,isA?16:8],iconAnchor:[isA?8:4,isA?8:4]});
    L.marker([s.lat,s.lng],{icon:ic}).bindTooltip(`${s.name} (${ft(s.time)})`,{permanent:false,direction:'top',offset:[0,-4]}).addTo(stL.current);});},[pSc,sTS]);

/* ═══ DRIVER MODE ═══ */
useEffect(()=>{if(drv&&!wRef.current&&navigator.geolocation){
    wRef.current=navigator.geolocation.watchPosition(p=>setDPos({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy}),()=>{},{enableHighAccuracy:true,maximumAge:3000,timeout:10000});}
  if(!drv&&wRef.current){navigator.geolocation.clearWatch(wRef.current);wRef.current=null;}
  return()=>{if(wRef.current){navigator.geolocation.clearWatch(wRef.current);wRef.current=null;}};},[drv]);
useEffect(()=>{if(!drv||!dR||!dT){setDST(null);return;}
  fetch(`/data/st/${dT}_${dR}.json`).then(r=>r.ok?r.json():null).then(setDST).catch(()=>setDST(null));},[drv,dR,dT]);
useEffect(()=>{if(!drv||!dST||!dPos){setDDel(null);setDNx(null);setDPrev(null);setDNN(null);setDDist(null);return;}
  const n=nsc(),td=trips[dT]||{};
  const matching=Object.entries(dST).filter(([tid])=>{const ti=td[tid];if(!ti||ti[2]!==dD)return false;
    if(dB){const b=getBrig(dT,ti[3]);if(b!==dB&&ti[3]!==dB)return false;}return true;});
  let best=null,bestD=Infinity;
  for(const[tid,sts]of matching){if(!sts?.length)continue;if(n<sts[0][1]-1800||n>sts[sts.length-1][1]+1800)continue;
    for(const s of sts){const si=stops[`${dT}:${s[0]}`];if(!si)continue;const d=(si[1]-dPos.lat)**2+(si[2]-dPos.lng)**2;if(d<bestD){bestD=d;best=[tid,sts];}}}
  if(!best){setDDel(null);setDNx(null);setDPrev(null);setDNN(null);setDDist(null);return;}
  const[,sts]=best;let cI=0,cD=Infinity;
  for(let i=0;i<sts.length;i++){const si=stops[`${dT}:${sts[i][0]}`];if(!si)continue;const d=(si[1]-dPos.lat)**2+(si[2]-dPos.lng)**2;if(d<cD){cD=d;cI=i;}}
  const cur=sts[cI],curSi=stops[`${dT}:${cur[0]}`];
  setDNx({name:curSi?.[0]||cur[0],time:cur[1],idx:cI,total:sts.length});setDDel(n-cur[1]);
  setDPrev(cI>0?{name:stops[`${dT}:${sts[cI-1][0]}`]?.[0]||'',time:sts[cI-1][1]}:null);
  setDNN(cI<sts.length-1?{name:stops[`${dT}:${sts[cI+1][0]}`]?.[0]||'',time:sts[cI+1][1]}:null);
  setDDist(curSi?Math.round(hav(dPos.lat,dPos.lng,curSi[1],curSi[2])):null);
},[drv,dST,dPos,dD,dB,dT,trips,stops,getBrig]);

/* ── Computed ── */
const allR=useMemo(()=>{const r=[];Object.entries(at).forEach(([t,on])=>{if(on&&rl[t])rl[t].forEach(x=>{if(!r.includes(x))r.push(x);});});return r;},[at,rl]);
const dRoutes=rl[dT]||[];
const dBr=useMemo(()=>{if(!dR||!dT)return[];const td=trips[dT]||{},seen=new Set(),list=[];
  Object.values(td).forEach(i=>{if(i[0]!==dR)return;const b=getBrig(dT,i[3]);if(b&&!seen.has(b)){seen.add(b);list.push(b);}});return list.sort();},[dR,dT,trips,getBrig]);
const dHs=useMemo(()=>{if(!dR||!dT)return['Kier. 0','Kier. 1'];const td=trips[dT]||{},h={0:new Set(),1:new Set()};
  Object.values(td).forEach(i=>{if(i[0]===dR&&i[1])h[i[2]]?.add(i[1]);});
  return[h[0].size?[...h[0]][0]:'Kier. 0',h[1].size?[...h[1]][0]:'Kier. 1'];},[dR,dT,trips]);

useEffect(()=>{if(!mapI.current)return;const map=mapI.current;
  const fn=e=>{if(drv)return;let b=null,bD=0.002;for(const[k,v]of Object.entries(stops)){const d=Math.abs(v[1]-e.latlng.lat)+Math.abs(v[2]-e.latlng.lng);if(d<bD){bD=d;b={key:k,name:v[0],lat:v[1],lng:v[2]};}}
    if(b&&map.getZoom()>=14){setSelSt(b);setPSt(true);setSs('');}};map.on('click',fn);return()=>map.off('click',fn);},[stops,drv]);

const apiBase=typeof window!=='undefined'?window.location.origin:'';
const closeAll=()=>{setPSt(false);setPSc(false);setPGh(false);setPDo(false);setPStat(false);setShAl(false);};
const hasWarn=alerts.length>0||jams.length>0;

/* ═══════════════════ RENDER ═══════════════════ */
return(
<div style={{width:'100vw',height:'100dvh',position:'relative'}}>
{/* Map always alive */}
<div ref={mapRef} id="mc" style={drv?{position:'fixed',opacity:0,pointerEvents:'none'}:{}}/>

{/* ═══ DRIVER OVERLAY ═══ */}
{drv&&<div className="drv-overlay">
  <div className="dt">
    <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
      {dR?<span className="dlb" style={{background:TC[dT]}}>{dR}</span>:<span style={{color:'var(--text3)',fontSize:18}}>—</span>}
      {dNx&&<span style={{fontSize:13,color:'var(--text2)',fontFamily:'var(--font)'}}>{dHs[dD]}</span>}
      {dB&&<span style={{fontSize:11,color:'var(--text3)',background:'rgba(255,255,255,.04)',padding:'4px 12px',borderRadius:8,border:'1px solid #14203a'}}>Bryg: {dB}</span>}
    </div>
    <div className="dck">{clock}</div>
    <button className="dex" onClick={()=>setDrv(false)}>✕</button>
  </div>
  <div className="dcf">
    <select className="sel" value={dT} onChange={e=>{setDT(e.target.value);setDR('');setDB('');}}>
      <option value="A">Autobus</option><option value="T">Tramwaj</option><option value="M">Mobilis</option></select>
    <select className="sel" value={dR} onChange={e=>{setDR(e.target.value);setDB('');}}>
      <option value="">Linia</option>{dRoutes.map(r=><option key={r} value={r}>{r}</option>)}</select>
    <select className="sel" value={dD} onChange={e=>setDD(parseInt(e.target.value))}>
      <option value={0}>{dHs[0]}</option><option value={1}>{dHs[1]}</option></select>
    {dBr.length>0&&<select className="sel" value={dB} onChange={e=>setDB(e.target.value)}>
      <option value="">Brygada</option>{dBr.map(b=><option key={b} value={b}>{b}</option>)}</select>}
  </div>
  <div className="dm">
    {dDel!==null&&dNx?(<>
      {dPrev&&<div className="d-sub" style={{opacity:.4}}>Poprzedni: {dPrev.name} ({ft(dPrev.time)})</div>}
      <div className="d-lbl">Przystanek {dNx.idx+1} / {dNx.total}</div>
      <div className="d-stop">{dNx.name}</div>
      {dDist!==null&&<div style={{fontSize:15,color:dDist<50?'var(--green)':dDist<200?'var(--gold)':'var(--text2)',fontFamily:'var(--mono)',fontWeight:600}}>
        {dDist>=1000?`${(dDist/1000).toFixed(1)} km`:`${dDist} m`}</div>}
      <div className="d-bar"><div className="d-bar-f" style={{width:`${Math.min(100,(dNx.idx/dNx.total)*100)}%`}}/></div>
      <div className="d-big" style={{color:dDel>60?'var(--red)':dDel<-60?'var(--green)':'var(--gold)'}}>{fd(dDel)}</div>
      <div className="d-big-sub">{dDel>120?'OPÓŹNIENIE':dDel<-120?'PRZED ROZKŁADEM':'W ROZKŁADZIE'}</div>
      {dNN&&<div className="d-sub" style={{opacity:.4,marginTop:4}}>Następny: {dNN.name} ({ft(dNN.time)})</div>}
    </>):dR?<div style={{fontSize:18,color:'var(--text2)'}}>{!dPos?'Czekam na GPS...':'Szukam kursu...'}</div>
    :<div style={{fontSize:18,color:'var(--text3)'}}>Wybierz linię i kierunek</div>}
  </div>
  <div className="d-grid">
    <div className="d-cell"><div className="d-cell-l">Rozkład</div><div className="d-cell-v">{dNx?ft(dNx.time):'—'}</div></div>
    <div className="d-cell"><div className="d-cell-l">Dystans</div><div className="d-cell-v" style={{fontSize:16}}>{dDist!=null?(dDist>=1000?`${(dDist/1000).toFixed(1)}km`:`${dDist}m`):'—'}</div></div>
    <div className="d-cell"><div className="d-cell-l">GPS</div><div className="d-cell-v" style={{fontSize:14}}>{dPos?`±${dPos.acc?.toFixed(0)}m`:'brak'}</div></div>
    <div className="d-cell"><div className="d-cell-l">Brygada</div><div className="d-cell-v" style={{fontSize:14}}>{dB||'—'}</div></div>
  </div>
</div>}

{/* ═══ WELCOME ═══ */}
{shW&&!loading&&<div className="mo" onClick={()=>setShW(false)}><div className="mod" onClick={e=>e.stopPropagation()}>
  <h2>KRK<span style={{color:'var(--gold)'}}>GPS</span></h2>
  <p>Komunikacja miejska w Krakowie — pozycje pojazdów na żywo.</p>
  <p style={{fontSize:12,background:'rgba(255,184,48,.06)',border:'1px solid rgba(255,184,48,.15)',borderRadius:10,padding:'10px 14px'}}>
    <b style={{color:'var(--gold)'}}>Uwaga:</b> Pozycje GPS mogą być nieprecyzyjne. Starsze pojazdy mogą nie nadawać GPS.</p>
  {hasWarn&&<div style={{background:'rgba(255,82,82,.06)',border:'1px solid rgba(255,82,82,.15)',borderRadius:10,padding:'10px 14px',fontSize:12}}>
    {alerts.length>0&&<div><b style={{color:'var(--red)'}}>{alerts.length} komunikatów ZTP</b></div>}
    {jams.length>0&&<div><b style={{color:'var(--gold)'}}>{jams.length} zatorów</b></div>}</div>}
  <button className="mob" onClick={()=>setShW(false)}>Pokaż mapę</button>
</div></div>}

{/* ═══ HEADER — responsive ═══ */}
{!drv&&<div className="header fi">
  {/* Row 1: logo + counter */}
  <div style={{display:'flex',alignItems:'center',gap:8,width:'100%'}}>
    <div className="logo"><span className="logo-dot"/><span>KRK</span><span style={{color:'var(--gold)'}}>GPS</span></div>
    <span className="cnt">{filt.length}</span>
    {lastUpd&&<span style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)',marginLeft:'auto'}}>{lastUpd.toLocaleTimeString('pl-PL')}</span>}
  </div>
  {/* Row 2: type filters + route select */}
  <div style={{display:'flex',gap:4,flexWrap:'wrap',width:'100%'}}>
    {Object.entries(TL).map(([t,l])=><button key={t} className={`btn ${at[t]?'btn-'+t:''}`} onClick={()=>setAt(p=>({...p,[t]:!p[t]}))} style={{padding:'4px 10px',flex:'1 1 auto',justifyContent:'center'}}>{l}</button>)}
    <select className="sel" value={rf} onChange={e=>setRf(e.target.value)} style={{flex:'1 1 80px'}}>
      <option value="">Wszystkie</option>{allR.map(r=><option key={r} value={r}>{r}</option>)}</select>
  </div>
  {/* Row 3: action buttons */}
  <div style={{display:'flex',gap:4,flexWrap:'wrap',width:'100%'}}>
    <button className={`btn ${pSt?'on':''}`} onClick={()=>{closeAll();setPSt(!pSt);}} style={{flex:'1 1 auto',justifyContent:'center'}}>Odjazdy</button>
    <button className={`btn ${shAl?'on':''}`} onClick={()=>{closeAll();setShAl(!shAl);}} style={{position:'relative',flex:'1 1 auto',justifyContent:'center'}}>
      Alerty{hasWarn&&<span className="alert-dot"/>}</button>
    <button className={`btn ${pStat?'on':''}`} onClick={()=>{closeAll();setPStat(!pStat);}} style={{flex:'1 1 auto',justifyContent:'center'}}>Statystyki</button>
    <button className={`btn ${showStops?'on':''}`} onClick={()=>setShowStops(!showStops)} style={{flex:'1 1 auto',justifyContent:'center'}}>Przystanki</button>
    <button className={`btn ${pGh?'on':''}`} onClick={()=>{closeAll();setPGh(!pGh);}} style={{flex:'1 1 auto',justifyContent:'center'}}>Bez GPS</button>
    <button className={`btn ${pDo?'on':''}`} onClick={()=>{closeAll();setPDo(!pDo);}} style={{flex:'1 1 auto',justifyContent:'center'}}>API</button>
    <button className="btn" onClick={()=>setShRef(true)} style={{flex:'1 1 auto',justifyContent:'center'}}>
      Odśwież{refCool>0&&<span style={{fontSize:8,color:'var(--gold)',marginLeft:2}}>{Math.ceil(refCool/60)}m</span>}</button>
    <button className="btn" onClick={()=>setDrv(true)} style={{flex:'1 1 auto',justifyContent:'center'}}>Kierowca</button>
  </div>
</div>}

{/* Stale banner */}
{staleDays>=2&&!shW&&!drv&&<div className="stale" onClick={()=>setShRef(true)}>
  <b>⚠</b><span>Rozkład nieaktualny ({staleDays} dni). Kliknij aby zaktualizować.</span></div>}

{/* ═══ SIDE PANELS ═══ */}
{!drv&&<>
{/* Alerts + jams */}
{shAl&&<div className="sp right"><div className="sp-h"><span style={{fontWeight:700}}>Alerty i korki</span><span className="cnt">{alerts.length+jams.length}</span><button className="xb" onClick={()=>setShAl(false)}>✕</button></div>
  <div className="sp-b">
    {jams.map((j,i)=><div key={'j'+i} className="dep" style={{cursor:'default'}}>
      <span style={{color:'var(--red)',fontWeight:700}}>⚠</span>
      <div style={{flex:1}}><b>{j.count} pojazdów</b> {j.isLine?'opóźnionych':'w zatorze'}<br/>
        <span style={{color:'var(--text3)',fontSize:11}}>Linie: {j.routes.join(', ')}{j.avgDelay?` · śr. +${Math.round(j.avgDelay/60)} min`:''}</span></div></div>)}
    {alerts.map((a,i)=><div key={'a'+i} style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',fontSize:12}}>
      <div style={{display:'flex',gap:8,marginBottom:6,alignItems:'center'}}><span style={{color:'var(--red)',fontWeight:700,fontSize:10}}>ALERT</span>
        <span className={`badge badge-sm badge-${a.type}`}>{TL[a.type]}</span>
        {a.routes.length>0&&<span style={{fontSize:10,color:'var(--text3)'}}>Linie: {a.routes.join(', ')}</span>}</div>
      {a.header&&<div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{a.header}</div>}
      {a.desc&&<div style={{color:'var(--text2)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{a.desc.substring(0,500)}</div>}</div>)}
    {!alerts.length&&!jams.length&&<div style={{textAlign:'center',padding:40,color:'var(--text3)'}}>Brak alertów</div>}
  </div></div>}

{/* Stats */}
{pStat&&<div className="sp right"><div className="sp-h"><span style={{fontWeight:700}}>Statystyki</span><button className="xb" onClick={()=>setPStat(false)}>✕</button></div>
  <div className="sp-b" style={{padding:0}}>
    <div style={{padding:'16px 18px',borderBottom:'1px solid var(--border)'}}>
      <div style={{fontSize:11,color:'var(--text3)',marginBottom:10}}>Średnie opóźnienie wg typu</div>
      <div style={{display:'flex',gap:10}}>{Object.entries(stats.avg).map(([t,avg])=>
        <div key={t} style={{flex:1,textAlign:'center',background:'var(--bg)',borderRadius:10,padding:'12px 8px',border:'1px solid var(--border)'}}>
          <div style={{fontSize:10,color:TC[t],fontWeight:700}}>{TL[t]}</div>
          <div style={{font:'700 22px var(--mono)',color:avg>60?'var(--red)':avg>0?'var(--gold)':'var(--green)',marginTop:4}}>{avg>0?'+':''}{avg}s</div></div>)}</div>
      <div style={{fontSize:10,color:'var(--text3)',marginTop:12,lineHeight:1.8}}>
        GPS: {Object.entries(gpsTs).map(([t,ts])=>`${t}: ${new Date(ts*1000).toLocaleTimeString('pl-PL')}`).join(' · ')}<br/>
        Rozkład: A: {fi.A||'?'} · T: {fi.T||'?'} · M: {fi.M||'?'}
        {fi.updated&&<><br/>Zaktualizowano: {new Date(fi.updated).toLocaleString('pl-PL')}</>}</div></div>
    <div style={{padding:'10px 18px 6px',fontSize:11,color:'var(--text3)',fontWeight:600}}>Najbardziej opóźnione linie</div>
    {stats.top.map((r,i)=>{const am=Math.round(r.avg/60),bW=Math.min(100,Math.max(5,(r.avg/300)*100));
      return<div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 18px',borderBottom:'1px solid rgba(26,36,56,.2)',fontSize:12}}>
        <span className={`badge badge-sm badge-${r.type}`}>{r.rn}</span>
        <div style={{flex:1}}><div className="st-bar"><div className="st-fill" style={{width:`${bW}%`,background:am>5?'var(--red)':am>2?'var(--gold)':'var(--green)'}}/></div></div>
        <span style={{fontFamily:'var(--mono)',fontWeight:600,color:am>3?'var(--red)':'var(--gold)',minWidth:40,textAlign:'right'}}>{am>0?'+':''}{am}'</span>
        <span style={{fontSize:10,color:'var(--text3)'}}>{r.late}/{r.n} późno</span></div>})}
  </div></div>}

{/* Departures */}
{pSt&&<div className="sp left"><div className="sp-h"><span style={{fontWeight:700}}>Odjazdy</span><button className="xb" onClick={()=>setPSt(false)}>✕</button></div>
  <div style={{padding:'10px 16px',flexShrink:0,position:'relative'}}><span style={{position:'absolute',left:24,top:20,color:'var(--text3)',fontSize:14}}>⌕</span>
    <input className="si" placeholder="Szukaj przystanku..." value={ss} onChange={e=>setSs(e.target.value)}/></div>
  <div className="sp-b">
    {ss.length>=2&&!selSt&&ssr.map(s=><div key={s.key} className="dep" onClick={()=>{setSelSt(s);setSs('');mapI.current?.setView([s.lat,s.lng],16);}}>
      <span style={{color:'var(--gold)',fontSize:10}}>●</span>
      <div style={{flex:1}}><div style={{fontWeight:600}}>{s.name}</div><div style={{fontSize:10,color:'var(--text3)'}}>{TL[s.type]} · {s.routes.slice(0,5).join(', ')}</div></div></div>)}
    {selSt&&<><div style={{padding:'12px 18px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10}}>
      <span style={{color:'var(--gold)'}}>●</span><div style={{flex:1,fontWeight:700,fontSize:15}}>{selSt.name}</div>
      <button className="xb" style={{width:26,height:26}} onClick={()=>setSelSt(null)}>←</button></div>
      {dl2?<div style={{textAlign:'center',padding:40,color:'var(--text2)'}}>Ładuję...</div>:
      deps.length===0?<div style={{textAlign:'center',padding:40,color:'var(--text3)'}}>Brak odjazdów (2h)</div>:
      deps.slice(0,40).map((d,i)=>{const dm=d.delay!==null?Math.round(d.delay/60):null;const mt=Math.max(0,Math.round(((d.time+(d.delay||0))-nsc())/60));
        return<div key={i} className="dep" onClick={()=>window.__oS__?.(d.type,d.route,d.tid)}>
          <span className={`badge badge-${d.type}`}>{d.route}</span>
          <div style={{flex:1,fontSize:12}}>{d.hs||`K.${d.dir}`}</div>
          <div style={{fontFamily:'var(--mono)',fontWeight:600,fontSize:15}}>{ft(d.time)}</div>
          {dm!==null&&dm!==0&&<span className={`dc ${dm>0?'dc-l':'dc-e'}`}>{fds(d.delay)}</span>}
          <span style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:700,minWidth:34,textAlign:'right',
            color:mt<=1?'var(--red)':mt<=5?'var(--gold)':'var(--text)'}}>{mt<=0?'»':mt+"'"}</span></div>})}</>}
    {!ss&&!selSt&&<div style={{textAlign:'center',padding:40,color:'var(--text3)'}}>Wyszukaj lub kliknij mapę (zoom≥14)</div>}
  </div></div>}

{/* Schedule */}
{pSc&&scR&&<div className="sp right"><div className="sp-h"><span className={`badge badge-${scR.type}`}>{scR.route}</span><span style={{fontWeight:600}}>Rozkład</span>
  <button className="xb" onClick={()=>{setPSc(false);setScR(null);stL.current?.clearLayers();}}>✕</button></div>
  {scTs.length>0&&<div style={{padding:'8px 16px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
    <select className="sel" style={{width:'100%'}} value={scSel||''} onChange={e=>setScSel(e.target.value)}>
      {scTs.map(t=><option key={t.tid} value={t.tid}>{ft(t.ft)}→{ft(t.lt)} {t.hs} (k.{t.dir})</option>)}</select></div>}
  <div className="sp-b">{sTS.length>0?sTS.map((s,i)=>{const n=nsc(),isA=Math.abs(s.time-n)<120,isP=s.time<n-60;
    return<div key={i} className={`sr${isA?' act':''}${isP?' prev':''}`}>
      <div className="sr-n">{i+1}</div><div style={{flex:1,fontWeight:isA?700:400}}>{s.name}</div>
      <div style={{fontFamily:'var(--mono)',fontWeight:600}}>{ft(s.time)}</div></div>})
    :<div style={{textAlign:'center',padding:40,color:'var(--text3)'}}>Brak kursów</div>}</div></div>}

{/* Ghosts */}
{pGh&&<div className="sp right"><div className="sp-h"><span style={{fontWeight:700}}>Bez GPS</span><span className="cnt">{gh.length}</span><button className="xb" onClick={()=>setPGh(false)}>✕</button></div>
  <div className="sp-b">{gh.length===0?<div style={{textAlign:'center',padding:40,color:'var(--text3)'}}>Brak</div>:
    gh.map((g,i)=>{const dm=Math.round(g.delay/60);return<div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 18px',borderBottom:'1px solid rgba(26,36,56,.2)',fontSize:12,opacity:.6}}>
    <span className={`badge badge-sm badge-${g.type}`}>{g.rn}</span><span style={{flex:1}}>{g.hs}</span>
    {g.brig&&<span style={{fontSize:10,color:'var(--text3)'}}>{g.brig}</span>}
    {dm!==0&&<span style={{fontFamily:'var(--mono)',fontSize:11,color:dm>0?'var(--red)':'var(--green)'}}>{fds(g.delay)}</span>}</div>})}</div></div>}

{/* API Docs */}
{pDo&&<div className="sp right docs"><div className="sp-h"><span style={{fontWeight:700}}>API</span><button className="xb" onClick={()=>setPDo(false)}>✕</button></div>
  <div className="sp-b" style={{padding:'16px 20px'}}>
    <h3>Pojazdy JSON (CORS)</h3><pre>{`GET ${apiBase}/api/vehicles\nGET ${apiBase}/api/vehicles?type=T\nGET ${apiBase}/api/vehicles?route=102`}</pre>
    <h3>GTFS-RT Proxy</h3><pre>{`GET ${apiBase}/api/gtfs-rt?feed=vehicles_A\nGET ${apiBase}/api/gtfs-rt?feed=trips_T`}</pre>
    <p style={{marginTop:12,fontSize:10,color:'var(--text3)'}}>krkgps.pl · ZTP Kraków</p></div></div>}
</>}

{/* Refresh modal */}
{shRef&&<div className="mo" onClick={()=>setShRef(false)}><div className="mod" onClick={e=>e.stopPropagation()}>
  <h2>Aktualizuj rozkłady</h2>
  <p>Pobierz nowe rozkłady z ZTP. Przebudowa trwa ~2-3 min.</p>
  <div style={{fontSize:11,color:'var(--text3)',marginBottom:14,background:'var(--bg)',borderRadius:10,padding:'12px',border:'1px solid var(--border)',lineHeight:1.8}}>
    A: {fi.A||'?'}<br/>T: {fi.T||'?'}<br/>M: {fi.M||'?'}
    {fi.updated&&<><br/>Zaktualizowano: {new Date(fi.updated).toLocaleString('pl-PL')}</>}
    {staleDays>=2&&<><br/><b style={{color:'var(--red)'}}>Nieaktualne ({staleDays} dni)</b></>}</div>
  {refCool>0?<div style={{textAlign:'center',padding:24}}>
    <div style={{fontSize:40,fontFamily:'var(--mono)',fontWeight:700,color:'var(--gold)'}}>{Math.floor(refCool/60)}:{String(refCool%60).padStart(2,'0')}</div>
    <div style={{fontSize:12,color:'var(--text2)',marginTop:8}}>Odczekaj</div></div>
  :<div style={{display:'flex',justifyContent:'center',padding:'12px 0'}}><div id="hcap" style={{minHeight:78}}/></div>}
  {refSt&&<div style={{marginTop:12,padding:'10px',borderRadius:10,background:'var(--bg)',border:'1px solid var(--border)',fontSize:12,color:'var(--text2)',textAlign:'center'}}>{refSt}</div>}
  <button style={{width:'100%',padding:12,borderRadius:10,background:'var(--bg3)',border:'1px solid var(--border)',color:'var(--text2)',cursor:'pointer',marginTop:16,fontSize:13}} onClick={()=>setShRef(false)}>Zamknij</button>
</div></div>}

{loading&&<div style={{position:'absolute',inset:0,zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(4,6,10,.97)'}}>
  <div style={{textAlign:'center'}}><div className="logo" style={{fontSize:28,marginBottom:12,justifyContent:'center'}}><span className="logo-dot"/>KRK<span style={{color:'var(--gold)'}}>GPS</span></div>
  <div style={{color:'var(--text2)'}}>Ładowanie...</div></div></div>}
</div>);
}
