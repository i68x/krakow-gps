// POST /api/refresh — triggers Vercel redeployment via Vercel REST API
// Env vars: HCAPTCHA_SECRET, VERCEL_TOKEN, VERCEL_PROJECT_ID
// No deploy hook needed — uses official Vercel API with token

import fs from 'fs';
import path from 'path';

const COOLDOWN_MS = 45 * 60 * 1000;

function getFeedInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'feed_info.json'), 'utf8')); }
  catch { return {}; }
}

function getLastUpdate() {
  const fi = getFeedInfo();
  return fi.updated ? new Date(fi.updated).getTime() : 0;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const fi = getFeedInfo();
  const lastMs = getLastUpdate();
  const elapsed = Date.now() - lastMs;
  const cool = Math.max(0, Math.ceil((COOLDOWN_MS - elapsed) / 1000));
  const days = lastMs ? Math.floor((Date.now() - lastMs) / 86400000) : 999;

  return Response.json({
    cooldownRemaining: cool, canRefresh: cool <= 0, daysSinceUpdate: days, stale: days >= 2, feedInfo: fi,
  }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' } });
}

export async function POST(request) {
  const SECRET = process.env.HCAPTCHA_SECRET;
  const VTOKEN = process.env.VERCEL_TOKEN;
  const PROJID = process.env.VERCEL_PROJECT_ID;

  if (!VTOKEN || !PROJID) {
    return Response.json({
      error: 'Brak konfiguracji. Ustaw VERCEL_TOKEN i VERCEL_PROJECT_ID w Vercel → Settings → Environment Variables.',
      help: 'VERCEL_TOKEN: wygeneruj na vercel.com/account/tokens. VERCEL_PROJECT_ID: znajdziesz w Settings → General.',
    }, { status: 500 });
  }

  // Global cooldown
  const elapsed = Date.now() - getLastUpdate();
  if (elapsed < COOLDOWN_MS) {
    const rem = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    return Response.json({ error: `Odczekaj jeszcze ${rem}s`, cooldownRemaining: rem }, { status: 429 });
  }

  // Verify hCaptcha
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }
  if (!body.token) return Response.json({ error: 'Brak tokenu hCaptcha' }, { status: 400 });

  if (SECRET) {
    try {
      const vr = await fetch('https://api.hcaptcha.com/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `response=${encodeURIComponent(body.token)}&secret=${encodeURIComponent(SECRET)}`,
      });
      const vd = await vr.json();
      if (!vd.success) return Response.json({ error: 'hCaptcha nieudana' }, { status: 403 });
    } catch (e) { return Response.json({ error: 'Błąd hCaptcha: ' + e.message }, { status: 500 }); }
  }

  // Trigger redeploy via Vercel API
  try {
    const teamId = process.env.VERCEL_TEAM_ID;
    let url = `https://api.vercel.com/v13/deployments`;
    if (teamId) url += `?teamId=${teamId}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VTOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'krakow-gps',
        project: PROJID,
        target: 'production',
        gitSource: { type: 'github', org: 'i68x', repo: 'krakow-gps', ref: 'main' },
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('Vercel API error:', res.status, txt);
      return Response.json({ error: `Vercel API: ${res.status}`, detail: txt.substring(0, 300) }, { status: 502 });
    }

    return Response.json({ success: true, message: 'Aktualizacja uruchomiona! Nowe rozkłady za ~2-3 min.' });
  } catch (e) {
    return Response.json({ error: 'Błąd: ' + e.message }, { status: 500 });
  }
}
