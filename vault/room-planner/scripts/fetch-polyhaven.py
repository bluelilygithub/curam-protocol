"""Fetch the curated Poly Haven (CC0) assets into public/models/<id>/ (glTF + 1K textures), shrinking the textures so the app stays light.
Usage: python scripts/fetch-polyhaven.py [id ...]   (no ids = the curated set below)
  - a MODEL id downloads the glTF model;
  - a RUG id (RUGS below) downloads a Poly Haven fabric TEXTURE and builds a flat rug model from it (Poly Haven has no rug models), with the
    texture repeating across the rug.
Poly Haven asks for a descriptive User-Agent. Everything is CC0 (public domain): https://polyhaven.com/license
"""
import base64, io, json, os, struct, sys, urllib.request
from PIL import Image

CURATED = [
    'modern_arm_chair_01', 'mid_century_lounge_chair', 'modern_coffee_table_01', 'sofa_02', 'dining_chair_02', 'wooden_display_shelves_01',
    'GothicBed_01', 'metal_office_desk', 'ceramic_vase_01', 'modern_ceiling_lamp_01', 'ornate_mirror_01', 'fancy_picture_frame_01',
]
# rug folder -> (Poly Haven texture id, rug size in metres w x l x thickness, real size of one texture tile in metres)
RUGS = {'rug_poly_wool_herringbone': ('poly_wool_herringbone', (2.4, 1.7, 0.015), 0.3)}
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


def write_source(dest, asset, info, kind):
    meta = {'id': asset, 'name': info['name'], 'authors': list(info['authors'].keys()), 'url': f'https://polyhaven.com/a/{asset}', 'licence': 'CC0', 'kind': kind}
    with open(os.path.join(dest, 'source.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)
    return meta


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
    meta = write_source(dest, asset, info, 'model')
    print(f'{asset}: {total/1024:.0f} KB  by {", ".join(meta["authors"])}')


def rug_gltf(folder, w, l, t, tile, tex_files):
    """A box w x t x l (x across, y up, z along) with the texture repeating on the top and sides; UVs are in tiles."""
    hx, hz = w / 2, l / 2
    verts, norms, uvs, idx = [], [], [], []
    def face(p, n, u):  # p: 4 corners counter-clockwise seen from outside; u: 4 uvs
        base = len(verts)
        verts.extend(p); norms.extend([n] * 4); uvs.extend(u)
        idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    X, Z = w / tile, l / tile
    face([(-hx, t, hz), (hx, t, hz), (hx, t, -hz), (-hx, t, -hz)], (0, 1, 0), [(0, 0), (X, 0), (X, Z), (0, Z)])
    face([(-hx, 0, -hz), (hx, 0, -hz), (hx, 0, hz), (-hx, 0, hz)], (0, -1, 0), [(0, 0), (X, 0), (X, Z), (0, Z)])
    face([(-hx, 0, hz), (hx, 0, hz), (hx, t, hz), (-hx, t, hz)], (0, 0, 1), [(0, 0), (X, 0), (X, t / tile), (0, t / tile)])
    face([(hx, 0, -hz), (-hx, 0, -hz), (-hx, t, -hz), (hx, t, -hz)], (0, 0, -1), [(0, 0), (X, 0), (X, t / tile), (0, t / tile)])
    face([(hx, 0, hz), (hx, 0, -hz), (hx, t, -hz), (hx, t, hz)], (1, 0, 0), [(0, 0), (Z, 0), (Z, t / tile), (0, t / tile)])
    face([(-hx, 0, -hz), (-hx, 0, hz), (-hx, t, hz), (-hx, t, -hz)], (-1, 0, 0), [(0, 0), (Z, 0), (Z, t / tile), (0, t / tile)])
    pos = b''.join(struct.pack('<3f', *v) for v in verts)
    nor = b''.join(struct.pack('<3f', *v) for v in norms)
    uv = b''.join(struct.pack('<2f', *v) for v in uvs)
    ind = b''.join(struct.pack('<H', i) for i in idx)
    blob = pos + nor + uv + ind
    views = [
        {'buffer': 0, 'byteOffset': 0, 'byteLength': len(pos), 'target': 34962},
        {'buffer': 0, 'byteOffset': len(pos), 'byteLength': len(nor), 'target': 34962},
        {'buffer': 0, 'byteOffset': len(pos) + len(nor), 'byteLength': len(uv), 'target': 34962},
        {'buffer': 0, 'byteOffset': len(pos) + len(nor) + len(uv), 'byteLength': len(ind), 'target': 34963},
    ]
    acc = [
        {'bufferView': 0, 'componentType': 5126, 'count': len(verts), 'type': 'VEC3', 'min': [-hx, 0, -hz], 'max': [hx, t, hz]},
        {'bufferView': 1, 'componentType': 5126, 'count': len(verts), 'type': 'VEC3'},
        {'bufferView': 2, 'componentType': 5126, 'count': len(verts), 'type': 'VEC2'},
        {'bufferView': 3, 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'},
    ]
    return {
        'asset': {'version': '2.0', 'generator': 'vault room planner fetch-polyhaven.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': folder}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': [{'name': 'wool', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 1}, 'metallicFactor': 1, 'roughnessFactor': 1}, 'normalTexture': {'index': 2}}],
        'textures': [{'sampler': 0, 'source': i} for i in range(3)],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'images': [{'uri': f'textures/{f}'} for f in tex_files],
        'accessors': acc, 'bufferViews': views,
        'buffers': [{'uri': f'{folder}.bin', 'byteLength': len(blob)}],
    }, blob


def fetch_rug(folder):
    tex, (w, l, t), tile = RUGS[folder]
    info = json.loads(get(f'https://api.polyhaven.com/info/{tex}'))
    files = json.loads(get(f'https://api.polyhaven.com/files/{tex}'))
    dest = os.path.join(OUT, folder)
    os.makedirs(os.path.join(dest, 'textures'), exist_ok=True)
    total = 0
    names = []
    # colour, then roughness packed into the glTF metallic-roughness layout (green = roughness, blue = metal 0), then the normal map
    diff = shrink(f'{tex}_diff_1k.jpg', get(files['Diffuse']['1k']['jpg']['url']))
    rough = Image.open(io.BytesIO(get(files['Rough']['1k']['jpg']['url']))).convert('L')
    rough = rough.resize((512, 512), Image.LANCZOS) if max(rough.size) > 512 else rough
    mr = Image.merge('RGB', (Image.new('L', rough.size, 255), rough, Image.new('L', rough.size, 0)))
    buf = io.BytesIO(); mr.save(buf, 'JPEG', quality=82); mr_bytes = buf.getvalue()
    nor = shrink(f'{tex}_nor_gl_1k.jpg', get(files['nor_gl']['1k']['jpg']['url']))
    for name, data in ((f'{tex}_diff_1k.jpg', diff), (f'{tex}_rough_1k.jpg', mr_bytes), (f'{tex}_nor_gl_1k.jpg', nor)):
        with open(os.path.join(dest, 'textures', name), 'wb') as f:
            f.write(data)
        names.append(name); total += len(data)
    g, blob = rug_gltf(folder, w, l, t, tile, names)
    with open(os.path.join(dest, f'{folder}_1k.gltf'), 'w', encoding='utf-8') as f:
        json.dump(g, f)
    with open(os.path.join(dest, f'{folder}.bin'), 'wb') as f:
        f.write(blob)
    meta = write_source(dest, tex, info, 'texture-rug')
    meta['url'] = f'https://polyhaven.com/a/{tex}'
    print(f'{folder}: {total/1024:.0f} KB  (texture {tex}) by {", ".join(meta["authors"])}')


if __name__ == '__main__':
    for a in (sys.argv[1:] or CURATED + list(RUGS)):
        fetch_rug(a) if a in RUGS else fetch(a)
