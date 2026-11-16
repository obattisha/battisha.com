# Uploads ./site into the ASSETS KV namespace in chunks (keys = paths relative to site/).
import base64, json, os, sys, urllib.request
acct, ns = sys.argv[1], sys.argv[2]
root = "site"
CT = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",
      ".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon",
      ".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".eot":"application/vnd.ms-fontobject",
      ".mp3":"audio/mpeg",".xml":"application/xml",".webmanifest":"application/manifest+json",".scss":"text/plain"}
items = []
for d, _, fs in os.walk(root):
    for f in fs:
        p = os.path.join(d, f); key = os.path.relpath(p, root)
        ext = os.path.splitext(f)[1].lower()
        items.append({"key": key, "value": base64.b64encode(open(p,"rb").read()).decode(), "base64": True,
                      "metadata": {"ct": CT.get(ext, "text/html; charset=utf-8" if not ext else "application/octet-stream")}})
batch, size = [], 0
def send(b):
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/storage/kv/namespaces/{ns}/bulk",
        data=json.dumps(b).encode(), method="PUT", headers={"Authorization":"Bearer proxy-injected","Content-Type":"application/json"})
    r = json.load(urllib.request.urlopen(req)); print(len(b), r["success"], r.get("errors"))
for it in items:
    if batch and size + len(it["value"]) > 40_000_000: send(batch); batch, size = [], 0
    batch.append(it); size += len(it["value"])
if batch: send(batch)
print("total", len(items))
