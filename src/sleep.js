// "Is Omar asleep?" — Oura connection + sleep summary for battisha.com/sleep.
//
// The site has its own Oura OAuth connection (separate from the oura-mcp Worker), stored in the
// PRIVATE KV namespace. Oura only receives data when the ring syncs with the phone, so "asleep
// right now" is answered from fresh heart-rate data when there is some, and otherwise from Omar's
// usual sleep window.
//
// Secrets (Worker → Settings → Variables and Secrets):
//   OURA_CLIENT_ID, OURA_CLIENT_SECRET   from the Oura API application
//   OURA_CONNECT_KEY                     random string; /oura/connect?key=… only works with it

const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";
const API = "https://api.ouraring.com/v2/usercollection/";
const TOKENS_KEY = "oura_tokens";
const CACHE_KEY = "sleep_summary";
const CACHE_MS = 10 * 60 * 1000;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

// ---------- OAuth ----------

export async function ouraConnect(url, env) {
  if (!env.OURA_CLIENT_ID || !env.OURA_CONNECT_KEY) return new Response("Oura isn't configured yet.", { status: 503 });
  if (url.searchParams.get("key") !== env.OURA_CONNECT_KEY) return new Response("Nope.", { status: 403 });
  const state = crypto.randomUUID();
  await env.PRIVATE.put(`oauth_state:${state}`, "1", { expirationTtl: 600 });
  const auth = new URL(AUTHORIZE_URL);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", env.OURA_CLIENT_ID);
  auth.searchParams.set("redirect_uri", `${url.origin}/oura/callback`);
  auth.searchParams.set("scope", "daily heartrate");
  auth.searchParams.set("state", state);
  return Response.redirect(auth.toString(), 302);
}

export async function ouraCallback(url, env) {
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if (!state || !(await env.PRIVATE.get(`oauth_state:${state}`))) return new Response("Expired or invalid sign-in attempt. Start again from /oura/connect.", { status: 400 });
  await env.PRIVATE.delete(`oauth_state:${state}`);
  if (!code) return new Response(`Oura said no: ${url.searchParams.get("error") || "unknown error"}`, { status: 400 });
  const tokens = await postToken(env, { grant_type: "authorization_code", code, redirect_uri: `${url.origin}/oura/callback` });
  await env.PRIVATE.put(TOKENS_KEY, JSON.stringify(tokens));
  await env.PRIVATE.delete(CACHE_KEY);
  return Response.redirect(`${url.origin}/sleep`, 302);
}

async function postToken(env, params) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: env.OURA_CLIENT_ID, client_secret: env.OURA_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`Oura token request failed (${r.status})`);
  const t = await r.json();
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
}

async function accessToken(env) {
  const raw = await env.PRIVATE.get(TOKENS_KEY);
  if (!raw) return null;
  let t = JSON.parse(raw);
  if (t.expires_at - Date.now() < 60_000) {
    try {
      t = await postToken(env, { grant_type: "refresh_token", refresh_token: t.refresh_token });
      await env.PRIVATE.put(TOKENS_KEY, JSON.stringify(t));
    } catch (e) {
      // Refresh tokens are single-use: if a parallel request just refreshed, use what it stored.
      const again = JSON.parse((await env.PRIVATE.get(TOKENS_KEY)) || "null");
      if (again && again.expires_at - Date.now() > 60_000) return again.access_token;
      throw e;
    }
  }
  return t.access_token;
}

async function ouraGet(token, path, params) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Oura ${path} failed (${r.status})`);
  const out = [];
  let page = await r.json();
  out.push(...page.data);
  while (page.next_token) {
    const n = await fetch(`${API}${path}?${new URLSearchParams({ ...params, next_token: page.next_token })}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!n.ok) break;
    page = await n.json(); out.push(...page.data);
  }
  return out;
}

// ---------- the summary ----------

const ymd = (d) => d.toISOString().slice(0, 10);
const offsetOf = (iso) => { const m = /([+-])(\d{2}):(\d{2})$/.exec(iso); return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0; };
// minutes since local midnight for an ISO timestamp, in that timestamp's own offset
const localMinutes = (iso) => { const d = new Date(iso); const m = (d.getUTCHours() * 60 + d.getUTCMinutes() + offsetOf(iso)) % 1440; return (m + 1440) % 1440; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// Pure function so it can be tested with recorded data. `now` is a Date.
export function summarize({ sleep, dailySleep, heartRate }, now) {
  if (!sleep.length) return { connected: true, hasData: false };
  const tz = offsetOf(sleep[sleep.length - 1].bedtime_start);

  // Group periods by Oura "day", ignoring afternoon/evening naps (start 14:00–19:59 local).
  const byDay = {};
  for (const p of sleep) {
    const start = localMinutes(p.bedtime_start);
    if (start >= 14 * 60 && start < 20 * 60) continue;
    (byDay[p.day] ||= []).push(p);
  }
  const days = Object.keys(byDay).sort();
  const lastDay = days[days.length - 1];
  const periods = byDay[lastDay] || [];
  const total = periods.reduce((s, p) => s + (p.total_sleep_duration || 0), 0);
  const bed = periods.reduce((a, p) => (!a || p.bedtime_start < a ? p.bedtime_start : a), null);
  const wake = periods.reduce((a, p) => (!a || p.bedtime_end > a ? p.bedtime_end : a), null);
  const score = (dailySleep.find((d) => d.day === lastDay) || {}).score ?? null;

  // Usual window from the main sleeps of the last few weeks (minutes after 18:00 so midnight doesn't wrap).
  const mains = sleep.filter((p) => p.type === "long_sleep");
  const shift = (m) => (m - 18 * 60 + 1440) % 1440;
  const usualStart = median(mains.map((p) => shift(localMinutes(p.bedtime_start))));
  const usualEnd = median(mains.map((p) => shift(localMinutes(p.bedtime_end))));
  const nowLocal = shift(((now.getUTCHours() * 60 + now.getUTCMinutes() + tz) % 1440 + 1440) % 1440);
  const inWindow = usualStart != null && nowLocal >= usualStart && nowLocal < usualEnd;

  // Freshest heart-rate sample decides, if it's recent enough to mean anything.
  const latestHr = heartRate.length ? heartRate[heartRate.length - 1] : null;
  const hrAgeMin = latestHr ? Math.round((now - new Date(latestHr.timestamp)) / 60000) : null;
  let asleep, basis;
  if (latestHr && hrAgeMin <= 20) {
    basis = "live";
    asleep = latestHr.source === "sleep" ? "yes" : latestHr.source === "rest" ? (inWindow ? "yes" : "probably") : "no";
  } else {
    basis = "guess";
    asleep = inWindow ? "probably" : "probably_not";
  }
  const lastSync = [latestHr && latestHr.timestamp, wake].filter(Boolean).sort().pop() || null;
  const toClock = (m) => { if (m == null) return null; const t = (m + 18 * 60) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

  return {
    connected: true,
    hasData: true,
    asleep, basis,
    lastNight: { day: lastDay, seconds: total, periods: periods.length, bedtime: bed, wake, score },
    usual: { start: toClock(usualStart), end: toClock(usualEnd), nights: mains.length },
    lastSync, tzOffsetMinutes: tz,
    generatedAt: now.toISOString(),
  };
}

export async function sleepApi(env, ctx) {
  const cached = JSON.parse((await env.PRIVATE.get(CACHE_KEY)) || "null");
  if (cached && Date.now() - Date.parse(cached.generatedAt) < CACHE_MS) return json(cached);
  if (!env.PRIVATE) return json({ connected: false });
  let token;
  try { token = await accessToken(env); } catch (e) { return json({ connected: true, error: "Oura sign-in expired" }, 503); }
  if (!token) return json({ connected: false });
  const now = new Date();
  try {
    const start = ymd(new Date(now - 21 * 864e5)), end = ymd(new Date(now.getTime() + 864e5));
    const [sleep, dailySleep, heartRate] = await Promise.all([
      ouraGet(token, "sleep", { start_date: start, end_date: end }),
      ouraGet(token, "daily_sleep", { start_date: ymd(new Date(now - 7 * 864e5)), end_date: end }),
      ouraGet(token, "heartrate", { start_datetime: new Date(now - 3 * 3600e3).toISOString(), end_datetime: now.toISOString() }),
    ]);
    sleep.sort((a, b) => a.bedtime_start.localeCompare(b.bedtime_start));
    const out = summarize({ sleep, dailySleep, heartRate }, now);
    ctx.waitUntil(env.PRIVATE.put(CACHE_KEY, JSON.stringify(out)));
    return json(out);
  } catch (e) {
    if (cached) return json({ ...cached, stale: true });
    return json({ connected: true, error: "Couldn't reach Oura" }, 503);
  }
}
