// battisha.com: static site + shortcode redirects (port of shortcode.php / shorten.php).
const SHORTCODE_RE = /^\/([a-zA-Z0-9]+)$/;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normalize = (u) => (/^https?:\/\//i.test(u) ? u : "http://" + u);


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
    if (!/^[a-zA-Z0-9]+$/.test(code)) msg = "Error: shortcode must be letters/numbers only.";
    else if (action === "delete") {
      await env.SHORTCODES.delete(code); msg = `Deleted ${code}.`;
    }
    else if (await env.SHORTCODES.get(code)) msg = "Error: Shortcode already exists.";
    else { await env.SHORTCODES.put(code, normalize(String(f.get("url") || "").trim())); msg = "Shortcode created successfully."; }
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
<link rel="stylesheet" href="/css/bootstrap.min.css"><link rel="stylesheet" href="/css/tooplate-style.css">
<link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png"><link rel="shortcut icon" href="/favicon/favicon.ico">
<style>
  body { padding-top: 0; color: #353535; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 64px 16px; }
  h1 { font-weight: 700; margin-bottom: 4px; }
  h2 { font-weight: 700; font-size: 1.5rem; margin: 56px 0 16px; }
  .prefix { display: flex; align-items: center; gap: 8px; }
  .prefix span { font-weight: 700; white-space: nowrap; }
  .contact-form .form-control { margin: 8px 0 16px; }
  label { font-weight: 700; font-size: 14px; color: #5b5b5b; margin: 0; }
  .msg { padding: 12px 16px; border-radius: 8px; font-weight: 700; font-size: 16px; margin: 16px 0 0; }
  .msg.ok { background: #fff6d6; color: #6b5200; }
  .msg.err { background: #ffe6e6; color: #a31515; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: #8a8a8a; padding: 8px; border-bottom: 2px solid #ffc200; }
  td { padding: 12px 8px; border-bottom: 1px solid #eee; vertical-align: middle; }
  td.target { color: #5b5b5b; word-break: break-all; font-size: 15px; }
  a.code { font-weight: 700; color: #353535; white-space: nowrap; }
  .del { background: transparent; border: 1px solid #ddd; border-radius: 50px; padding: 4px 14px; font-weight: 700; color: #5b5b5b; cursor: pointer; transition: all .3s ease; }
  .del:hover { border-color: #e04848; color: #e04848; }
  @media (max-width: 575px) { a.code { white-space: normal; word-break: break-all; } .prefix { flex-direction: column; align-items: stretch; gap: 0; } }
</style></head><body><div class="wrap">
<h1>Shorten a link</h1>
<p class="small-text" style="padding-left:0">Make a battisha.com short link. Anyone can add or remove them, so play nice.</p>
${msg ? `<p class="msg ${isError ? "err" : "ok"}">${esc(msg)}</p>` : ""}
<form method="post" class="contact-form">
  <label for="shortcode">Short link</label>
  <div class="prefix"><span>battisha.com/</span><input class="form-control" name="shortcode" id="shortcode" required pattern="[a-zA-Z0-9]+" title="Letters and numbers only" placeholder="mylink" autocomplete="off"></div>
  <label for="url">Goes to</label>
  <input class="form-control" name="url" id="url" required placeholder="https://example.com/some/long/page" autocomplete="off">
  <input type="submit" class="form-control submit-btn" value="Create short link">
</form>
<h2>All short links</h2>
<div class="table-responsive"><table><tr><th>Short link</th><th>Goes to</th><th></th></tr>${rows}</table></div>
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

    // Old site POSTed the joke form to the static "submit" page; serve it, store nothing.
    const asset = await serveFile(req, env, ctx, path);
    if (asset) return asset;

    const m = path.match(SHORTCODE_RE);
    if (m) {
      const target = await env.SHORTCODES.get(m[1]);
      if (target) return Response.redirect(normalize(target), 302);
      return Response.redirect(`${url.origin}/error`, 302);
    }
    const errPage = await serveFile(req, env, ctx, "/error");
    return new Response(errPage.body, { status: 404, headers: errPage.headers });
  },
};
