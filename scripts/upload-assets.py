"""Uploads ./site into the SITE KV namespace — only files that changed since the last upload.

Cloudflare's free plan allows 1,000 KV writes a day, and re-uploading all ~60 files on every
deploy burns through that fast. So this keeps scripts/upload-manifest.json (path -> sha256 of the
uploaded content), uploads only new/changed files, and deletes keys for files removed from site/.
Commit the manifest after uploading so the next deploy (from any machine) knows what's live.

Usage (from the repo root):
  CLOUDFLARE_API_TOKEN=... python3 scripts/upload-assets.py ACCOUNT_ID NAMESPACE_ID
  python3 scripts/upload-assets.py ACCOUNT_ID NAMESPACE_ID --dry-run       # show what would change
  python3 scripts/upload-assets.py ACCOUNT_ID NAMESPACE_ID --mark-current  # record without uploading
  python3 scripts/upload-assets.py ACCOUNT_ID NAMESPACE_ID --no-purge      # skip the edge-cache purge
"""
import base64, hashlib, json, os, sys, urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--")]
flags = {a for a in sys.argv[1:] if a.startswith("--")}
acct, ns = args[0], args[1]
root = "site"
manifest_path = os.path.join("scripts", "upload-manifest.json")
token = os.environ.get("CLOUDFLARE_API_TOKEN", "proxy-injected")
api = f"https://api.cloudflare.com/client/v4/accounts/{acct}/storage/kv/namespaces/{ns}"
ZONE = "0a2f346747ed8ee9e0e2ef15e05dd3f5"   # battisha.com

CT = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
      ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
      ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".eot": "application/vnd.ms-fontobject",
      ".mp3": "audio/mpeg", ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".scss": "text/plain"}

def call(method, path, body):
    req = urllib.request.Request(api + path, data=json.dumps(body).encode(), method=method,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req))
    if not r.get("success"):
        sys.exit(f"KV {method} {path} failed: {r.get('errors')}")

local = {}
for d, _, fs in os.walk(root):
    for f in fs:
        p = os.path.join(d, f)
        local[os.path.relpath(p, root)] = p

try:
    manifest = json.load(open(manifest_path))
except FileNotFoundError:
    manifest = {}

changed, hashes = [], {}
for key, p in sorted(local.items()):
    data = open(p, "rb").read()
    hashes[key] = hashlib.sha256(data).hexdigest()
    if manifest.get(key) != hashes[key]:
        changed.append((key, data))
removed = sorted(set(manifest) - set(local))

print(f"{len(changed)} to upload, {len(removed)} to delete, {len(local) - len(changed)} unchanged")
for key, _ in changed: print("  +", key)
for key in removed: print("  -", key)
if "--dry-run" in flags:
    sys.exit(0)

if "--mark-current" not in flags:
    batch, size = [], 0
    def send(b):
        call("PUT", "/bulk", b)
    for key, data in changed:
        ext = os.path.splitext(key)[1].lower()
        item = {"key": key, "value": base64.b64encode(data).decode(), "base64": True,
                "metadata": {"ct": CT.get(ext, "text/html; charset=utf-8" if not ext else "application/octet-stream")}}
        if batch and size + len(item["value"]) > 40_000_000:
            send(batch); batch, size = [], 0
        batch.append(item); size += len(item["value"])
    if batch: send(batch)
    if removed: call("POST", "/bulk/delete", removed)

    # The Worker keeps files in Cloudflare's edge cache for a week, so purge exactly what changed.
    # KV can take up to ~60s to show new values everywhere; purging before that could let an edge
    # location re-cache the old file, so wait first.
    touched = [k for k, _ in changed] + removed
    if touched and "--no-purge" not in flags:
        import time
        print("waiting 65s for KV to propagate before purging the edge cache…")
        time.sleep(65)
        urls = []
        for k in touched:
            for host in ("battisha.com", "shorten.battisha.com"):
                urls.append(f"https://{host}/{k}")
        for i in range(0, len(urls), 30):          # the purge API takes up to 30 URLs per call
            req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/zones/{ZONE}/purge_cache",
                data=json.dumps({"files": urls[i:i + 30]}).encode(), method="POST",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
            r = json.load(urllib.request.urlopen(req))
            print("purged", len(urls[i:i + 30]), "URLs:", r.get("success"), r.get("errors") or "")

json.dump(hashes, open(manifest_path, "w"), indent=1, sort_keys=True)
print("manifest updated:", manifest_path)
