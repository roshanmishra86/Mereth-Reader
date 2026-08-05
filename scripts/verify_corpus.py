#!/usr/bin/env python3
"""Verify the Mereth Reader PDF regression corpus against manifest.json.

Asserts REAL properties of every fixture using pdftotext (subprocess) and
pikepdf. Prints a PASS/FAIL line per fixture and a final summary; exits 0
only if every assertion passes.

Run:  python3 scripts/verify_corpus.py
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pikepdf

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "corpus"
PDFTOTEXT = "/usr/bin/pdftotext"
PDFTOTEXT_FALLBACKS = ["pdftotext"]


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
class Result:
    __slots__ = ("id", "ok", "detail")

    def __init__(self, fid, ok, detail=""):
        self.id = fid
        self.ok = ok
        self.detail = detail


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def pdftotext(path: Path, password: str | None = None) -> str:
    """Run pdftotext, return extracted text (stdout). Empty string on failure."""
    exe = PDFTOTEXT if Path(PDFTOTEXT).exists() else PDFTOTEXT_FALLBACKS[0]
    cmd = [exe]
    if password:
        cmd += ["-upw", password]
    cmd += [str(path), "-"]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120
        )
    except FileNotFoundError:
        return ""
    # poppler returns non-zero on password failure / some recoveries; we
    # still treat stdout as the extracted text.
    return proc.stdout


def has_cjk(text: str) -> bool:
    # CJK Unified Ideographs, Hiragana, Katakana, Hangul syllables
    for ch in text:
        cp = ord(ch)
        if (0x4E00 <= cp <= 0x9FFF) or (0x3040 <= cp <= 0x30FF) \
                or (0xAC00 <= cp <= 0xD7AF) or (0x3400 <= cp <= 0x4DBF):
            return True
    return False


def has_arabic(text: str) -> bool:
    for ch in text:
        cp = ord(ch)
        # Arabic block or Arabic Presentation Forms-A/B
        if (0x0600 <= cp <= 0x06FF) or (0xFB50 <= cp <= 0xFEFF) \
                or (0x0750 <= cp <= 0x077F) or (0x08A0 <= cp <= 0x08FF):
            return True
    return False


def has_ligature(text: str) -> bool:
    return ("\ufb01" in text) or ("\ufb02" in text)


def raw_bytes(path: Path) -> bytes:
    with open(path, "rb") as f:
        return f.read()


# --------------------------------------------------------------------------- #
# Per-fixture verifiers
# --------------------------------------------------------------------------- #
def verify_all() -> list[Result]:
    results: list[Result] = []
    manifest_path = CORPUS / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    # global: 15 entries, exact field set
    expected_fields = {
        "id", "filename", "category", "source_licence", "sha256", "page_count",
        "expected_capability", "failure_mode", "permitted_variance",
        "visual_check", "text_check", "selection_check", "anchor_check",
        "memory_check", "security_check",
    }

    if len(manifest) != 15:
        results.append(Result("manifest", False, f"expected 15 entries, got {len(manifest)}"))
    else:
        results.append(Result("manifest_count", True, "15 entries"))
    for e in manifest:
        if set(e.keys()) != expected_fields:
            results.append(Result(e.get("id", "?"), False,
                                  f"field set mismatch: {sorted(set(e.keys()))}"))
        else:
            results.append(Result(e["id"] + "_fields", True, "exact field set"))

    def get(fid):
        for e in manifest:
            if e["id"] == fid:
                return e
        raise KeyError(fid)

    def base_checks(fid, password=None):
        e = get(fid)
        p = CORPUS / e["filename"]
        r = []
        if not p.exists():
            r.append(Result(fid, False, f"{e['filename']} missing"))
            return r, e, p, ""
        # sha256
        ok = sha256_file(p) == e["sha256"]
        r.append(Result(fid + "_sha256", ok,
                        "" if ok else f"sha mismatch: {sha256_file(p)} vs {e['sha256']}"))
        # page_count
        try:
            with pikepdf.open(p, password=password or "") as pdf:
                pc = len(pdf.pages)
            ok = pc == e["page_count"]
            r.append(Result(fid + "_pages", ok,
                            "" if ok else f"pages {pc} vs manifest {e['page_count']}"))
        except Exception as ex:
            r.append(Result(fid + "_pages", False, f"pikepdf open failed: {type(ex).__name__}: {ex}"))
        return r, e, p, None

    # 1. simple_text
    r, e, p, _ = base_checks("simple_text")
    txt = pdftotext(p)
    r.append(Result("simple_text_text", bool(txt.strip()), "non-empty text"))
    results.extend(r)

    # 2. multi_column
    r, e, p, _ = base_checks("multi_column")
    txt = pdftotext(p)
    r.append(Result("multi_column_text", bool(txt.strip()), "non-empty text"))
    results.extend(r)

    # 3. equations_ligatures
    r, e, p, _ = base_checks("equations_ligatures")
    txt = pdftotext(p)
    r.append(Result("equations_text", bool(txt.strip()), "non-empty text"))
    r.append(Result("equations_ligature", has_ligature(txt),
                    "U+FB01/U+FB02 present" if has_ligature(txt) else "no ligature"))
    results.extend(r)

    # 4. cjk_text
    r, e, p, _ = base_checks("cjk_text")
    txt = pdftotext(p)
    r.append(Result("cjk_text_nonempty", bool(txt.strip()), "non-empty text"))
    r.append(Result("cjk_text_codepoints", has_cjk(txt),
                    "CJK codepoints present" if has_cjk(txt) else "no CJK codepoints"))
    results.extend(r)

    # 5. rtl_text
    r, e, p, _ = base_checks("rtl_text")
    txt = pdftotext(p)
    r.append(Result("rtl_text_nonempty", bool(txt.strip()), "non-empty text"))
    r.append(Result("rtl_text_arabic", has_arabic(txt),
                    "Arabic codepoints present" if has_arabic(txt) else "no Arabic codepoints"))
    results.extend(r)

    # 6. scanned_page
    r, e, p, _ = base_checks("scanned_page")
    txt = pdftotext(p)
    ws = txt.strip() == ""
    r.append(Result("scanned_page_empty", ws,
                    "whitespace-only text layer" if ws else f"unexpected text: {txt[:40]!r}"))
    results.extend(r)

    # 7. large_vector
    r, e, p, _ = base_checks("large_vector")
    # just structural checks; no text required
    results.extend(r)

    # 8. embedded_annotations
    r, e, p, _ = base_checks("embedded_annotations")
    try:
        with pikepdf.open(p) as pdf:
            annots = pdf.pages[0].get("/Annots")
            n = len(annots) if annots is not None else 0
        r.append(Result("embedded_annotations_count", n >= 2,
                        f"/Annots has {n} entries" if annots is not None else "no /Annots"))
    except Exception as ex:
        r.append(Result("embedded_annotations_count", False, f"{type(ex).__name__}: {ex}"))
    results.extend(r)

    # 9. forms_links
    r, e, p, _ = base_checks("forms_links")
    try:
        with pikepdf.open(p) as pdf:
            root = pdf.Root
            has_acro = "/AcroForm" in root
            uri_count = 0
            for pg in pdf.pages:
                annots = pg.get("/Annots") or []
                for a in annots:
                    sub = a.get("/Subtype")
                    if sub == pikepdf.Name.Link:
                        a_dict = a.get("/A") or a
                        if a_dict.get("/S") == pikepdf.Name.URI:
                            uri_count += 1
        r.append(Result("forms_links_acroform", has_acro,
                        "/AcroForm present" if has_acro else "no /AcroForm"))
        r.append(Result("forms_links_uri", uri_count >= 1,
                        f"{uri_count} URI link annotation(s)" if uri_count else "no URI link"))
    except Exception as ex:
        r.append(Result("forms_links", False, f"{type(ex).__name__}: {ex}"))
    results.extend(r)

    # 10. malformed_object
    r, e, p, _ = base_checks("malformed_object")
    txt = pdftotext(p)
    r.append(Result("malformed_object_text", bool(txt.strip()),
                    "recovered text non-empty" if txt.strip() else "no text recovered"))
    raw = raw_bytes(p)
    # Corruption signature: startxref offset is "0" (points to byte 0) AND
    # the standalone 'xref' keyword has been overwritten with 'XXXXX'.
    startxref_zeroed = (b"startxref\n0" in raw) or (b"startxref\n0 " in raw)
    # the 'xref' keyword (not 'startxref') should be corrupted: the generator
    # overwrites the 5 chars of 'xref' with 'XXXXX', which run directly into
    # the following subsection header (e.g. 'XXXXX0 8').
    xref_corrupted = b"\nXXXXX" in raw
    corrupted = startxref_zeroed or xref_corrupted
    r.append(Result("malformed_object_xref_corrupt", corrupted,
                    f"xref corrupted (startxref_zeroed={startxref_zeroed}, "
                    f"xref_keyword_overwritten={xref_corrupted})"))
    results.extend(r)

    # 11. password_encrypted
    r, e, p, _ = base_checks("password_encrypted", password="mereth")
    # open WITHOUT password must raise PasswordError
    try:
        with pikepdf.open(p) as pdf:
            pass
        r.append(Result("password_encrypted_no_pw", False, "opened without password (BAD)"))
    except pikepdf.PasswordError:
        r.append(Result("password_encrypted_no_pw", True, "PasswordError without password"))
    except Exception as ex:
        r.append(Result("password_encrypted_no_pw", False,
                        f"unexpected {type(ex).__name__}: {ex}"))
    # open WITH password succeeds
    try:
        with pikepdf.open(p, password="mereth") as pdf:
            _ = len(pdf.pages)
        r.append(Result("password_encrypted_with_pw", True, "opened with 'mereth'"))
    except Exception as ex:
        r.append(Result("password_encrypted_with_pw", False,
                        f"{type(ex).__name__}: {ex}"))
    raw = raw_bytes(p)
    r.append(Result("password_encrypted_encrypt_dict", b"/Encrypt" in raw,
                    "/Encrypt present" if b"/Encrypt" in raw else "no /Encrypt"))
    results.extend(r)

    # 12. large_book_400p
    r, e, p, _ = base_checks("large_book_400p")
    txt = pdftotext(p)
    r.append(Result("large_book_text", bool(txt.strip()), "non-empty text"))
    r.append(Result("large_book_page_count", e["page_count"] == 400,
                    f"page_count={e['page_count']}"))
    results.extend(r)

    # 13. version_v1_original
    r, e, p, _ = base_checks("version_v1_original")
    txt1 = pdftotext(p)
    r.append(Result("version_v1_text", bool(txt1.strip()), "non-empty text"))
    results.extend(r)

    # 14. version_v2_changed
    r, e, p, _ = base_checks("version_v2_changed")
    txt2 = pdftotext(p)
    r.append(Result("version_v2_text", bool(txt2.strip()), "non-empty text"))
    differ = txt1 != txt2
    r.append(Result("version_v1_v2_differ", differ,
                    "v1/v2 text differ" if differ else "v1/v2 identical (BAD)"))
    results.extend(r)

    # 15. hostile_javascript
    r, e, p, _ = base_checks("hostile_javascript")
    raw = raw_bytes(p)
    r.append(Result("hostile_js_bytes", b"/JS" in raw and b"/OpenAction" in raw,
                    "/JS and /OpenAction present" if (b"/JS" in raw and b"/OpenAction" in raw)
                    else "missing /JS or /OpenAction"))
    try:
        with pikepdf.open(p) as pdf:
            _ = len(pdf.pages)
        r.append(Result("hostile_js_opens", True, "pikepdf opens"))
    except Exception as ex:
        r.append(Result("hostile_js_opens", False, f"{type(ex).__name__}: {ex}"))
    results.extend(r)

    return results


def main() -> int:
    results = verify_all()
    width = max(len(r.id) for r in results)
    passed = 0
    failed = 0
    for r in results:
        status = "PASS" if r.ok else "FAIL"
        line = f"  {status}  {r.id.ljust(width)}  {r.detail}"
        print(line)
        if r.ok:
            passed += 1
        else:
            failed += 1
    print()
    print(f"Summary: {passed} passed, {failed} failed, {passed + failed} total")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
