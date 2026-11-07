"""
Brand-from-URL font helper. Reads one JSON job on stdin, prints one JSON line on stdout (the last line is the answer).

  {"mode": "inspect", "fonts": [{"id": "a", "b64": "..."}]}
      -> {"ok": true, "fonts": [{"id","family","subfamily","weight","italic","variable","wghtRange","glyphs","hasLatin","error"}]}
  {"mode": "convert", "b64": "...", "weight": 700, "renderFamily": "BrandFontab12cd34"}
      -> {"ok": true, "family","subfamily","weight","italic","variable","wghtRange","glyphs","hasLatin","instanced","renderFamily","ttfB64"}

Why: sharp's text renderer (Pango/FreeType) silently ignores a woff2 file and draws a fallback font, so a font found on a web
page has to be turned into a plain TTF/OTF first. fontTools (with brotli) is already installed for the Fonts tool.
A variable font is cut down to one static weight so the renderer does not just use its default instance.

The finished file is also RENAMED: family = renderFamily, style Regular, weight class 400. The renderer (fontconfig) picks a font by
family name and then weight, and fakes bold or light when the request and the file disagree, and a font registered under a shared name
("Montserrat Thin" for every instance of one variable font) collides with other brands' files. A unique plain-Regular name means
"ask for this family at normal weight" draws exactly the outlines in the file, with nothing synthesised.
"""

import base64
import io
import json
import sys

from fontTools.ttLib import TTFont


def _name(font, ids):
    table = font["name"]
    for i in ids:
        n = table.getDebugName(i)
        if n:
            return n
    return ""


def _describe(font):
    cmap = font.getBestCmap() or {}
    os2 = font["OS/2"] if "OS/2" in font else None
    weight = int(getattr(os2, "usWeightClass", 400) or 400)
    italic = bool(os2 and (os2.fsSelection & 1)) or "italic" in _name(font, [2, 17]).lower()
    wght = None
    if "fvar" in font:
        for axis in font["fvar"].axes:
            if axis.axisTag == "wght":
                wght = [axis.minValue, axis.maxValue]
    # an icon font has glyphs but not the plain letters; "has Latin" means it can draw a normal headline
    has_latin = all(c in cmap for c in (0x41, 0x61, 0x30))
    return {
        "family": _name(font, [16, 1]),
        "subfamily": _name(font, [17, 2]),
        "weight": weight,
        "italic": italic,
        "variable": "fvar" in font,
        "wghtRange": wght,
        "glyphs": len(font.getGlyphOrder()),
        "hasLatin": has_latin,
    }


def _rename(font, family, italic):
    """Give the font one unique plain name and a normal weight (see the note at the top)."""
    names = font["name"]
    for nid in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
        names.removeNames(nameID=nid)
    style = "Italic" if italic else "Regular"
    ps = family.replace(" ", "")
    for nid, value in ((1, family), (2, style), (3, ps + ";brand"), (4, family), (6, ps)):
        names.setName(value, nid, 3, 1, 0x409)
        names.setName(value, nid, 1, 0, 0)
    if "OS/2" in font:
        os2 = font["OS/2"]
        os2.usWeightClass = 400
        os2.fsSelection = (os2.fsSelection & ~0x21) | (0x01 if italic else 0x40)  # not bold; italic or regular
    if "head" in font:
        font["head"].macStyle = 1 if italic else 0


def _open(b64):
    return TTFont(io.BytesIO(base64.b64decode(b64)), lazy=False)


def inspect(job):
    out = []
    for item in job.get("fonts", []):
        row = {"id": item.get("id")}
        try:
            row.update(_describe(_open(item["b64"])))
        except Exception as e:  # a corrupt or unsupported file must not stop the others
            row["error"] = str(e)[:200]
        out.append(row)
    return {"ok": True, "fonts": out}


def convert(job):
    font = _open(job["b64"])
    info = _describe(font)
    instanced = False
    want = job.get("weight")
    if info["variable"] and info["wghtRange"] and want:
        try:
            from fontTools.varLib import instancer
            lo, hi = info["wghtRange"]
            font = instancer.instantiateVariableFont(font, {"wght": max(lo, min(hi, float(want)))})
            instanced = True
        except Exception:
            pass  # keep the variable font; it still draws at its default weight
    font.flavor = None  # woff/woff2 -> plain sfnt (TTF or OTF)
    render_family = job.get("renderFamily")
    if render_family:
        _rename(font, render_family, info["italic"])
    buf = io.BytesIO()
    font.save(buf)
    return {
        "ok": True,
        **info,  # family, subfamily, weight, italic, variable, wghtRange, glyphs, hasLatin of the file as it came
        "weight": int(want) if instanced and want else info["weight"],
        "instanced": instanced,
        "renderFamily": render_family,
        "ttfB64": base64.b64encode(buf.getvalue()).decode("ascii"),
    }


def main():
    try:
        job = json.loads(sys.stdin.read())
        result = inspect(job) if job.get("mode") == "inspect" else convert(job)
    except Exception as e:
        result = {"ok": False, "error": str(e)[:300]}
    sys.stdout.write(json.dumps(result) + "\n")


if __name__ == "__main__":
    main()
