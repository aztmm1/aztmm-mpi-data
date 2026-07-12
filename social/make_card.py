#!/usr/bin/env python3
"""Render the nightly AZTMM share card (1080x1350 PNG).

Reads data/qa.json, data/mpi.json and the ledger, renders a dark-theme card
with the self-audit score plus one real scored ledger row (misses included -
that is the point), writes social/latest-card.png. Runs inside qa.yml.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "data" / "mpi.json").exists())
W, H = 1080, 1350
BG = (7, 8, 26)
CARD = (19, 22, 47)
LINE = (42, 48, 87)
INK = (230, 233, 255)
MID = (178, 184, 229)
MUTE = (126, 132, 181)
CYAN = (34, 211, 238)
GOLD = (201, 169, 97)
GREEN = (16, 185, 129)
ROSE = (251, 113, 133)
AMBER = (245, 158, 11)

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"


def font(size, bold=False):
    try:
        name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
        return ImageFont.truetype(FONT_DIR + name, size)
    except Exception:
        return ImageFont.load_default()


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def main():
    qa = json.loads((ROOT / "data" / "qa.json").read_text())
    mpi = json.loads((ROOT / "data" / "mpi.json").read_text())
    ledger = json.loads((ROOT / "accountability-ledger" / "sample-output" / "latest.json").read_text())

    d = mpi["data"]
    rows = ledger.get("rows", [])
    pick = None
    for status in ("invalidated", "hit", "unresolved"):
        cands = [r for r in rows if r.get("status") == status and r.get("statement") and r.get("ticker")]
        if cands:
            pick = sorted(cands, key=lambda r: r.get("resolved_date") or r.get("date") or "", reverse=True)[0]
            break
    if pick is None and rows:
        pick = rows[0]

    img = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(img)

    # header
    dr.text((72, 64), "AZTMM", font=font(44, True), fill=INK)
    dr.text((72, 122), "NIGHTLY SELF-AUDIT · NEVER REVISED", font=font(24), fill=GOLD)
    dr.line([(72, 178), (W - 72, 178)], fill=LINE, width=2)

    # score block
    score, grade = qa.get("score", 0), qa.get("grade", "?")
    dr.text((72, 236), "DATA QUALITY", font=font(26), fill=MUTE)
    dr.text((72, 282), f"{score}/100", font=font(148, True), fill=CYAN)
    dr.text((72 + dr.textlength(f"{score}/100", font=font(148, True)) + 34, 344), f"grade {grade}", font=font(48, True), fill=INK)
    dr.text((72, 462), f"scored mechanically across {len(qa.get('checks', []))} public checks · {qa.get('generated_at', '')[:10]}", font=font(26), fill=MUTE)

    # mpi strip
    y = 540
    dr.rounded_rectangle([(72, y), (W - 72, y + 128)], radius=18, fill=CARD, outline=LINE, width=2)
    dr.text((104, y + 24), "MPI", font=font(26), fill=MUTE)
    dr.text((104, y + 58), str(d.get("mpi_score", "—")), font=font(52, True), fill=CYAN)
    dr.text((300, y + 24), "REGIME", font=font(26), fill=MUTE)
    dr.text((300, y + 58), str(d.get("regime_label", "—")), font=font(48, True), fill=GOLD)
    dr.text((660, y + 24), "AS OF", font=font(26), fill=MUTE)
    dr.text((660, y + 58), str(mpi.get("asOf", "—")), font=font(44, True), fill=INK)

    # ledger row
    y = 740
    dr.text((72, y), "FROM THE ACCOUNTABILITY LEDGER", font=font(26), fill=MUTE)
    y += 52
    dr.rounded_rectangle([(72, y), (W - 72, y + 330)], radius=18, fill=CARD, outline=LINE, width=2)
    if pick:
        status = str(pick.get("status", "open")).upper()
        col = {"HIT": GREEN, "INVALIDATED": ROSE, "UNRESOLVED": AMBER}.get(status, MUTE)
        chip_w = dr.textlength(status, font=font(26, True)) + 44
        dr.rounded_rectangle([(104, y + 30), (104 + chip_w, y + 78)], radius=24, outline=col, width=3)
        dr.text((126, y + 40), status, font=font(26, True), fill=col)
        dr.text((104 + chip_w + 28, y + 42), f"{pick.get('ticker', '')} · {pick.get('date', '')}", font=font(30, True), fill=INK)
        fnt = font(32)
        lines = wrap(dr, str(pick.get("statement", ""))[:320], fnt, W - 72 - 104 - 32)[:5]
        ty = y + 110
        for ln in lines:
            dr.text((104, ty), ln, font=fnt, fill=MID)
            ty += 44

    # totals
    t = ledger.get("totals", {})
    y = 1180
    dr.text((72, y), f"open {t.get('open', 0)} · resolved {t.get('resolved', 0)} · hit {t.get('hit', 0)} · invalidated {t.get('invalidated', 0)} — misses stay on the page by design", font=font(26), fill=MUTE)
    dr.line([(72, y + 52), (W - 72, y + 52)], fill=LINE, width=2)
    dr.text((72, y + 76), "aztmm.com/performance-archive · research, not advice", font=font(28, True), fill=CYAN)

    out = ROOT / "social" / "latest-card.png"
    out.parent.mkdir(exist_ok=True)
    img.save(out, "PNG")
    print(f"card written: {out}")


if __name__ == "__main__":
    main()
