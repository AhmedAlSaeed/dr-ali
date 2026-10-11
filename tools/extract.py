#!/usr/bin/env python3
"""Extract the AliFellow case-conference deck into web content.

Reads the .pptx (a ZIP of OOXML), walks the slides in presentation order and writes:

  public/content.json      every slide: role, text blocks, images, table, notes, reveal steps
  public/media/*.webp      images, resized for the web (originals are 39.5 MB)
  public/media/index.json  map of media file -> source part + pixel size

Deliberately faithful to the deck:
  * text keeps paragraph structure, bullet levels and inline bold/italic runs
  * images keep their slide geometry, so grids can be laid out as in the deck
  * the deck's click-to-reveal steps are carried over as `reveal` (shape role per click)
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import unescape

from PIL import Image
from xml.etree import ElementTree as ET

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

DECK = Path(sys.argv[1] if len(sys.argv) > 1
           else os.environ.get("DECK", Path.home() / "Downloads" / "AliFellow.pptx"))
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "public")
MAX_PX = 1600          # longest edge for web images
CURATED_FILE = Path(__file__).with_name("cases.json")   # hand-checked labels
META_FILE = Path(__file__).with_name("deck-meta.json")  # conference identity + front matter
CURATED = {c["n"]: c for c in json.loads(CURATED_FILE.read_text())["cases"]} \
    if CURATED_FILE.exists() else {}
QUALITY = 82
EMU_IN = 914400.0
SLIDE_W = 13.333
SLIDE_H = 7.5

# the Case Index slide this project replaces with a real index page
SKIP_TITLE = "Case Index"


def grouped_boxes(xml_text: str) -> dict[str, tuple[float, float, float, float]]:
    """cNvPr id -> slide-space box (EMU) for every shape nested in a group.

    A grouped shape's <a:off>/<a:ext> are in the group's child coordinate space, not the slide's,
    so using them directly puts the shape in the wrong place — the whole second row of an image
    grid can land on top of the first. Groups can nest, so the mapping is composed down the tree.
    """
    out: dict[str, tuple[float, float, float, float]] = {}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    sp_tree = root.find(".//p:cSld/p:spTree", NS)
    if sp_tree is None:
        return out

    def walk(parent, tf):
        for child in parent:
            tag = child.tag.split("}")[-1]
            if tag == "grpSp":
                xf = child.find("p:grpSpPr/a:xfrm", NS)
                if xf is None:
                    walk(child, tf)
                    continue
                off, ext = xf.find("a:off", NS), xf.find("a:ext", NS)
                ch_off, ch_ext = xf.find("a:chOff", NS), xf.find("a:chExt", NS)
                if None in (off, ext, ch_off, ch_ext) or int(ch_ext.get("cx")) == 0 or int(ch_ext.get("cy")) == 0:
                    walk(child, tf)
                    continue
                sx = int(ext.get("cx")) / int(ch_ext.get("cx"))
                sy = int(ext.get("cy")) / int(ch_ext.get("cy"))
                tx = int(off.get("x")) - int(ch_off.get("x")) * sx
                ty = int(off.get("y")) - int(ch_off.get("y")) * sy
                walk(child, (tf[0] * sx, tf[1] * sy, tf[0] * tx + tf[2], tf[1] * ty + tf[3]))
                continue
            if tag in ("sp", "pic", "graphicFrame"):
                if tf != (1.0, 1.0, 0.0, 0.0):
                    xf = child.find(".//a:xfrm", NS)
                    off = xf.find("a:off", NS) if xf is not None else None
                    ext = xf.find("a:ext", NS) if xf is not None else None
                    nv = None
                    for path in ("p:nvSpPr/p:cNvPr", "p:nvPicPr/p:cNvPr", "p:nvGraphicFramePr/p:cNvPr"):
                        found = child.find(path, NS)
                        if found is not None:
                            nv = found
                            break
                    if off is not None and ext is not None and nv is not None:
                        x0 = tf[0] * int(off.get("x")) + tf[2]
                        y0 = tf[1] * int(off.get("y")) + tf[3]
                        x1 = tf[0] * (int(off.get("x")) + int(ext.get("cx"))) + tf[2]
                        y1 = tf[1] * (int(off.get("y")) + int(ext.get("cy"))) + tf[3]
                        out[nv.get("id")] = (x0, y0, x1 - x0, y1 - y0)
                walk(child, tf)

    walk(sp_tree, (1.0, 1.0, 0.0, 0.0))
    return out


def part_images(z: zipfile.ZipFile, slide: str) -> dict[str, str]:
    """rId -> media part name, for one slide's relationships."""
    rels = f"ppt/slides/_rels/{Path(slide).name}.rels"
    if rels not in z.namelist():
        return {}
    out = {}
    for m in re.finditer(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', z.read(rels).decode("utf-8")):
        if "media/" in m.group(2):
            out[m.group(1)] = "ppt/" + m.group(2).replace("../", "")
    return out


def slide_order(z: zipfile.ZipFile) -> list[str]:
    pres = z.read("ppt/presentation.xml").decode("utf-8")
    rels = z.read("ppt/_rels/presentation.xml.rels").decode("utf-8")
    target = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels))
    return ["ppt/" + target[rid] for rid in
            re.findall(r'<p:sldId id="\d+" r:id="(rId\d+)"/>', pres)]


def notes_for(z: zipfile.ZipFile, slide: str) -> str:
    rels = f"ppt/slides/_rels/{Path(slide).name}.rels"
    if rels not in z.namelist():
        return ""
    m = re.search(r'Type="[^"]*notesSlide"[^>]*Target="([^"]+)"', z.read(rels).decode("utf-8"))
    if not m:
        return ""
    part = "ppt/" + m.group(1).replace("../", "")
    if part not in z.namelist():
        return ""
    xml = z.read(part).decode("utf-8")
    return " ".join(unescape(t) for t in re.findall(r"<a:t>(.*?)</a:t>", xml, re.S)).strip()


def blocks_from(xml: str) -> list[dict]:
    """Text of one shape -> [{level, paras:[[runs]]}] flattened into paragraphs."""
    paras = []
    for p in re.findall(r"<a:p>(.*?)</a:p>|<a:p/>", xml, re.S):
        if not p:
            continue
        lvl = re.search(r'<a:pPr[^>]*lvl="(\d+)"', p)
        runs = []
        for m in re.finditer(r"<a:r>(.*?)</a:r>|<a:br/>", p, re.S):
            chunk = m.group(1)
            if chunk is None:
                runs.append({"br": True})
                continue
            text = "".join(unescape(t) for t in re.findall(r"<a:t>(.*?)</a:t>", chunk, re.S))
            if not text:
                continue
            rpr = re.search(r"<a:rPr[^>]*/?>", chunk)
            attrs = rpr.group(0) if rpr else ""
            runs.append({
                "t": text,
                "b": ' b="1"' in attrs,
                "i": ' i="1"' in attrs,
                "sz": int(re.search(r'sz="(\d+)"', attrs).group(1)) / 100 if 'sz="' in attrs else None,
                "color": (re.search(r'<a:srgbClr val="([0-9A-Fa-f]{6})"', chunk).group(1)
                          if re.search(r'<a:srgbClr val="([0-9A-Fa-f]{6})"', chunk) else None),
            })
        if runs:
            ppr = re.search(r"<a:pPr[^>]*>", p) or re.search(r"<a:pPr[^>]*/>", p)
            tag = ppr.group(0) if ppr else ""
            if "<a:buNone" in p:
                bullet = "none"
            elif "<a:buAutoNum" in p:
                bullet = "num"
            elif "<a:buChar" in p:
                bullet = "char"
            else:
                bullet = None            # inherited from the layout placeholder
            mar = re.search(r'marL="(-?\d+)"', tag)
            ind = re.search(r'indent="(-?\d+)"', tag)
            algn = re.search(r'algn="(\w+)"', tag)
            bc = re.search(r'<a:buChar char="([^"]*)"', p)
            pct = re.search(r'<a:spcPct val="(\d+)"', p)
            bef = re.search(r'<a:spcBef>\s*<a:spcPts val="(\d+)"', p)
            paras.append({
                "lvl": int(lvl.group(1)) if lvl else 0, "runs": runs, "bullet": bullet,
                "char": unescape(bc.group(1)) if bc else None,
                "algn": algn.group(1) if algn else None,
                "marL": round(int(mar.group(1)) / EMU_IN, 3) if mar else None,
                "indent": round(int(ind.group(1)) / EMU_IN, 3) if ind else None,
                "lnSpcPct": int(pct.group(1)) / 100000 if pct else None,
                "spcBefPt": int(bef.group(1)) / 100 if bef else None,
            })
    return paras


def theme_colors(z: zipfile.ZipFile) -> tuple[dict[str, str], dict[str, str]]:
    """theme scheme name -> hex, and the master's clrMap (bg1 -> lt1, tx1 -> dk1, ...)."""
    scheme, cmap = {}, {}
    theme = next((n for n in z.namelist() if re.match(r"ppt/theme/theme\d+\.xml$", n)), None)
    if theme:
        xml = z.read(theme).decode("utf-8")
        block = re.search(r"<a:clrScheme.*?</a:clrScheme>", xml, re.S)
        if block:
            for m in re.finditer(
                    r'<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>\s*<(?:a:srgbClr val="(\w+)"|'
                    r'a:sysClr[^>]*lastClr="(\w+)")', block.group(0)):
                scheme[m.group(1)] = (m.group(2) or m.group(3)).upper()
    master = "ppt/slideMasters/slideMaster1.xml"
    if master in z.namelist():
        cm = re.search(r"<p:clrMap([^/]*)/>", z.read(master).decode("utf-8"))
        if cm:
            for m in re.finditer(r'(\w+)="(\w+)"', cm.group(1)):
                cmap[m.group(1)] = m.group(2)
    return scheme, cmap


def resolve_color(attrs: str, scheme: dict[str, str], cmap: dict[str, str]) -> str | None:
    m = re.search(r'<a:srgbClr val="([0-9A-Fa-f]{6})"', attrs)
    if m:
        return m.group(1).upper()
    m = re.search(r'<a:schemeClr val="(\w+)"', attrs)
    if m:
        return scheme.get(cmap.get(m.group(1), m.group(1)))
    m = re.search(r'<a:sysClr[^>]*lastClr="(\w+)"', attrs)
    return m.group(1).upper() if m else None


def _raw_box(node: str) -> tuple[float, float, float, float, float] | None:
    """Box as written in the file (no rotation compensation) plus the rotation in degrees."""
    xf = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', node)
    if not xf:
        return None
    rot = re.search(r'<a:xfrm[^>]*rot="(-?\d+)"', node)
    return (emu(xf.group(1)), emu(xf.group(2)), emu(xf.group(3)), emu(xf.group(4)),
            (int(rot.group(1)) / 60000) if rot else 0.0)


def _box(node: str) -> tuple[float, float, float, float] | None:
    """Geometry in inches, honouring a 90/270 degree rotation (this deck's footer bar is a
    rotated rectangle: its raw w/h are swapped relative to what you see)."""
    xf = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', node)
    if not xf:
        return None
    x, y, w, h = (int(xf.group(i)) for i in range(1, 5))
    rot = re.search(r'<a:xfrm[^>]*rot="(-?\d+)"', node)
    if rot:
        deg = (abs(int(rot.group(1))) / 60000) % 180
        if 45 < deg < 135:
            cx, cy = x + w / 2, y + h / 2
            w, h = h, w
            x, y = cx - w / 2, cy - h / 2
    return (emu(str(round(x))), emu(str(round(y))), emu(str(round(w))), emu(str(round(h))))


def chrome_shapes(z: zipfile.ZipFile, part: str, scheme, cmap) -> list[dict]:
    """Background chrome a slide inherits from its layout - bars, stripes, logos, overlays -
    in spTree order, so overlays stay on top of the artwork they tint."""
    items: list[dict] = []
    rels_path = f"{Path(part).parent}/_rels/{Path(part).name}.rels"
    rels = z.read(rels_path).decode("utf-8") if rels_path in z.namelist() else ""
    for m in re.finditer(r"<p:(sp|pic)>.*?</p:\1>", z.read(part).decode("utf-8"), re.S):
        node = m.group(0)
        box = _box(node)
        if not box or box[2] <= 0 or box[3] <= 0:
            continue
        if m.group(1) == "pic":
            blip = re.search(r'r:embed="(rId\d+)"', node)
            tm = re.search(r'Id="' + blip.group(1) + r'"[^>]*Target="([^"]+)"', rels) if blip else None
            if tm and "media/" in tm.group(1):
                items.append({"kind": "image", "src": "ppt/" + tm.group(1).replace("../", ""),
                              "alt": "", "x": box[0], "y": box[1], "w": box[2], "h": box[3]})
            continue
        if re.search(r"<a:t>[^<]", node):
            continue                                   # text is extracted separately
        sp_pr = re.search(r"<p:spPr>(.*?)</p:spPr>", node, re.S)
        if not sp_pr:
            continue
        fm = re.search(r"<a:solidFill>(.*?)</a:solidFill>", sp_pr.group(1), re.S)
        fill = resolve_color(fm.group(1), scheme, cmap) if fm else None
        if not fill:
            continue
        am = re.search(r'<a:alpha val="(\d+)"', fm.group(1))
        prst = re.search(r'<a:prstGeom prst="(\w+)"', node)
        items.append({"kind": prst.group(1) if prst else "rect", "x": box[0], "y": box[1],
                      "w": box[2], "h": box[3], "fill": fill,
                      "alpha": int(am.group(1)) / 100000 if am else 1.0})
    return items


def layout_of(z: zipfile.ZipFile, slide: str) -> str | None:
    rels = f"ppt/slides/_rels/{Path(slide).name}.rels"
    if rels not in z.namelist():
        return None
    m = re.search(r'Type="[^"]*slideLayout"[^>]*Target="([^"]+)"', z.read(rels).decode("utf-8"))
    if not m:
        return None
    part = "ppt/" + m.group(1).replace("../", "")
    return part if part in z.namelist() else None


def master_text_styles(z: zipfile.ZipFile) -> dict[str, dict]:
    """The master's txStyles — the real source of default size, alignment, indent and bullets
    for placeholders. Layouts in this deck carry no lstStyle at all, so this is what makes
    body text look like the deck (44pt titles, • bullets, hanging indents)."""
    out: dict[str, dict] = {}
    master = "ppt/slideMasters/slideMaster1.xml"
    if master not in z.namelist():
        return out
    xml = z.read(master).decode("utf-8")
    for tag, key in (("titleStyle", "title"), ("bodyStyle", "body"), ("otherStyle", "other")):
        blk = re.search(rf"<p:{tag}>.*?</p:{tag}>", xml, re.S)
        if not blk:
            continue
        levels: dict[int, dict] = {}
        for lvl in range(1, 10):
            m = re.search(rf"<a:lvl{lvl}pPr[^>]*>.*?</a:lvl{lvl}pPr>|<a:lvl{lvl}pPr[^>]*/>",
                          blk.group(0), re.S)
            if not m:
                continue
            t = m.group(0)
            info: dict = {}
            sz = re.search(r'<a:defRPr[^>]*sz="(\d+)"', t) or re.search(r'sz="(\d+)"', t)
            if sz:
                info["sz"] = int(sz.group(1)) / 100
            algn = re.search(r'algn="(\w+)"', t)
            info["algn"] = algn.group(1) if algn else "l"
            mar = re.search(r'marL="(-?\d+)"', t)
            ind = re.search(r'indent="(-?\d+)"', t)
            info["marL"] = round(int(mar.group(1)) / EMU_IN, 3) if mar else 0.0
            info["indent"] = round(int(ind.group(1)) / EMU_IN, 3) if ind else 0.0
            bc = re.search(r'<a:buChar char="([^"]*)"', t)
            if bc:
                info["bullet"], info["char"] = "char", unescape(bc.group(1))
            elif "<a:buAutoNum" in t:
                info["bullet"] = "num"
            elif "<a:buNone" in t:
                info["bullet"] = "none"
            pct = re.search(r'<a:spcPct val="(\d+)"', t)
            if pct:
                info["lnSpcPct"] = int(pct.group(1)) / 100000
            bef = re.search(r'<a:spcBef>\s*<a:spcPts val="(\d+)"', t)
            if bef:
                info["spcBefPt"] = int(bef.group(1)) / 100
            levels[lvl - 1] = info
        out[key] = levels
    return out


def _level_info(block: str, scheme: dict[str, str] | None = None,
                cmap: dict[str, str] | None = None) -> dict:
    """Parse one <a:lvlNpPr> into the attributes that matter for rendering."""
    info: dict = {}
    sz = re.search(r'<a:defRPr[^>]*sz="(\d+)"', block) or re.search(r'sz="(\d+)"', block)
    if sz:
        info["sz"] = int(sz.group(1)) / 100
    algn = re.search(r'algn="(\w+)"', block)
    if algn:
        info["algn"] = algn.group(1)
    mar = re.search(r'marL="(-?\d+)"', block)
    ind = re.search(r'indent="(-?\d+)"', block)
    if mar:
        info["marL"] = round(int(mar.group(1)) / EMU_IN, 3)
    if ind:
        info["indent"] = round(int(ind.group(1)) / EMU_IN, 3)
    bc = re.search(r'<a:buChar char="([^"]*)"', block)
    if bc:
        info["bullet"], info["char"] = "char", unescape(bc.group(1))
    elif "<a:buAutoNum" in block:
        info["bullet"] = "num"
    elif "<a:buNone" in block:
        info["bullet"] = "none"
    pct = re.search(r'<a:spcPct val="(\d+)"', block)
    if pct:
        info["lnSpcPct"] = int(pct.group(1)) / 100000
    bef = re.search(r'<a:spcBef>\s*<a:spcPts val="(\d+)"', block)
    if bef:
        info["spcBefPt"] = int(bef.group(1)) / 100
    clr = re.search(r"<a:buClr>(.*?)</a:buClr>", block, re.S)
    if clr:
        rgb = re.search(r'<a:srgbClr val="([0-9A-Fa-f]{6})"', clr.group(1))
        sch = re.search(r'<a:schemeClr val="(\w+)"', clr.group(1))
        if rgb:
            info["bulletColor"] = rgb.group(1).upper()
        elif sch and scheme:
            info["bulletColor"] = scheme.get((cmap or {}).get(sch.group(1), sch.group(1)))
    return info


def _shape_levels(node: str, scheme=None, cmap=None) -> dict[int, dict]:
    """A shape's own <a:lstStyle>: the level ladder for plain text boxes.

    Most content in this deck is plain text boxes rather than placeholders, and their bullets,
    sizes and indents live here — ignoring it produced bullet-less, undersized text.
    """
    out: dict[int, dict] = {}
    ls = re.search(r"<a:lstStyle>(.*?)</a:lstStyle>", node, re.S)
    if not ls:
        return out
    for lvl in range(1, 10):
        blk = re.search(rf"<a:lvl{lvl}pPr.*?</a:lvl{lvl}pPr>|<a:lvl{lvl}pPr[^>]*/>", ls.group(1), re.S)
        if not blk:
            continue
        info = _level_info(blk.group(0), scheme, cmap)
        if info:
            out[lvl - 1] = info
    return out


def _placeholder_map(xml: str) -> dict[str, dict]:
    """placeholder signature -> {sz, x, y, w, h} for one layout or master part."""
    out: dict[str, dict] = {}
    for m in re.finditer(r"<p:sp>.*?</p:sp>", xml, re.S):
        node = m.group(0)
        ph = re.search(r"<p:ph([^>]*)/>", node)
        if not ph:
            continue
        attrs = ph.group(1)
        tm = re.search(r'type="(\w+)"', attrs)
        im = re.search(r'idx="(\d+)"', attrs)
        tm, im = (tm.group(1) if tm else ""), (im.group(1) if im else "")
        info: dict = {}
        if tm:
            info["phType"] = tm
        sz = re.search(r"<a:defRPr[^>]*sz=\"(\d+)\"", node) or re.search(r'sz="(\d+)"', node)
        if sz:
            info["sz"] = int(sz.group(1)) / 100
        xf = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', node)
        if xf:
            info.update(x=emu(xf.group(1)), y=emu(xf.group(2)),
                        w=emu(xf.group(3)), h=emu(xf.group(4)))
        bl: dict[int, dict] = {}
        for lvl in range(1, 6):
            blk = re.search(rf"<a:lvl{lvl}pPr.*?</a:lvl{lvl}pPr>", node, re.S)
            if not blk:
                continue
            lv = _level_info(blk.group(0))
            if lv:
                bl[lvl - 1] = lv
        if bl:
            info["levels"] = bl
        if not info:
            continue
        # PowerPoint matches a placeholder by type AND idx; a slide often names only the idx.
        keys = [f"{tm}:{im}", f":{im}", f"{tm}:"]
        if info.get("x") is not None or info.get("sz"):
            if tm in ("body", "obj") or (not tm and im == "1"):
                keys.append("default:")
        for key in keys:
            if key.endswith(":") and key != "default:" and not key[:-1]:
                continue
            out[key] = {**out.get(key, {}), **info}
    return out


def layout_placeholders(z: zipfile.ZipFile, layout: str | None) -> dict[str, dict]:
    """Geometry/size a slide inherits: master defaults, overridden by the layout."""
    merged: dict[str, dict] = {}
    for part in ("ppt/slideMasters/slideMaster1.xml", layout):
        if part and part in z.namelist():
            for k, v in _placeholder_map(z.read(part).decode("utf-8")).items():
                merged[k] = {**merged.get(k, {}), **v}
    return merged


def emu(v: str | None) -> float:
    return round(int(v) / EMU_IN, 3) if v else 0.0


# the deck's one animation: an "Appear" entrance on a shape, fired by a click.
# NB: in this deck the attributes are written presetID then presetClass, so parse the tag.
def reveal_steps(xml: str) -> list[str]:
    steps = []
    for m in re.finditer(r"<p:cTn\b[^>]*>", xml):
        tag = m.group(0)
        cls = re.search(r'presetClass="(\w+)"', tag)
        pid = re.search(r'presetID="(\d+)"', tag)
        if not (cls and pid):
            continue
        node = re.search(r'nodeType="(\w+)"', tag)
        kind = node.group(1) if node else "clickEffect"
        if kind not in ("clickEffect", "withEffect", "afterEffect"):
            continue
        window = xml[m.end():m.end() + 2000]
        t = re.search(r'<p:spTgt spid="(\d+)"', window)
        if t:
            steps.append(f"spid:{t.group(1)}:{cls.group(1)}:{kind}")
    return steps


def shape_role(name: str, ph: str | None) -> str:
    if ph:
        low = ph.lower()
        if "subtitle" in low:            # before the "title" test: subTitle contains "title"
            return "subtitle"
        if "ctrtitle" in low or 'type="title"' in low:
            return "title"
        if "body" in low:
            return "body"
    low = name.lower()
    if "title" in low:
        return "title"
    return "text"


# Shapes this project once injected into the .pptx for the PowerPoint flow ("« Case Index"
# chips and the generated Case Index slide). They must never reach the website.
DECK_ARTIFACT_RE = re.compile(r"^(CASEIDX-RETURN|CASE-INDEX-)")


def clean_name(name: str) -> str:
    return re.sub(r"\s*\d+$", "", name).strip()


GRID_MARGIN = 0.05          # inches kept clear of the slide edge
GRID_GAP = 0.08             # inches between images in a row / between rows


def _label_band(slide: dict, top: float, bottom: float,
                pics: list[dict]) -> tuple[float, float, str]:
    """Horizontal band a grid may use without covering text.

    Two cases matter here:
      * a text column beside the pictures (case 6's diagnosis slide: text left, images right) —
        the grid must stay in its own column rather than being centred across the whole slide;
      * a narrow rotated row label at the edge of a full-width grid (case 8), measured by its
        rotated bounding box.
    A caption that merely clips the top of the pictures is not "beside" them, so a block has to
    overlap the picture band vertically by at least half its own height to count.
    """
    pic_x0 = min(p["x"] for p in pics)
    pic_x1 = max(p["x"] + p["w"] for p in pics)
    left, right, side = GRID_MARGIN, SLIDE_W - GRID_MARGIN, "none"
    for t in slide["texts"]:
        w, h = t["w"], t["h"]
        if w <= 0 or h <= 0:
            continue
        rad = math.radians(t.get("rot") or 0)
        c, sn = abs(math.cos(rad)), abs(math.sin(rad))
        bw, bh = w * c + h * sn, w * sn + h * c
        cx, cy = t["x"] + w / 2, t["y"] + h / 2
        overlap = min(cy + bh / 2, bottom) - max(cy - bh / 2, top)
        if overlap < 0.5 * bh:
            continue
        x0, x1 = cx - bw / 2, cx + bw / 2
        if x1 <= pic_x0 + 0.15:                        # sits beside the pictures, to the left
            left = max(left, x1 + GRID_GAP)
            side = "left"
        elif x0 >= pic_x1 - 0.15:                      # beside them, to the right
            right = min(right, x0 - GRID_GAP)
            side = side if side == "left" else "right"
        elif bw <= 2.0 and x1 <= SLIDE_W / 3:           # narrow edge label, left
            left = max(left, x1 + GRID_GAP)
        elif bw <= 2.0 and x0 >= 2 * SLIDE_W / 3:       # narrow edge label, right
            right = min(right, x0 - GRID_GAP)
    if right - left < 2.0:                             # never squeeze the grid to nothing
        return GRID_MARGIN, SLIDE_W - GRID_MARGIN, side
    return left, right, side


def _label_band_v(slide: dict, left: float, right: float,
                  top: float, bottom: float) -> tuple[float, float]:
    """Vertical band a grid may use without covering text above or below it.

    A caption over a filmstrip (case 2's time-point labels) or a credit under a figure sets the
    limit; only text that overlaps the pictures horizontally can collide with them, and a label
    that sits *inside* the picture band (an intentional overlay) is left alone.
    """
    lo, hi = GRID_MARGIN, SLIDE_H - GRID_MARGIN
    for t in slide["texts"]:
        w, h = t["w"], t["h"]
        if w <= 0 or h <= 0:
            continue
        rad = math.radians(t.get("rot") or 0)
        c, sn = abs(math.cos(rad)), abs(math.sin(rad))
        bw, bh = w * c + h * sn, w * sn + h * c
        cx, cy = t["x"] + w / 2, t["y"] + h / 2
        overlap_x = min(cx + bw / 2, right) - max(cx - bw / 2, left)
        if overlap_x < 0.2:                            # not over the pictures' columns
            continue
        if cy + bh / 2 <= top + 0.15:                  # sits above the pictures
            lo = max(lo, cy + bh / 2 + GRID_GAP)
        elif cy - bh / 2 >= bottom - 0.15:             # sits below them
            hi = min(hi, cy - bh / 2 - GRID_GAP)
    if hi - lo < 2.0:                                  # never squeeze the grid to nothing
        return GRID_MARGIN, SLIDE_H - GRID_MARGIN
    return lo, hi


def _cluster_rows(pics: list[dict], tol: float = 0.6) -> list[list[dict]]:
    rows: list[list[dict]] = []
    for p in sorted(pics, key=lambda p: p["y"] + p["h"] / 2):
        centre = p["y"] + p["h"] / 2
        for row in rows:
            ref = row[0]["y"] + row[0]["h"] / 2
            if abs(centre - ref) < tol:
                row.append(p)
                break
        else:
            rows.append([p])
    for row in rows:
        row.sort(key=lambda p: p["x"])
    return rows


def normalise_grids(slide: dict) -> bool:
    """Snap an image grid to even columns and rows, keeping the deck's own placement.

    The deck's grids come out of Google Slides with per-image frames: rows don't share a top,
    columns don't line up between rows, and the block can run past the slide edge. Where a grid
    is detected (two or more rows, or a filmstrip of three) it is rebuilt: equal heights per row,
    shared column widths, equal gaps, and scaled down if it would not fit.

    The rebuilt block also has to keep out of the slide's other content: text beside it (case 6's
    diagnosis slide, case 8's rotated row labels) sets the horizontal band, text above or below it
    (case 2's time-point captions) the vertical one, and the deck's own top edge is a floor — the
    rebuilt block never rises above where the author put it, so it cannot climb into a caption.
    """
    pics = slide["pictures"]
    if len(pics) < 3:
        return False
    rows = _cluster_rows(pics)
    if len(rows) > 1 and any(len(r) < 2 for r in rows):
        return False
    if len(rows) == 1 and len(rows[0]) < 3:
        return False
    if len(rows) == 1:
        hs = [p["h"] for p in rows[0]]
        if max(hs) - min(hs) > 0.15 * max(hs):      # not a filmstrip, leave it alone
            return False

    columns = max(len(r) for r in rows)
    row_h = [max(p["h"] for p in row) for row in rows]      # every image in a row shares a height
    # one width per column, so rows share a grid: measure with the row's *final* height,
    # otherwise an image ends up wider than its cell and overlaps its neighbour
    col_w = [0.0] * columns
    for row, rh in zip(rows, row_h):
        for i, p in enumerate(row):
            col_w[i] = max(col_w[i], p["w"] * (rh / p["h"]))

    total_w = sum(col_w) + GRID_GAP * (columns - 1)
    total_h = sum(row_h) + GRID_GAP * (len(rows) - 1)
    pic_top, pic_bottom = min(p["y"] for p in pics), max(p["y"] + p["h"] for p in pics)
    pic_x0, pic_x1 = min(p["x"] for p in pics), max(p["x"] + p["w"] for p in pics)
    # stay clear of text that sits beside the grid; `side` says which side that is
    band_l, band_r, side = _label_band(slide, pic_top, pic_bottom, pics)
    band_l += GRID_GAP
    band_r -= GRID_GAP
    # ... and of text above or below it, which fixes the vertical band just as tightly
    band_t, band_b = _label_band_v(slide, pic_x0, pic_x1, pic_top, pic_bottom)

    if side == "left":                 # hug the text, as the deck does, so a wide title
        left_edge = max(band_l, pic_x0)  # cannot end up over the pictures
        avail_w = band_r - left_edge
    elif side == "right":
        left_edge, avail_w = band_l, min(band_r, pic_x1) - band_l
    else:
        left_edge, avail_w = band_l, band_r - band_l

    avail_h = band_b - band_t
    scale = min(1.0, max(2.0, avail_w) / total_w, avail_h / total_h)
    col_w = [w * scale for w in col_w]
    row_h = [h * scale for h in row_h]
    total_w, total_h = sum(col_w) + GRID_GAP * (columns - 1), sum(row_h) + GRID_GAP * (len(rows) - 1)

    if side == "right":
        x0 = left_edge + (avail_w - total_w)
    elif side == "left":
        x0 = left_edge
    else:
        x0 = left_edge + (avail_w - total_w) / 2
    # Vertically, keep the deck's own placement and never sit higher than the deck had the block:
    # the author's position already clears whatever is above it, whereas centring on the slide can
    # carry the grid up over it (slide 41's title). Text above or below still wins, and a block that
    # would run off the bottom is pulled back in.
    y0 = min(max((SLIDE_H - total_h) / 2, band_t, pic_top), max(band_t, band_b - total_h))
    y = y0
    for row, h in zip(rows, row_h):
        x = x0
        for i, p in enumerate(row):
            aspect = p["w"] / p["h"] if p["h"] else 1.0
            w = h * aspect
            p["x"], p["y"] = round(x, 3), round(y, 3)
            p["w"], p["h"] = round(w, 3), round(h, 3)
            p["aligned"] = True
            x += col_w[i] + GRID_GAP
        y += h + GRID_GAP
    return True


def main() -> None:
    if not DECK.exists():
        sys.exit(f"deck not found: {DECK}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "media").mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(DECK) as z:
        scheme, cmap = theme_colors(z)
        styles = master_text_styles(z)
        slides, media_index = [], {}
        for pos, slide in enumerate(slide_order(z), 1):
            xml = z.read(slide).decode("utf-8")
            imgs = part_images(z, slide)
            steps = reveal_steps(xml)
            layout = layout_of(z, slide)
            lph = layout_placeholders(z, layout)
            grouped = grouped_boxes(xml)          # shapes inside <p:grpSp>, mapped to slide space

            texts, pictures, table, table_box, chrome = [], [], None, None, []
            for m in re.finditer(r"<p:(sp|pic|graphicFrame)>.*?</p:\1>", xml, re.S):
                node = m.group(0)
                cid = re.search(r'<p:cNvPr id="(\d+)" name="([^"]*)"', node)
                spid = cid.group(1) if cid else None
                name = unescape(cid.group(2)) if cid else ""
                xfrm = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', node)

                if m.group(1) == "pic":
                    sr = re.search(r'<a:srcRect([^>]*)/>', node)
                    crop = (0.0, 0.0, 0.0, 0.0)
                    if sr:
                        cv = {k: int(v) / 100000 for k, v in re.findall(r'(\w)="(-?\d+)"', sr.group(1))}
                        crop = (cv.get("l", 0.0), cv.get("t", 0.0), cv.get("r", 0.0), cv.get("b", 0.0))
                    blip = re.search(r'r:embed="(rId\d+)"', node)
                    part = imgs.get(blip.group(1)) if blip else None
                    if not part:
                        continue
                    alt = re.search(r'descr="([^"]*)"', node)
                    if spid in grouped:
                        gx, gy, gw, gh = grouped[spid]
                        box = (emu(str(int(gx))), emu(str(int(gy))),
                               emu(str(int(gw))), emu(str(int(gh))))
                    else:
                        box = ((emu(xfrm.group(1)) if xfrm else 0), (emu(xfrm.group(2)) if xfrm else 0),
                               (emu(xfrm.group(3)) if xfrm else 0), (emu(xfrm.group(4)) if xfrm else 0))
                    pictures.append({
                        "src": part, "alt": unescape(alt.group(1)) if alt else "",
                        "x": box[0], "y": box[1], "w": box[2], "h": box[3],
                        "crop": crop, "grouped": spid in grouped,
                    })
                    continue

                if m.group(1) == "graphicFrame":
                    tbl = re.search(r"<a:tbl>.*?</a:tbl>", node, re.S)
                    if tbl:
                        rows = []
                        for tr in re.findall(r"<a:tr[^>]*>(.*?)</a:tr>", tbl.group(0), re.S):
                            rows.append([" ".join(unescape(t) for t in
                                                  re.findall(r"<a:t>(.*?)</a:t>", tc, re.S)).strip()
                                         for tc in re.findall(r"<a:tc[^>]*>(.*?)</a:tc>", tr, re.S)])
                        table = rows
                        table_box = {"x": emu(xfrm.group(1)) if xfrm else 0,
                                     "y": emu(xfrm.group(2)) if xfrm else 0,
                                     "w": emu(xfrm.group(3)) if xfrm else 0,
                                     "h": emu(xfrm.group(4)) if xfrm else 0}
                    continue

                if cid and DECK_ARTIFACT_RE.match(unescape(cid.group(2))):
                    continue                                # PowerPoint-era artifact
                paras = blocks_from(node)
                if not paras:
                    prst = re.search(r'<a:prstGeom prst="(\w+)"', node)
                    sp_pr = re.search(r"<p:spPr>(.*?)</p:spPr>", node, re.S)
                    fm = re.search(r"<a:solidFill>(.*?)</a:solidFill>", sp_pr.group(1), re.S) if sp_pr else None
                    fill = resolve_color(fm.group(1), scheme, cmap) if fm else None
                    if fill and xfrm:
                        am = re.search(r'<a:alpha val="(\d+)"', fm.group(1))
                        chrome.append({"kind": prst.group(1) if prst else "rect",
                                       "x": emu(xfrm.group(1)), "y": emu(xfrm.group(2)),
                                       "w": emu(xfrm.group(3)), "h": emu(xfrm.group(4)),
                                       "fill": fill,
                                       "alpha": int(am.group(1)) / 100000 if am else 1.0})
                    continue
                ph = re.search(r"<p:ph([^>]*)/>", node)
                ph_attrs = ph.group(1) if ph else ""
                role = shape_role(name, ph.group(0) if ph else None)
                reveal = next((i + 1 for i, s in enumerate(steps) if s.startswith(f"spid:{spid}:")), 0)
                tm = re.search(r'type="(\w+)"', ph_attrs)
                im = re.search(r'idx="(\d+)"', ph_attrs)
                inherited: dict = {}
                # only placeholders inherit from the layout/master: a plain text box carries its
                # own frame and must not pick up the body placeholder's bullets
                keys = [] if ph is None else (
                    f"{tm.group(1) if tm else ''}:{im.group(1) if im else ''}",
                    f":{im.group(1) if im else ''}",
                    f"{tm.group(1) if tm else ''}:",
                    "default:",
                )
                for key in keys:
                    if key in lph:
                        inherited = lph[key]
                        break
                geom5 = _raw_box(node)
                rot_deg = geom5[4] if geom5 else 0.0
                wrap_m = re.search(r'<a:bodyPr[^>]*wrap="(\w+)"', node)
                autofit = re.search(r'<a:normAutofit([^>]*)/>', node)
                font_scale = 1.0
                ln_reduce = 0.0
                if autofit:
                    fs = re.search(r'fontScale="(\d+)"', autofit.group(1))
                    lr = re.search(r'lnSpcReduction="(\d+)"', autofit.group(1))
                    if fs:
                        font_scale = int(fs.group(1)) / 100000
                    if lr:
                        ln_reduce = int(lr.group(1)) / 100000
                ph_type = inherited.get("phType") or (tm.group(1) if tm else "")
                style_key = ("title" if role == "title" or ph_type == "title"
                             else "body" if ph_type in ("body", "obj") or role == "body"
                             else "other")
                style = styles.get(style_key, {})
                lvls = inherited.get("levels") or {}
                own = _shape_levels(node, scheme, cmap)      # this shape's own level ladder
                for pa in paras:
                    lvl = pa["lvl"]
                    chain = [own.get(lvl) or {}, lvls.get(lvl) or {}, style.get(lvl) or {}]
                    if pa["bullet"] is None:
                        for src in chain:
                            if "bullet" in src:
                                pa["bullet"] = src["bullet"]
                                break
                        else:
                            pa["bullet"] = "none"
                    if not pa.get("char"):
                        for src in chain:
                            if src.get("char"):
                                pa["char"] = src["char"]
                                break
                    if not pa.get("algn"):
                        for src in chain:
                            if src.get("algn"):
                                pa["algn"] = src["algn"]
                                break
                        else:
                            pa["algn"] = "l"
                    if pa.get("marL") is None:
                        pa["marL"] = next((s_["marL"] for s_ in chain if "marL" in s_), round(0.25 * (lvl + 1), 3))
                    if pa.get("indent") is None:
                        pa["indent"] = next((s_["indent"] for s_ in chain if "indent" in s_), -0.25)
                    if pa.get("lnSpcPct") is None:
                        pa["lnSpcPct"] = next((s_["lnSpcPct"] for s_ in chain if "lnSpcPct" in s_), 1.0)
                    if pa.get("spcBefPt") is None:
                        pa["spcBefPt"] = next((s_["spcBefPt"] for s_ in chain if "spcBefPt" in s_), 0.0)
                    if pa.get("bulletColor") is None:
                        pa["bulletColor"] = next((s_["bulletColor"] for s_ in chain
                                                  if s_.get("bulletColor")), None)
                    if pa.get("sz") is None:
                        # the level ladder: 28pt level 1, 24pt level 2, … in this deck
                        pa["sz"] = next((s_["sz"] for s_ in chain if "sz" in s_), None)
                title_sz = (own.get(0) or {}).get("sz") or (style.get(0) or {}).get("sz")
                sizes = [r["sz"] for p in paras for r in p["runs"] if r.get("sz")]
                texts.append({
                    "role": role, "name": clean_name(name), "ph": ph.group(0) if ph else None,
                    "reveal": reveal,
                    "x": geom5[0] if geom5 else inherited.get("x", 0),
                    "y": geom5[1] if geom5 else inherited.get("y", 0),
                    "w": geom5[2] if geom5 else inherited.get("w", 0),
                    "h": geom5[3] if geom5 else inherited.get("h", 0),
                    "rot": round(rot_deg, 1),
                    "wrap": wrap_m.group(1) if wrap_m else "square",
                    "fontScale": round(font_scale, 4),
                    "lnSpcReduction": round(ln_reduce, 4),
                    "size": (int(sizes[0]) if sizes else None) or inherited.get("sz") or title_sz,
                    "anchor": (re.search(r'<a:bodyPr[^>]*anchor="(\w+)"', node).group(1)
                               if re.search(r'<a:bodyPr[^>]*anchor="(\w+)"', node) else "t"),
                    "paras": paras,
                })

            own_content = bool(texts or pictures)
            if layout:
                chrome = chrome_shapes(z, layout, scheme, cmap) + chrome
                from_layout = bool(chrome)

            if not texts and not pictures and layout:
                lx = z.read(layout).decode("utf-8")
                limgs = part_images(z, layout.replace("ppt/", "ppt/"))
                for m in re.finditer(r"<p:(sp|pic|graphicFrame)>.*?</p:\1>", lx, re.S):
                    node = m.group(0)
                    if "<p:ph" in node and not re.search(r"<a:t>[^<]", node):
                        continue                      # empty layout placeholder
                    cid = re.search(r'<p:cNvPr id="(\d+)" name="([^"]*)"', node)
                    xfrm = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', node)
                    if m.group(1) == "pic":
                        blip = re.search(r'r:embed="(rId\d+)"', node)
                        lrel = f"ppt/slideLayouts/_rels/{Path(layout).name}.rels"
                        target = None
                        if blip and lrel in z.namelist():
                            lm = re.search(r'Id="' + blip.group(1) + r'"[^>]*Target="([^"]+)"',
                                           z.read(lrel).decode("utf-8"))
                            if lm and "media/" in lm.group(1):
                                target = "ppt/" + lm.group(1).replace("../", "")
                        if target:
                            pictures.append({
                                "src": target, "alt": "",
                                "x": emu(xfrm.group(1)) if xfrm else 0, "y": emu(xfrm.group(2)) if xfrm else 0,
                                "w": emu(xfrm.group(3)) if xfrm else 0, "h": emu(xfrm.group(4)) if xfrm else 0,
                            })
                        continue
                    if m.group(1) == "graphicFrame":
                        tbl = re.search(r"<a:tbl>.*?</a:tbl>", node, re.S)
                        if tbl:
                            table = [[" ".join(unescape(t) for t in re.findall(r"<a:t>(.*?)</a:t>", tc, re.S)).strip()
                                      for tc in re.findall(r"<a:tc[^>]*>(.*?)</a:tc>", tr, re.S)]
                                     for tr in re.findall(r"<a:tr[^>]*>(.*?)</a:tr>", tbl.group(0), re.S)]
                            table_box = {"x": emu(xfrm.group(1)) if xfrm else 0,
                                         "y": emu(xfrm.group(2)) if xfrm else 0,
                                         "w": emu(xfrm.group(3)) if xfrm else 0,
                                         "h": emu(xfrm.group(4)) if xfrm else 0}
                        continue
                    if cid and DECK_ARTIFACT_RE.match(unescape(cid.group(2))):
                        continue
                    paras = blocks_from(node)
                    if not paras:
                        continue
                    ph = re.search(r"<p:ph[^>]*/>", node)
                    sizes = [r["sz"] for p in paras for r in p["runs"] if r.get("sz")]
                    texts.append({
                        "role": shape_role(unescape(cid.group(2)) if cid else "", ph.group(0) if ph else None),
                        "name": clean_name(unescape(cid.group(2))) if cid else "",
                        "ph": ph.group(0) if ph else None, "reveal": 0,
                        "x": emu(xfrm.group(1)) if xfrm else 0, "y": emu(xfrm.group(2)) if xfrm else 0,
                        "w": emu(xfrm.group(3)) if xfrm else 0, "h": emu(xfrm.group(4)) if xfrm else 0,
                        "size": int(sizes[0]) if sizes else None, "paras": paras,
                    })
                from_layout = from_layout or bool(texts or pictures or table)

            bg = re.search(r"<p:bg>.*?</p:bg>", xml, re.S)
            bg_scheme = re.search(r'<a:schemeClr val="(\w+)"', bg.group(0)) if bg else None
            bg_hex = re.search(r'<a:srgbClr val="([0-9A-Fa-f]{6})"', bg.group(0)) if bg else None

            slides.append({
                "pos": pos, "part": slide,
                "title": next((" ".join(r["t"] for r in p["runs"])
                               for b in texts if b["role"] == "title" for p in b["paras"]), ""),
                "texts": texts, "pictures": pictures, "chrome": chrome,
                "ownContent": own_content,
                "table": table, "tableBox": table_box,
                "notes": notes_for(z, slide), "fromLayout": from_layout,
                "reveal": steps,
                "bg": bg_hex.group(1) if bg_hex else (("light" if bg_scheme.group(1) in
                                                      ("bg1", "lt1") else "dark") if bg_scheme else None),
            })

        # ---- media: crop as the deck crops, then resize for the web ----
        # PowerPoint draws only the <a:srcRect> region of a picture inside its frame, so the crop
        # is baked into the file we serve: the browser gets the final pixels and no CSS cropping.
        import hashlib
        import io

        # Names are stable per source image: image18.webp, image18-2.webp, … assigned in a
        # deterministic order. Renaming files when a crop changes would break any browser (or
        # intermediate cache) still holding the previous content.json — the old names must
        # keep resolving.
        crops_by_part: dict[str, list[tuple]] = {}
        for sl in slides:                                   # chrome first: it claims the plain name
            for ch in sl.get("chrome", []):
                if ch.get("kind") == "image":
                    variants = crops_by_part.setdefault(ch["src"], [])
                    if (0.0, 0.0, 0.0, 0.0) not in variants:
                        variants.append((0.0, 0.0, 0.0, 0.0))
        for sl in slides:
            for pic in sl["pictures"]:
                crop = tuple(round(c, 4) for c in (pic.get("crop") or (0.0, 0.0, 0.0, 0.0)))
                variants = crops_by_part.setdefault(pic["src"], [])
                if crop not in variants:
                    variants.append(crop)

        def bake_name(part: str, crop: tuple) -> str:
            stem = Path(part).stem
            variants = crops_by_part.get(part, [crop])
            idx = variants.index(crop) if crop in variants else 0
            return f"{stem}.webp" if idx == 0 else f"{stem}-{idx + 1}.webp"

        for old in (OUT / "media").glob("*.webp"):
            old.unlink()                      # regenerate from scratch so no stale crop lingers

        wanted: dict[tuple[str, tuple], str] = {}
        for sl in slides:
            for ch in sl.get("chrome", []):
                if ch.get("kind") == "image":
                    wanted[(ch["src"], (0.0, 0.0, 0.0, 0.0))] = bake_name(ch["src"], (0.0, 0.0, 0.0, 0.0))
            for pic in sl["pictures"]:
                crop = tuple(round(c, 4) for c in (pic.get("crop") or (0.0, 0.0, 0.0, 0.0)))
                wanted[(pic["src"], crop)] = bake_name(pic["src"], crop)

        for (part, crop), name in wanted.items():
            dest = OUT / "media" / name
            with Image.open(io.BytesIO(z.read(part))) as im:
                im = im.convert("RGB")
                if any(crop):
                    w, h = im.size
                    box = (round(w * crop[0]), round(h * crop[1]),
                           round(w * (1 - crop[2])), round(h * (1 - crop[3])))
                    if box[2] > box[0] and box[3] > box[1]:
                        im = im.crop(box)
                if max(im.size) > MAX_PX:
                    im.thumbnail((MAX_PX, MAX_PX), Image.LANCZOS)
                im.save(dest, "WEBP", quality=QUALITY, method=5)
            media_index[name] = {"part": part, "crop": list(crop), "bytes": dest.stat().st_size}
        for sl in slides:
            for ch in sl.get("chrome", []):
                if ch.get("kind") == "image":
                    ch["src"] = wanted[(ch["src"], (0.0, 0.0, 0.0, 0.0))]
            for pic in sl["pictures"]:
                crop = tuple(round(c, 4) for c in (pic.get("crop") or (0.0, 0.0, 0.0, 0.0)))
                pic["src"] = wanted[(pic["src"], crop)]

    grids = sum(1 for sl in slides if normalise_grids(sl))
    if grids:
        print(f"image grids     : {grids} slide(s) realigned and centred")

    # ---- case boundaries ----------------
    # A case begins at the FIRST slide whose title is exactly "Case N"; the companion-case and
    # quiz slides sharing that prefix must not start a new case. Case N then runs to the slide
    # before case N+1 starts; the last case stops at the last slide that actually carries
    # content (the closing Emory slide's content lives in its layout, so it is excluded).
    starts = {}
    for s in slides:
        m = re.fullmatch(r"Case (\d+)", s["title"].strip())
        if m and int(m.group(1)) not in starts:
            starts[int(m.group(1))] = s["pos"]
    ordered = sorted(starts)
    cases = []
    for i, n in enumerate(ordered):
        start = starts[n]
        end = starts[ordered[i + 1]] - 1 if i + 1 < len(ordered) else None
        if end is None:
            with_content = [s["pos"] for s in slides
                            if s["pos"] >= start and s.get("ownContent")]
            end = max(with_content) if with_content else start
        inner = [s for s in slides if start <= s["pos"] <= end]
        vignette = next((" ".join(r["t"] for r in p["runs"]).strip()
                         for s in inner for t in s["texts"] if t["role"] == "subtitle"
                         for p in t["paras"]), "")
        titles, seen = [], set()
        for s in inner:
            t = s["title"].strip()
            if t and not re.fullmatch(r"Case \d+", t) and t not in seen:
                seen.add(t)
                titles.append(t)
        curated = CURATED.get(n, {})
        cases.append({"n": n, "start": start, "end": end,
                      "slides": list(range(start, end + 1)),
                      "vignette": re.sub(r"\s+", " ", vignette),
                      "diagnosis": curated.get("dx") or (titles[0] if titles else f"Case {n}"),
                      "companion": curated.get("companion") if "companion" in curated
                                   else (titles[1] if len(titles) > 1 else None),
                      "slideTitles": titles})
    # a slide whose only content was an injected artifact is not a content slide
    def is_artifact_slide(sl: dict) -> bool:
        if sl["title"].strip() == SKIP_TITLE:
            return True
        names = [t["name"] for t in sl["texts"]]
        return bool(names) and all(DECK_ARTIFACT_RE.match(n) for n in names)
    kept = [sl for sl in slides if not is_artifact_slide(sl)]
    dropped = len(slides) - len(kept)
    if dropped:
        print(f"dropped         : {dropped} slide(s) belonging to the discarded PowerPoint flow")
    for i, sl in enumerate(kept, 1):
        sl["pos"] = i
    slides = kept
    idx_pos = None

    # The deck gates a case's vignette behind a click on 11 of its 12 intro slides - one case
    # (case 3) shows it immediately. Make that behaviour consistent.
    fixed = 0
    for case in cases:
        intro = next((sl for sl in slides if sl["pos"] == case["start"]), None)
        if not intro or any(t["reveal"] > 0 for t in intro["texts"]):
            continue
        target = next((t for t in intro["texts"] if t["role"] == "subtitle"),
                      next((t for t in intro["texts"] if t["role"] != "title" and t["paras"]), None))
        if target:
            target["reveal"] = 1
            fixed += 1
    if fixed:
        print(f"intro reveals   : {fixed} case intro(s) now wait for a click, like the rest")

    meta = json.loads(META_FILE.read_text(encoding="utf-8")) if META_FILE.exists() else {}
    logo_out = None
    conference = meta.get("conference")
    if conference and conference.get("logoPart"):
        try:
            with zipfile.ZipFile(DECK) as z:
                blob = z.read(conference["logoPart"])
            dest = OUT / conference.get("logoOut", "brand/emory-logo.png")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(blob)
            logo_out = conference.get("logoOut", "brand/emory-logo.png")
            print(f"logo            : {logo_out} ({len(blob)/1024:.0f} KB)")
        except KeyError:
            print(f"logo            : {conference['logoPart']} not found in the deck")

    content = {
        "deck": DECK.name,
        "conference": {**{k: v for k, v in (conference or {}).items() if k != "logoPart"},
                       "logo": logo_out},
        "conflictOfInterest": meta.get("conflictOfInterest"),
        "accreditation": meta.get("accreditation"),
        "slideCount": len(slides),
        "indexSlideToSkip": idx_pos,
        "cases": cases,
        "slides": slides,
    }
    (OUT / "content.json").write_text(json.dumps(content, ensure_ascii=False, indent=1),
                                      encoding="utf-8")
    (OUT / "media" / "index.json").write_text(json.dumps(media_index, indent=1), encoding="utf-8")

    total = sum(v["bytes"] for v in media_index.values())
    print(f"slides          : {len(slides)}")
    print(f"cases           : {len(cases)}  -> sizes {[len(c['slides']) for c in cases]}")
    print(f"index slide     : {idx_pos} (skipped in the site's own index)")
    cropped = sum(1 for v in media_index.values() if any(v.get("crop") or []))
    print(f"images          : {len(media_index)} webp, {total/1e6:.1f} MB "
          f"({cropped} with the deck's crop baked in)")
    print(f"reveal steps    : {sum(len(s['reveal']) for s in slides)} across "
          f"{sum(1 for s in slides if s['reveal'])} slides")
    print(f"notes           : {sum(1 for s in slides if s['notes'])}")
    print(f"-> {OUT/'content.json'}")


if __name__ == "__main__":
    main()
