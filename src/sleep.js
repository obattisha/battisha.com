// "How much did Omar sleep last night?" — backend for the sleep section on the main page.
//
// Data comes from Omar's own Oura MCP server (the oura-mcp Worker), which this site talks to as an
// ordinary MCP client: it registered itself, Omar approved it once via /oura/connect, and the
// resulting MCP tokens live in the PRIVATE KV namespace (never served). Only the number of hours
// slept leaves this Worker — no bedtimes or other sleep data.
//
// Secrets / bindings:
//   OURA_CONNECT_KEY   random string; /oura/connect?key=… only works with it
//   OURA_MCP           service binding to the oura-mcp Worker (Worker-to-Worker without the public URL)

const MCP_ORIGIN = "https://oura-mcp.obattisha.workers.dev";
const CLIENT_KEY = "mcp_client";
const TOKENS_KEY = "mcp_tokens";
const CACHE_KEY = "sleep_hours";
const CACHE_MS = 10 * 60 * 1000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Requests to the MCP go over the service binding when there is one (Cloudflare can block a Worker
// from fetching another workers.dev Worker on the same account); otherwise over the public URL.
function mcpFetch(env, path, init) {
  const url = MCP_ORIGIN + path;
  if (!env.OURA_MCP) return fetch(url, init);
  // Service-binding requests carry no Host header, and the MCP handler rejects those
  // (DNS-rebinding protection), so set it to the MCP's public hostname.
  const req = new Request(url, init);
  req.headers.set("host", new URL(MCP_ORIGIN).host);
  return env.OURA_MCP.fetch(req);
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------- one-time connection (OAuth 2.1 + PKCE against the MCP server) ----------

async function client(env, redirectUri) {
  const saved = JSON.parse((await env.PRIVATE.get(CLIENT_KEY)) || "null");
  if (saved && saved.redirect_uri === redirectUri) return saved;
  const r = await mcpFetch(env, "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "battisha.com sleep section",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!r.ok) throw new Error(`MCP client registration failed (${r.status})`);
  const c = await r.json();
  const out = { client_id: c.client_id, redirect_uri: redirectUri };
  await env.PRIVATE.put(CLIENT_KEY, JSON.stringify(out));
  return out;
}

export async function ouraConnect(url, env) {
  if (!env.OURA_CONNECT_KEY || url.searchParams.get("key") !== env.OURA_CONNECT_KEY) return new Response("Nope.", { status: 403 });
  const redirectUri = `${url.origin}/oura/callback`;
  const c = await client(env, redirectUri);
  const state = crypto.randomUUID();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  await env.PRIVATE.put(`oauth_state:${state}`, verifier, { expirationTtl: 900 });
  const auth = new URL(MCP_ORIGIN + "/authorize");
  auth.search = new URLSearchParams({
    response_type: "code", client_id: c.client_id, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: "S256", state,
  }).toString();
  return Response.redirect(auth.toString(), 302);
}

export async function ouraCallback(url, env) {
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  const verifier = state && (await env.PRIVATE.get(`oauth_state:${state}`));
  if (!verifier) return new Response("Expired or invalid sign-in attempt. Start again from /oura/connect.", { status: 400 });
  await env.PRIVATE.delete(`oauth_state:${state}`);
  if (!code) return new Response(`Connection refused: ${url.searchParams.get("error") || "unknown error"}`, { status: 400 });
  const c = JSON.parse(await env.PRIVATE.get(CLIENT_KEY));
  const tokens = await tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: c.redirect_uri, client_id: c.client_id, code_verifier: verifier });
  await env.PRIVATE.put(TOKENS_KEY, JSON.stringify(tokens));
  await env.PRIVATE.delete(CACHE_KEY);
  return Response.redirect(`${url.origin}/main#sleep`, 302);
}

async function tokenRequest(env, params) {
  const r = await mcpFetch(env, "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!r.ok) throw new Error(`MCP token request failed (${r.status})`);
  const t = await r.json();
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000 };
}

async function accessToken(env, force = false) {
  const t = JSON.parse((await env.PRIVATE.get(TOKENS_KEY)) || "null");
  if (!t) return null;
  if (!force && t.expires_at - Date.now() > 60_000) return t.access_token;
  const c = JSON.parse(await env.PRIVATE.get(CLIENT_KEY));
  const fresh = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: c.client_id });
  if (!fresh.refresh_token) fresh.refresh_token = t.refresh_token;
  await env.PRIVATE.put(TOKENS_KEY, JSON.stringify(fresh));
  return fresh.access_token;
}

// ---------- calling the MCP tool ----------

// Streamable HTTP responses may be plain JSON or a short SSE stream; return the JSON-RPC message.
async function rpcResult(resp) {
  const text = await resp.text();
  if ((resp.headers.get("content-type") || "").includes("text/event-stream")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    return JSON.parse(data[data.length - 1]);
  }
  return JSON.parse(text);
}

async function callTool(env, token, name, args) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` };
  const post = (body, extra = {}) => mcpFetch(env, "/mcp", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "battisha.com", version: "1.0" } } });
  if (init.status === 401) { const e = new Error("unauthorized"); e.status = 401; throw e; }
  if (!init.ok) throw new Error(`MCP initialize failed (${init.status}): ${(await init.text()).slice(0, 300)}`);
  const session = init.headers.get("mcp-session-id");
  const extra = session ? { "mcp-session-id": session } : {};
  await rpcResult(init);
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, extra);
  const r = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, extra);
  if (!r.ok) throw new Error(`MCP tools/call failed (${r.status})`);
  const msg = await rpcResult(r);
  if (msg.error || msg.result?.isError) throw new Error(`MCP tool error: ${JSON.stringify(msg.error || msg.result.content).slice(0, 200)}`);
  return JSON.parse(msg.result.content[0].text);
}

// ---------- the summary: hours slept on the most recent night, nothing else ----------

const offsetOf = (iso) => { const m = /([+-])(\d{2}):(\d{2})$/.exec(iso); return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0; };
const localMinutes = (iso) => { const d = new Date(iso); return (((d.getUTCHours() * 60 + d.getUTCMinutes() + offsetOf(iso)) % 1440) + 1440) % 1440; };

// Pure so it can be tested with recorded data. Naps (starting 14:00–19:59 local) don't count.
export function summarize(sleep, now) {
  const nights = {};
  for (const p of sleep) {
    const start = localMinutes(p.bedtime_start);
    if (start >= 14 * 60 && start < 20 * 60) continue;
    nights[p.day] = (nights[p.day] || 0) + (p.total_sleep_duration || 0);
  }
  const days = Object.keys(nights).sort();
  if (!days.length) return { connected: true, hasData: false, generatedAt: now.toISOString() };
  const day = days[days.length - 1];
  const tz = offsetOf(sleep[sleep.length - 1].bedtime_start);
  const today = new Date(now.getTime() + tz * 60000).toISOString().slice(0, 10);
  return { connected: true, hasData: true, day, seconds: nights[day], isLastNight: day === today, generatedAt: now.toISOString() };
}

export async function sleepApi(env, ctx) {
  const cached = JSON.parse((await env.PRIVATE.get(CACHE_KEY)) || "null");
  if (cached && Date.now() - Date.parse(cached.generatedAt) < CACHE_MS) return json(cached);
  const now = new Date();
  const ymd = (d) => d.toISOString().slice(0, 10);
  const args = { collection: "sleep", start_date: ymd(new Date(now - 7 * 864e5)), end_date: ymd(new Date(now.getTime() + 864e5)) };
  try {
    let token = await accessToken(env);
    if (!token) return json({ connected: false });
    let sleep;
    try { sleep = await callTool(env, token, "get_collection", args); }
    catch (e) {
      if (e.status !== 401) throw e;
      token = await accessToken(env, true);           // token rejected early: refresh once and retry
      sleep = await callTool(env, token, "get_collection", args);
    }
    sleep.sort((a, b) => a.bedtime_start.localeCompare(b.bedtime_start));
    const out = summarize(sleep, now);
    ctx.waitUntil(env.PRIVATE.put(CACHE_KEY, JSON.stringify(out)));
    return json(out);
  } catch (e) {
    console.error("sleep api:", e.message);
    if (cached) return json({ ...cached, stale: true });
    return json({ connected: true, error: true }, 503);
  }
}
