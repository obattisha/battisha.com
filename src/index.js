import { ouraConnect, ouraCallback, sleepApi } from "./sleep.js";
// battisha.com: static site + shortcode redirects (port of shortcode.php / shorten.php).
const SHORTCODE_RE = /^\/([a-zA-Z0-9]+)$/;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normalize = (u) => (/^https?:\/\//i.test(u) ? u : "http://" + u);


// A shortcode can't shadow a real page or file (site files are served before shortcodes).
async function isReserved(code, env) {
  if (["api", "shorten", "preview", "oura"].includes(code.toLowerCase())) return true;
  return (await env.SITE.get(code)) !== null || (await env.SITE.get(code + ".html")) !== null;
}

// Creates a shortcode; returns an error message string, or null on success.
async function createCode(env, code, target) {
  if (!/^[a-zA-Z0-9]{1,40}$/.test(code)) return "Short link must be letters and numbers only.";
  if (!target) return "You forgot where the link goes.";
  if (target.length > 2000) return "That URL is longer than this website. Impressive, but no.";
  if (await isReserved(code, env)) return `battisha.com/${code} is already a page on my site. Nice try.`;
  if (await env.SHORTCODES.get(code)) return `Someone already claimed battisha.com/${code}. Life is unfair.`;
  await env.SHORTCODES.put(code, normalize(target));
  return null;
}

// JSON API used by the shortener section on the main page.
async function shortenApi(req, env) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (req.method === "GET") return json({ count: (await env.SHORTCODES.list()).keys.length });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "That wasn't valid JSON." }, 400); }
  const code = String(body.shortcode || "").trim(), target = String(body.url || "").trim();
  const err = await createCode(env, code, target);
  if (err) return json({ error: err }, err.includes("claimed") || err.includes("already a page") ? 409 : 400);
  return json({ short: `https://battisha.com/${code}` }, 201);
}

async function listCodes(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.SHORTCODES.list({ cursor });
    for (const k of r.keys) out.push([k.name, await env.SHORTCODES.get(k.name)]);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return out;
}

async function adminPage(req, env) {
  // Creating, listing and deleting shortcodes is public by design (matches the original PHP tool).
  let msg = "";
  if (req.method === "POST") {
    const f = await req.formData();
    const action = f.get("action");
    const code = String(f.get("shortcode") || "").trim();
    if (action === "delete") {
      if (/^[a-zA-Z0-9]+$/.test(code)) { await env.SHORTCODES.delete(code); msg = `Deleted ${code}.`; }
    } else {
      const err = await createCode(env, code, String(f.get("url") || "").trim());
      msg = err ? `Error: ${err}` : "Shortcode created successfully.";
    }
  }
  const isError = msg.startsWith("Error");
  const rows = (await listCodes(env)).map(([k, v]) => `
      <tr>
        <td><a class="code" href="https://battisha.com/${esc(k)}" target="_blank" rel="noopener">battisha.com/${esc(k)}</a></td>
        <td class="target">${esc(v)}</td>
        <td><form method="post" onsubmit="return confirm('Delete battisha.com/${esc(k)}?')"><input type="hidden" name="action" value="delete"><input type="hidden" name="shortcode" value="${esc(k)}"><button class="del">Delete</button></form></td>
      </tr>`).join("");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Battisha Shortener</title>
<link rel="stylesheet" href="/css/battisha.css">
<link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png"><link rel="shortcut icon" href="/favicon/favicon.ico">
<meta name="theme-color" content="#ffc200">
<style>
  body { --bg: var(--yellow); }
  .wrap { width: 100%; max-width: 820px; margin: 0 auto; padding: 56px 20px 72px; }
  h1 { font-size: clamp(40px, 7vw, 72px); }
  .sub { color: rgba(20,20,20,.75); }
  h2 { font-family: var(--display); font-weight: 400; font-size: 30px; margin: 56px 0 16px; }
  form, .list { background: var(--card); border: 2px solid var(--ink); border-radius: 16px; box-shadow: 8px 8px 0 var(--ink); padding: 24px; margin: 28px 8px 0 0; }
  label { display: block; font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; margin: 0 0 6px; }
  .field { display: flex; align-items: stretch; border: 2px solid var(--ink); border-radius: 10px; overflow: hidden; margin-bottom: 18px; background: #fff; }
  .field span { padding: 12px 0 12px 14px; font-weight: 700; white-space: nowrap; }
  .field input { flex: 1; min-width: 0; border: 0; padding: 12px 14px 12px 2px; outline: none; background: transparent; font-family: var(--body); }
  .field.plain input { padding-left: 14px; }
  .field:focus-within { box-shadow: 0 0 0 4px rgba(255,194,0,.6); }
  form .btn { width: 100%; }
  .msg { padding: 12px 16px; border-radius: 10px; font-weight: 700; margin: 24px 8px 0 0; border: 2px solid var(--ink); }
  .msg.ok { background: #fff6d6; } .msg.err { background: #ffe3df; }
  .list { padding: 8px 20px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); text-align: left; padding: 12px 8px; border-bottom: 2px solid var(--ink); }
  td { padding: 12px 8px; border-bottom: 1px solid var(--rule); vertical-align: middle; }
  tr:last-child td { border-bottom: 0; }
  td.target { color: var(--muted); word-break: break-all; font-size: 15px; }
  a.code { font-family: var(--mono); font-weight: 600; white-space: nowrap; }
  .del { background: transparent; border: 2px solid var(--ink); border-radius: 99px; padding: 4px 14px; font-weight: 700; cursor: pointer; }
  .del:hover { background: var(--red); border-color: var(--red); color: #fff; }
  @media (max-width: 575px) { a.code { white-space: normal; word-break: break-all; } }
</style></head><body>
<header class="bar"><div class="bar-inner"><a href="https://battisha.com/main" title="battisha.com"><img class="logo" src="/images/logo-yellow.svg" alt="battisha.com"></a><a class="back" href="https://battisha.com/main#shorten">← back to the website</a></div></header>
<div class="wrap">
<p class="label"><b>↗</b> A public service</p>
<h1>Shorten a link</h1>
<p class="sub">Make a battisha.com short link. Anyone can add or remove them, so play nice.</p>
${msg ? `<p class="msg ${isError ? "err" : "ok"}">${esc(msg)}</p>` : ""}
<form method="post" autocomplete="off">
  <label for="shortcode">Short link</label>
  <div class="field"><span>battisha.com/</span><input name="shortcode" id="shortcode" required pattern="[a-zA-Z0-9]+" title="Letters and numbers only" placeholder="mylink"></div>
  <label for="url">Goes to</label>
  <div class="field plain"><input name="url" id="url" required placeholder="https://example.com/some/long/page"></div>
  <button type="submit" class="btn">Create short link</button>
</form>
<h2>All short links</h2>
<div class="list"><table><tr><th>Short link</th><th>Goes to</th><th></th></tr>${rows}</table></div>
</div></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// Static files live in the SITE KV namespace (uploaded by scripts/upload-assets.py), cached at the edge.
async function serveFile(req, env, ctx, pathname) {
  let key = decodeURIComponent(pathname).replace(/^\/+/, "").replace(/\/+$/, "");
  if (key === "") key = "index.html";
  const cacheKey = new Request(new URL("/" + key, req.url).toString());
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  let { value, metadata } = await env.SITE.getWithMetadata(key, "arrayBuffer");
  if (value === null && !key.includes(".")) ({ value, metadata } = await env.SITE.getWithMetadata(key + ".html", "arrayBuffer"));
  if (value === null) return null;
  const isHtml = (metadata?.ct || "").startsWith("text/html");
  const res = new Response(value, { headers: {
    "content-type": metadata?.ct || "application/octet-stream",
    "cache-control": isHtml ? "public, max-age=300" : "public, max-age=86400",
  } });
  // Only cache non-HTML at the edge: cached pages could outlive a deploy (KV takes ~60s to propagate,
  // so a purge right after upload can re-cache the old page). KV's own short cache keeps HTML fast.
  if (!isHtml) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.hostname === "www.battisha.com") { url.hostname = "battisha.com"; return Response.redirect(url.toString(), 301); }
    const path = url.pathname;

    // The shortener lives at shorten.battisha.com (as on the old host); battisha.com/shorten forwards there.
    if (url.hostname === "shorten.battisha.com") {
      if (path === "/" || path === "/shorten" || path === "/shorten.php") return adminPage(req, env);
      const file = await serveFile(req, env, ctx, path); // css/favicon used by the page
      return file || Response.redirect("https://shorten.battisha.com/", 302);
    }
    if (path === "/shorten" || path === "/shorten.php") return Response.redirect("https://shorten.battisha.com/", 301);
    if (path === "/preview") return Response.redirect(`${url.origin}/main`, 301);
    if (path === "/api/shorten") return shortenApi(req, env);
    if (path === "/api/sleep") return sleepApi(env, ctx);
    if (path === "/oura/connect") return ouraConnect(url, env);
    if (path === "/oura/callback") return ouraCallback(url, env);

    // Old site POSTed the joke form to the static "submit" page; serve it, store nothing.
    const asset = await serveFile(req, env, ctx, path);
    if (asset) return asset;

    const m = path.match(SHORTCODE_RE);
    if (m) {
      const target = await env.SHORTCODES.get(m[1]);
      if (target) return Response.redirect(normalize(target), 302);
      return Response.redirect(`${url.origin}/error?code=${m[1]}`, 302);
    }
    const errPage = await serveFile(req, env, ctx, "/error");
    return new Response(errPage.body, { status: 404, headers: errPage.headers });
  },
};
