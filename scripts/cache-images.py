#!/usr/bin/env python3
"""
cache-images.py — download remote photos into assets/img/ and repoint the data.

The planner never hotlinks other sites' images. Each item's `image` field should
be a LOCAL path like "assets/img/<hash>.jpg". This script finds any `image` that
is still a remote http(s) URL, downloads it, resizes/compresses it into
assets/img/, and rewrites the field to the local path.

Run it after adding a new item with a remote image URL:
    python3 scripts/cache-images.py

Requires Pillow:  pip install pillow
"""
import json, hashlib, io, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMGDIR = os.path.join(ROOT, "assets", "img")
MAXW = 900          # max width in px
QUALITY = 82

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  pip install pillow")

# (file, path-to-list-or-object). "*" marks a single object rather than a list.
TARGETS = [
    ("data/destinations.json", ["destinations"]),
    ("data/medora.json", ["attractions"]),
    ("data/lodging.json", ["lodging"]),
    ("data/library.json", ["generalAdmission", "*"]),
    ("data/library.json", ["tours"]),
]

os.makedirs(IMGDIR, exist_ok=True)
cache = {}   # remote url -> local rel path


def localize(url):
    if not url or not url.startswith("http"):
        return url
    if url in cache:
        return cache[url]
    h = hashlib.md5(url.encode()).hexdigest()[:10]
    fn = os.path.join(IMGDIR, h + ".jpg")
    rel = "assets/img/%s.jpg" % h
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=30).read()
        im = Image.open(io.BytesIO(data)).convert("RGB")
        w, hh = im.size
        if w > MAXW:
            im = im.resize((MAXW, round(hh * MAXW / w)))
        im.save(fn, "JPEG", quality=QUALITY, optimize=True)
        cache[url] = rel
        print("cached", rel, "<-", url[:70])
        return rel
    except Exception as e:
        print("FAIL  ", url[:70], "-", str(e)[:60])
        return url


def walk(obj):
    if isinstance(obj, dict):
        if "image" in obj:
            obj["image"] = localize(obj["image"])
        for v in obj.values():
            walk(v)
    elif isinstance(obj, list):
        for v in obj:
            walk(v)


seen_files = set()
for fname, _ in TARGETS:
    if fname in seen_files:
        continue
    seen_files.add(fname)
    p = os.path.join(ROOT, fname)
    j = json.load(open(p))
    walk(j)
    json.dump(j, open(p, "w"), indent=2, ensure_ascii=False)
    open(p, "a").write("\n")
    print("updated", fname)

print("\nDone. %d unique images in assets/img/" % len(cache))
