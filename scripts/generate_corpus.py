#!/usr/bin/env python3
"""Regenerate the Mereth Reader PDF regression corpus with REAL content.

Produces 15 fixtures into corpus/ and a manifest.json describing them.
Uses reportlab (PDF authoring) + pikepdf (post-processing for annotations,
encryption, JavaScript, xref corruption) + Pillow (scan image) +
arabic_reshaper/python-bidi (RTL shaping).

Run:  python3 scripts/generate_corpus.py
Verify: python3 scripts/verify_corpus.py
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pikepdf
from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.units import inch

import arabic_reshaper
import bidi.algorithm

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "corpus"
ASSETS = ROOT / "scripts" / "assets"
DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
NOTO_ARABIC = ASSETS / "NotoSansArabic-Regular.ttf"

PAGE_W, PAGE_H = letter  # 612 x 792


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def page_count(path: Path, password: str | None = None) -> int:
    pw = password if password else ""
    with pikepdf.open(path, password=pw) as pdf:
        return len(pdf.pages)


def make_canvas(path: Path, **kw) -> canvas.Canvas:
    return canvas.Canvas(str(path), pagesize=letter, **kw)


# --------------------------------------------------------------------------- #
# 1. simple_text.pdf
# --------------------------------------------------------------------------- #
def gen_simple_text() -> Path:
    p = CORPUS / "simple_text.pdf"
    c = make_canvas(p)
    c.setFont("Helvetica", 14)
    c.drawString(72, 720, "Mereth Reader — Simple Text Fixture")
    c.setFont("Helvetica", 11)
    lines = [
        "This is a synthetic single-page document authored for the",
        "Mereth Reader regression corpus. It contains ordinary Latin",
        "prose spanning several lines so that text extraction, layout",
        "analysis, and selection behaviour can be validated against a",
        "known-good baseline.",
        "",
        "The quick brown fox jumps over the lazy dog. Pack my box",
        "with five dozen liquor jugs. Sphinx of black quartz, judge",
        "my vow.",
    ]
    y = 690
    for ln in lines:
        c.drawString(72, y, ln)
        y -= 16
    c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 2. multi_column.pdf
# --------------------------------------------------------------------------- #
def gen_multi_column() -> Path:
    p = CORPUS / "multi_column.pdf"
    c = make_canvas(p)
    left_x, right_x = 72, 324
    col_w = 234
    for page in range(2):
        c.setFont("Helvetica-Bold", 13)
        c.drawString(72, 730, f"Two-Column Layout — Page {page + 1} of 2")
        c.setFont("Helvetica", 10)
        y = 700
        col = 0
        x = left_x
        para = (
            f"Page {page+1}. The left column begins at x=72 and the right "
            f"column begins at x=324. Each column is approximately "
            f"{col_w} points wide. This layout tests the reader's ability "
            f"to reconstruct reading order across columns and to handle "
            f"multi-page documents with consistent geometry. Line {page+1}."
        ).split()
        # Simple word-wrap into the two columns
        line = ""
        for w in para:
            if pdfmetrics.stringWidth(line + " " + w, "Helvetica", 10) < col_w:
                line = (line + " " + w).strip()
            else:
                c.drawString(x, y, line)
                y -= 14
                line = w
                if y < 80:
                    if col == 0:
                        col = 1
                        x = right_x
                        y = 700
                    else:
                        break
        if line:
            c.drawString(x, y, line)
        c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 3. equations_ligatures.pdf
# --------------------------------------------------------------------------- #
def gen_equations_ligatures() -> Path:
    p = CORPUS / "equations_ligatures.pdf"
    c = make_canvas(p)
    pdfmetrics.registerFont(TTFont("DejaVuSans", DEJAVU))
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, 720, "Equations and Ligatures Fixture")
    c.setFont("DejaVuSans", 12)
    lines = [
        "Ligature test: ﬁnance, ﬂuid, ﬁlter, ﬂavour, ﬁve, ﬂock.",
        "Math symbols:  3 × 4 = 12    15 ÷ 5 = 3",
        "               a ≠ b         x ≤ y ≤ z",
        "               π ≈ 3.14159   ∑ ≈ approximation",
        "               √2 ≈ 1.4142   2³ = 8",
        "Compound:  (ﬁ + ﬂ) × ÷ ≠ ≤ ≥ ≈",
    ]
    y = 680
    for ln in lines:
        c.drawString(72, y, ln)
        y -= 22
    c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 4. cjk_text.pdf
# --------------------------------------------------------------------------- #
def gen_cjk_text() -> Path:
    p = CORPUS / "cjk_text.pdf"
    c = make_canvas(p)
    # reportlab bundles Adobe CMaps for these CID fonts
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))       # Chinese
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiMin-W3"))       # Japanese
    pdfmetrics.registerFont(UnicodeCIDFont("HYSMyeongJo-Medium")) # Korean

    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, 720, "CJK Text Fixture (Chinese / Japanese / Korean)")

    c.setFont("STSong-Light", 16)
    c.drawString(72, 660, "中文测试文档：法律阅读器语料库")
    c.drawString(72, 630, "第二行：这是一段用于回归测试的中文段落。")

    c.setFont("HeiseiMin-W3", 16)
    c.drawString(72, 570, "日本語テスト文書")
    c.drawString(72, 540, "二行目：これは回帰テスト用の日本語段落です。")

    c.setFont("HYSMyeongJo-Medium", 16)
    c.drawString(72, 480, "한국어 시험 문서")
    c.drawString(72, 450, "두 번째 줄: 회귀 테스트를 위한 한국어 문단입니다.")

    c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 5. rtl_text.pdf
# --------------------------------------------------------------------------- #
def gen_rtl_text() -> Path:
    p = CORPUS / "rtl_text.pdf"
    c = make_canvas(p)
    pdfmetrics.registerFont(TTFont("NotoArabic", str(NOTO_ARABIC)))

    c.setFont("Helvetica-Bold", 12)
    c.drawString(72, 720, "RTL Arabic Fixture (right-to-left)")

    arabic = "هذا نص تجريبي باللغة العربية للقراءة من اليمين إلى اليسار"
    reshaped = arabic_reshaper.reshape(arabic)
    display = bidi.algorithm.get_display(reshaped)

    c.setFont("NotoArabic", 16)
    # right-aligned: page width - right margin
    right_edge = PAGE_W - 72
    text_w = c.stringWidth(display, "NotoArabic", 16)
    c.drawString(right_edge - text_w, 660, display)

    arabic2 = "الميريث قارئ: اختبار الاتجاه والتشكيل للنص العربي."
    disp2 = bidi.algorithm.get_display(arabic_reshaper.reshape(arabic2))
    w2 = c.stringWidth(disp2, "NotoArabic", 16)
    c.drawString(right_edge - w2, 630, disp2)

    c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 6. scanned_page.pdf  (image only, no text layer)
# --------------------------------------------------------------------------- #
def gen_scanned_page() -> Path:
    p = CORPUS / "scanned_page.pdf"
    # Build a grayscale scan-like PNG
    img_path = ASSETS / "scan_page.png"
    W, H = 800, 1000
    img = Image.new("L", (W, H), 235)
    px = img.load()
    import random
    rnd = random.Random(42)
    for _ in range(W * H // 6):
        x, y = rnd.randrange(W), rnd.randrange(H)
        px[x, y] = rnd.randint(0, 120)
    d = ImageDraw.Draw(img)
    # a few shapes to look like a scanned document
    d.rectangle([120, 150, 680, 220], fill=180)
    d.rectangle([120, 260, 600, 300], fill=170)
    d.rectangle([120, 320, 650, 360], fill=170)
    d.rectangle([120, 380, 540, 420], fill=170)
    d.ellipse([300, 520, 500, 720], outline=90, width=4)
    img.save(img_path, "PNG")

    c = make_canvas(p)
    # full-page image, NO drawString anywhere
    c.drawImage(str(img_path), 0, 0, width=PAGE_W, height=PAGE_H)
    c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 7. large_vector.pdf
# --------------------------------------------------------------------------- #
def gen_large_vector() -> Path:
    p = CORPUS / "large_vector.pdf"
    c = make_canvas(p)
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(0.5)
    import random
    rnd = random.Random(7)
    n = 0
    for _ in range(60):
        x1 = rnd.uniform(40, PAGE_W - 40)
        y1 = rnd.uniform(40, PAGE_H - 40)
        x2 = rnd.uniform(40, PAGE_W - 40)
        y2 = rnd.uniform(40, PAGE_H - 40)
        c.line(x1, y1, x2, y2)
        n += 1
    # a few explicit lines to guarantee ≥50
    for i in range(20):
        c.line(72, 100 + i * 10, 540, 100 + i * 10)
        n += 1
    c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 8. embedded_annotations.pdf  (Text + Highlight annotations via pikepdf)
# --------------------------------------------------------------------------- #
def gen_embedded_annotations() -> Path:
    p = CORPUS / "embedded_annotations.pdf"
    # First author a base PDF with a line of text.
    base = CORPUS / "_embed_base.pdf"
    c = make_canvas(base)
    c.setFont("Helvetica", 12)
    c.drawString(72, 700, "Embedded Annotations Fixture: a highlight and a sticky note.")
    c.showPage()
    c.save()

    with pikepdf.open(base) as pdf:
        page = pdf.pages[0]
        pdfmap = pdf

        # Highlight over a rectangle on the text line
        hl = pikepdf.Dictionary(
            Type=pikepdf.Name.Annot,
            Subtype=pikepdf.Name.Highlight,
            Rect=pikepdf.Array([60, 690, 480, 712]),
            C=pikepdf.Array([1, 1, 0]),
            Contents=pikepdf.String("Highlighted by Mereth corpus generator"),
            T=pikepdf.String("Mereth"),
            P=pdfmap.make_stream(b"") if False else page.obj,  # reference to page
        )
        # Text / sticky note
        note = pikepdf.Dictionary(
            Type=pikepdf.Name.Annot,
            Subtype=pikepdf.Name.Text,
            Rect=pikepdf.Array([500, 690, 520, 712]),
            Contents=pikepdf.String("Sticky note from Mereth corpus generator"),
            T=pikepdf.String("Mereth"),
            Name=pikepdf.Name.Comment,
            C=pikepdf.Array([1, 0.9, 0]),
        )
        # Attach to page
        if "/Annots" not in page:
            page.Annots = pikepdf.Array()
        page.Annots.append(pdfmap.make_indirect(hl))
        page.Annots.append(pdfmap.make_indirect(note))
        pdf.save(str(p))
    base.unlink(missing_ok=True)
    return p


# --------------------------------------------------------------------------- #
# 9. forms_links.pdf  (AcroForm text + checkbox + URI link)
# --------------------------------------------------------------------------- #
def gen_forms_links() -> Path:
    p = CORPUS / "forms_links.pdf"
    c = make_canvas(p)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, 720, "Forms and Links Fixture")

    c.setFont("Helvetica", 11)
    c.drawString(72, 680, "Name:")
    c.acroForm.textfield(
        name="name_field",
        tooltip="Enter your name",
        x=120, y=676, width=300, height=18,
        borderWidth=1, forceBorder=True,
    )
    c.drawString(72, 640, "Subscribe:")
    c.acroForm.checkbox(
        name="subscribe_box",
        tooltip="Subscribe to updates",
        x=160, y=636, size=18,
        borderWidth=1, forceBorder=True,
    )

    # URI link annotation over a rectangle
    c.linkURL(
        "https://example.org/mereth",
        (72, 580, 380, 600),
        relative=0,
        thickness=1,
    )
    c.setFont("Helvetica-Oblique", 11)
    c.drawString(72, 588, "Click here to visit https://example.org/mereth")
    c.showPage()
    c.save()

    # reportlab writes AcroForm + link already; ensure catalog has /AcroForm
    return p


# --------------------------------------------------------------------------- #
# 10. malformed_object.pdf  (corrupt xref, recoverable)
# --------------------------------------------------------------------------- #
def gen_malformed_object() -> Path:
    p = CORPUS / "malformed_object.pdf"
    base = CORPUS / "_mal_base.pdf"
    c = make_canvas(base)
    c.setFont("Helvetica", 12)
    c.drawString(72, 700, "Malformed XRef Fixture: body intact, xref corrupted.")
    c.drawString(72, 680, "A strict parser must observe corruption but recovery-by-scan works.")
    c.showPage()
    c.save()

    raw = base.read_bytes()
    out = bytearray(raw)
    # Corrupt the cross-reference structures so a strict parser cannot locate
    # the xref table or trailer via startxref, forcing recovery-by-scan. We
    # (1) replace the 'xref' keyword with garbage and (2) zero the startxref
    # offset so it points to byte 0. All body objects remain intact, so
    # poppler/pikepdf rebuild the xref by scanning and still extract text.
    xref_idx = raw.rfind(b"\nxref\n")
    if xref_idx >= 0:
        for i in range(xref_idx + 1, xref_idx + 6):  # overwrite 'xref'
            out[i] = 0x58  # 'X'
    startxref_idx = raw.rfind(b"startxref")
    if startxref_idx >= 0:
        num_start = startxref_idx + len(b"startxref") + 1
        num_end = raw.find(b"\n%%EOF", num_start)
        if num_end < 0:
            num_end = raw.find(b"\n", num_start)
        # Replace the offset digits with '0' so startxref points to byte 0.
        for i in range(num_start, num_end):
            out[i] = 0x30 if (i - num_start) == 0 else 0x20
    p.write_bytes(bytes(out))
    base.unlink(missing_ok=True)
    return p


# --------------------------------------------------------------------------- #
# 11. password_encrypted.pdf
# --------------------------------------------------------------------------- #
def gen_password_encrypted() -> Path:
    p = CORPUS / "password_encrypted.pdf"
    base = CORPUS / "_enc_base.pdf"
    c = make_canvas(base)
    c.setFont("Helvetica", 12)
    c.drawString(72, 700, "Password Encrypted Fixture (user=owner=mereth)")
    c.drawString(72, 680, "Opening without the password must fail.")
    c.showPage()
    c.save()

    with pikepdf.open(base) as pdf:
        pdf.save(
            str(p),
            encryption=pikepdf.Encryption(
                user="mereth", owner="mereth", R=4
            ),
        )
    base.unlink(missing_ok=True)
    return p


# --------------------------------------------------------------------------- #
# 12. large_book_400p.pdf
# --------------------------------------------------------------------------- #
def gen_large_book() -> Path:
    p = CORPUS / "large_book_400p.pdf"
    c = make_canvas(p)
    chapters = [
        ("Chapter 1: Foundations", "The architecture of a reader begins with its document model."),
        ("Chapter 2: Rendering", "Each page is a layout surface with text, vector, and image content."),
        ("Chapter 3: Annotations", "Annotations attach to rectangles and persist across page turns."),
        ("Chapter 4: Search", "Full-text search indexes the extracted text of every page."),
        ("Chapter 5: Persistence", "A document library is a directory with metadata sidecars."),
    ]
    para_seed = ("This is body paragraph {n} of chapter {ch}. The Mereth Reader "
                 "regression corpus uses synthetic prose so that page counts, "
                 "layout geometry, and text extraction can all be validated "
                 "deterministically. Sentence {s}.")
    for page in range(400):
        ch = page % len(chapters)
        if page % 20 == 0:
            c.setFont("Helvetica-Bold", 16)
            c.drawString(72, 740, chapters[ch][0])
            c.setFont("Helvetica", 11)
            c.drawString(72, 720, chapters[ch][1])
            y = 690
        else:
            c.setFont("Helvetica", 11)
            c.drawString(72, 740, f"Page {page+1}")
            y = 710
        for n in range(20):
            c.drawString(72, y, para_seed.format(n=n, ch=ch+1, s=n*page))
            y -= 14
            if y < 60:
                break
        c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 13. version_v1_original.pdf
# --------------------------------------------------------------------------- #
def gen_version_v1() -> Path:
    p = CORPUS / "version_v1_original.pdf"
    c = make_canvas(p)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, 720, "Original Edition V1")
    c.setFont("Helvetica", 11)
    c.drawString(72, 690, "This is the first line, identical across both versions.")
    c.drawString(72, 670, "Paragraph A: The quick brown fox jumps over the lazy dog.")
    c.drawString(72, 650, "Paragraph B: Pack my box with five dozen liquor jugs.")
    c.drawString(72, 630, "Paragraph C: Sphinx of black quartz, judge my vow.")
    c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 14. version_v2_changed.pdf
# --------------------------------------------------------------------------- #
def gen_version_v2() -> Path:
    p = CORPUS / "version_v2_changed.pdf"
    c = make_canvas(p)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, 720, "Original Edition V1")  # same first line
    c.setFont("Helvetica", 11)
    c.drawString(72, 690, "This is the first line, identical across both versions.")
    c.drawString(72, 670, "Paragraph A: The quick brown fox leaps over the lazy hound.")  # edited
    c.drawString(72, 650, "Paragraph B: Pack my box with five dozen liquor jugs.")
    c.drawString(72, 630, "Paragraph B2: INSERTED — a new paragraph for anchor testing.")
    c.drawString(72, 610, "Paragraph C: Sphinx of black quartz, judge my vow.")
    c.showPage()
    c.save()
    return p


# --------------------------------------------------------------------------- #
# 15. hostile_javascript.pdf  (OpenAction -> JS)
# --------------------------------------------------------------------------- #
def gen_hostile_javascript() -> Path:
    p = CORPUS / "hostile_javascript.pdf"
    base = CORPUS / "_js_base.pdf"
    c = make_canvas(base)
    c.setFont("Helvetica", 12)
    c.drawString(72, 700, "Hostile JavaScript Fixture (OpenAction -> app.alert)")
    c.showPage()
    c.save()

    with pikepdf.open(base) as pdf:
        root = pdf.Root
        js_stream = pdf.make_stream(b'app.alert("Mereth Reader hostile fixture")')
        open_action = pikepdf.Dictionary(
            S=pikepdf.Name.JavaScript,
            JS=js_stream,
        )
        root.OpenAction = pdf.make_indirect(open_action)
        pdf.save(str(p))
    base.unlink(missing_ok=True)
    return p


# --------------------------------------------------------------------------- #
# Manifest
# --------------------------------------------------------------------------- #
MANIFEST_FIELDS = [
    "id", "filename", "category", "source_licence", "sha256", "page_count",
    "expected_capability", "failure_mode", "permitted_variance",
    "visual_check", "text_check", "selection_check", "anchor_check",
    "memory_check", "security_check",
]

def manifest_entry(id, filename, category, capability, failure_mode, **checks):
    p = CORPUS / filename
    return {
        "id": id,
        "filename": filename,
        "category": category,
        "source_licence": "CC0 / Public Domain",
        "sha256": sha256_file(p),
        "page_count": page_count(p, password="mereth" if id == "password_encrypted" else None),
        "expected_capability": capability,
        "failure_mode": failure_mode,
        "permitted_variance": checks.get("permitted_variance", "none"),
        "visual_check": checks.get("visual_check", False),
        "text_check": checks.get("text_check", False),
        "selection_check": checks.get("selection_check", False),
        "anchor_check": checks.get("anchor_check", False),
        "memory_check": checks.get("memory_check", False),
        "security_check": checks.get("security_check", False),
    }


def build_manifest() -> list[dict]:
    entries = []

    def add(**kw):
        entries.append(manifest_entry(**kw))

    add(id="simple_text", filename="simple_text.pdf", category="simple_text",
        capability="text extraction of plain Latin prose",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True)
    add(id="multi_column", filename="multi_column.pdf", category="multi_column",
        capability="two-column reading-order reconstruction across pages",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True)
    add(id="equations_ligatures", filename="equations_ligatures.pdf",
        category="equations_ligatures",
        capability="ligature glyphs and math symbol rendering/extraction",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True)
    add(id="cjk_text", filename="cjk_text.pdf", category="cjk_text",
        capability="Chinese/Japanese/Korean glyph extraction via CID fonts",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True)
    add(id="rtl_text", filename="rtl_text.pdf", category="rtl_text",
        capability="right-to-left Arabic shaping and extraction",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True)
    add(id="scanned_page", filename="scanned_page.pdf", category="scanned_page",
        capability="image-only page with empty text layer (OCR boundary)",
        failure_mode="empty_text_layer", text_check=False, selection_check=False,
        visual_check=True)
    add(id="large_vector", filename="large_vector.pdf", category="large_vector",
        capability="vector-line rendering performance",
        failure_mode=None, text_check=False, selection_check=False, visual_check=True)
    add(id="embedded_annotations", filename="embedded_annotations.pdf",
        category="embedded_annotations",
        capability="Text/sticky-note and Highlight annotation parsing",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True,
        anchor_check=True)
    add(id="forms_links", filename="forms_links.pdf", category="forms_links",
        capability="AcroForm fields and URI link annotation handling",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True)
    add(id="malformed_object", filename="malformed_object.pdf",
        category="malformed_object",
        capability="recovery-by-scan of a corrupted xref with intact body",
        failure_mode="non_fatal_recovery", text_check=True, selection_check=True,
        visual_check=True)
    add(id="password_encrypted", filename="password_encrypted.pdf",
        category="password_encrypted",
        capability="encrypted document open with user password",
        failure_mode="password_required", text_check=True, selection_check=True,
        visual_check=True, security_check=True)
    add(id="large_book_400p", filename="large_book_400p.pdf",
        category="large_book",
        capability="large-document paging and memory ceiling",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True,
        memory_check=True)
    add(id="version_v1_original", filename="version_v1_original.pdf",
        category="version_v1_original",
        capability="baseline version for annotation re-anchoring",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True,
        anchor_check=True)
    add(id="version_v2_changed", filename="version_v2_changed.pdf",
        category="version_v2_changed",
        capability="edited version for annotation re-anchoring delta test",
        failure_mode=None, text_check=True, selection_check=True, visual_check=True,
        anchor_check=True)
    add(id="hostile_javascript", filename="hostile_javascript.pdf",
        category="hostile_javascript",
        capability="safe loading of a hostile JS-bearing PDF with scripting disabled",
        failure_mode="embedded_javascript", text_check=False, selection_check=False,
        visual_check=True, security_check=True)

    # enforce exact field set + ordering
    ordered = []
    for e in entries:
        ordered.append({k: e[k] for k in MANIFEST_FIELDS})
    return ordered


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    CORPUS.mkdir(exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    print("Generating fixtures...")
    steps = [
        ("simple_text", gen_simple_text),
        ("multi_column", gen_multi_column),
        ("equations_ligatures", gen_equations_ligatures),
        ("cjk_text", gen_cjk_text),
        ("rtl_text", gen_rtl_text),
        ("scanned_page", gen_scanned_page),
        ("large_vector", gen_large_vector),
        ("embedded_annotations", gen_embedded_annotations),
        ("forms_links", gen_forms_links),
        ("malformed_object", gen_malformed_object),
        ("password_encrypted", gen_password_encrypted),
        ("large_book_400p", gen_large_book),
        ("version_v1_original", gen_version_v1),
        ("version_v2_changed", gen_version_v2),
        ("hostile_javascript", gen_hostile_javascript),
    ]
    for name, fn in steps:
        p = fn()
        print(f"  {name:24s} -> {p.name} ({p.stat().st_size} bytes)")

    print("Building manifest...")
    manifest = build_manifest()
    (CORPUS / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"  manifest.json with {len(manifest)} entries")

    # cleanup old sham generator
    old = ROOT / "scripts" / "generate_corpus.js"
    if old.exists():
        old.unlink()
        print(f"  deleted {old.name}")


if __name__ == "__main__":
    main()
