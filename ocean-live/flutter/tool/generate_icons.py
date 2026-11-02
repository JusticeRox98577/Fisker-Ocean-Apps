#!/usr/bin/env python3
"""Regenerates every Ocean Live app icon and launch image from one design.

Needs: rsvg-convert (librsvg) and Pillow.  Run from ocean-live/flutter:
    python3 tool/generate_icons.py
"""
import json, os, subprocess, tempfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android/app/src/main/res")
IOS = os.path.join(ROOT, "ios/Runner/Assets.xcassets")

DEFS = """
<defs>
  <radialGradient id="bg" cx="50%" cy="38%" r="85%">
    <stop offset="0" stop-color="#14356b"/><stop offset=".55" stop-color="#0a1d3f"/><stop offset="1" stop-color="#050e20"/>
  </radialGradient>
  <linearGradient id="ring" x1="0" y1="1" x2="1" y2="0">
    <stop offset="0" stop-color="#299af4"/><stop offset="1" stop-color="#2ff0c8"/>
  </linearGradient>
  <linearGradient id="bolt" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9fe9ff"/>
  </linearGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
</defs>"""

ARC_TRACK = "M 278.7 745.3 A 330 330 0 1 1 745.3 745.3"
ARC_FILL = "M 278.7 745.3 A 330 330 0 1 1 837.9 460.4"
BOLT = "566,290 396,548 496,548 452,734 630,470 526,470"


def mark(scale=1.0, mono=False, glow=True):
    t = f'transform="translate(512 512) scale({scale}) translate(-512 -512)"'
    if mono:
        return f'''<g {t}><path d="{ARC_FILL}" fill="none" stroke="#000" stroke-width="72" stroke-linecap="round"/>
<polygon points="{BOLT}" fill="#000" stroke="#000" stroke-width="14" stroke-linejoin="round"/></g>'''
    g = f'''<path d="{ARC_FILL}" fill="none" stroke="#2ff0c8" stroke-width="72" stroke-linecap="round" opacity=".55" filter="url(#glow)"/>
<polygon points="{BOLT}" fill="#9fe9ff" opacity=".6" filter="url(#glow)"/>''' if glow else ""
    return f'''<g {t}>{g}
<path d="{ARC_TRACK}" fill="none" stroke="#ffffff" stroke-opacity=".13" stroke-width="72" stroke-linecap="round"/>
<path d="{ARC_FILL}" fill="none" stroke="url(#ring)" stroke-width="72" stroke-linecap="round"/>
<polygon points="{BOLT}" fill="url(#bolt)" stroke="url(#bolt)" stroke-width="14" stroke-linejoin="round"/></g>'''


def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">{DEFS}{body}</svg>'


FULL = svg('<rect width="1024" height="1024" fill="url(#bg)"/>' + mark(1.0))
FOREGROUND = svg(mark(0.8))
BACKGROUND = svg('<rect width="1024" height="1024" fill="url(#bg)"/>')
MONO = svg(mark(0.8, mono=True))
LOGO = svg(mark(1.12))  # transparent mark used on launch screens


def render(source, size, out, flatten=None, round_frac=None):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(source)
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), f.name, "-o", out], check=True)
    os.unlink(f.name)
    im = Image.open(out).convert("RGBA")
    if round_frac:
        from PIL import ImageDraw
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * round_frac), fill=255)
        mask = mask.resize((size, size), Image.LANCZOS)
        im.putalpha(mask)
    if flatten:
        base = Image.new("RGB", im.size, flatten)
        base.paste(im, mask=im.split()[3])
        im = base
    im.save(out)


def main():
    with open(os.path.join(ROOT, "assets/branding/icon.svg"), "w") as f:
        f.write(FULL)
    with open(os.path.join(ROOT, "assets/branding/logo.svg"), "w") as f:
        f.write(LOGO)
    # Android adaptive layers (108dp canvas) + legacy launcher icons
    for d, px in {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}.items():
        render(FOREGROUND, px, f"{RES}/mipmap-{d}/ic_launcher_foreground.png")
        render(BACKGROUND, px, f"{RES}/mipmap-{d}/ic_launcher_background.png")
        render(MONO, px, f"{RES}/mipmap-{d}/ic_launcher_monochrome.png")
    for d, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        render(FULL, px, f"{RES}/mipmap-{d}/ic_launcher.png", round_frac=0.22)
        render(FULL, px, f"{RES}/mipmap-{d}/ic_launcher_round.png", round_frac=0.5)
    render(LOGO, 512, f"{RES}/drawable-nodpi/launch_logo.png")
    render(FOREGROUND, 1024, os.path.join(ROOT, "assets/branding/play_foreground.png"))
    render(FULL, 512, os.path.join(ROOT, "assets/branding/play_store_icon_512.png"), flatten=(5, 14, 32))
    # iOS app icons (opaque, no alpha) and launch image
    iconset = f"{IOS}/AppIcon.appiconset"
    contents = json.load(open(f"{iconset}/Contents.json"))
    for img in contents["images"]:
        pts = float(img["size"].split("x")[0])
        px = round(pts * int(img["scale"][0]))
        render(FULL, px, f"{iconset}/{img['filename']}", flatten=(5, 14, 32))
    for scale, name in ((1, "LaunchImage.png"), (2, "LaunchImage@2x.png"), (3, "LaunchImage@3x.png")):
        render(LOGO, 160 * scale, f"{IOS}/LaunchImage.imageset/{name}")
    print("icons generated")


if __name__ == "__main__":
    main()
