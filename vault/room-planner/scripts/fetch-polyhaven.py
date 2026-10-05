"""Fetch the curated Poly Haven (CC0) furniture models into public/models/<id>/ (glTF + 1K textures), shrinking the textures so the app stays light.
Usage: python scripts/fetch-polyhaven.py [id ...]   (no ids = the curated set below)
Poly Haven asks for a descriptive User-Agent. Models are CC0 (public domain): https://polyhaven.com/license
"""
import io, json, os, sys, urllib.request
from PIL import Image

CURATED = ['modern_arm_chair_01', 'mid_century_lounge_chair', 'modern_coffee_table_01', 'sofa_02', 'dining_chair_02', 'wooden_display_shelves_01']
UA = {'User-Agent': 'VaultRoomPlanner/1.0 (curated model fetch; contact michaelbarrett@bluelily.com.au)'}
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'models')
MAX_SIDE = {'diff': 1024, 'other': 512}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return r.read()

def shrink(name, data):
    side = MAX_SIDE['diff'] if '_diff_' in name else MAX_SIDE['other']
    im = Image.open(io.BytesIO(data)).convert('RGB')
    if max(im.size) > side:
        k = side / max(im.size)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=82, optimize=True)
    return out.getvalue()

def fetch(asset):
    info = json.loads(get(f'https://api.polyhaven.com/info/{asset}'))
    files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))['gltf']['1k']['gltf']
    dest = os.path.join(OUT, asset)
    os.makedirs(os.path.join(dest, 'textures'), exist_ok=True)
    total = 0
    items = {f'{asset}_1k.gltf': files['url'], **{k: v['url'] for k, v in files['include'].items()}}
    for rel, url in items.items():
        data = get(url)
        if rel.endswith('.jpg'):
            data = shrink(rel, data)
        with open(os.path.join(dest, rel), 'wb') as f:
            f.write(data)
        total += len(data)
    meta = {'id': asset, 'name': info['name'], 'authors': list(info['authors'].keys()), 'url': f'https://polyhaven.com/a/{asset}', 'licence': 'CC0'}
    with open(os.path.join(dest, 'source.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    print(f'{asset}: {total/1024:.0f} KB  by {", ".join(meta["authors"])}')

if __name__ == '__main__':
    for a in (sys.argv[1:] or CURATED):
        fetch(a)
