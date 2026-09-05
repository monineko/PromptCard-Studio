"""卡片 xlsx 导入回归测试。"""

import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import cards  # noqa: E402


def _xlsx_with_inline_strings() -> bytes:
    sheet = """<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:D2"/><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>分类</t></is></c><c r="B1" t="inlineStr"><is><t>名称</t></is></c><c r="C1" t="inlineStr"><is><t>提示词</t></is></c><c r="D1" t="inlineStr"><is><t>图片（可选）</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>风格</t></is></c><c r="B2" t="inlineStr"><is><t>动漫风格</t></is></c><c r="C2" t="inlineStr"><is><t>anime style</t></is></c></row>
  </sheetData></worksheet>"""
    workbook = """<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>"""
    rels = """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"""
    content_types = """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"""
    root_rels = """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", rels)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return output.getvalue()


class CardsImportTest(unittest.TestCase):
    def test_imports_inline_string_cells(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            old = (
                cards.PROMPTCARDS_DIR,
                cards.CARD_IMAGES_FILE,
                cards.CARD_META_FILE,
                cards.CARD_PINS_FILE,
                cards.load_settings,
            )
            cards.PROMPTCARDS_DIR = root / "promptcards"
            cards.CARD_IMAGES_FILE = cards.PROMPTCARDS_DIR / ".card-images.json"
            cards.CARD_META_FILE = cards.PROMPTCARDS_DIR / ".card-meta.json"
            cards.CARD_PINS_FILE = cards.PROMPTCARDS_DIR / ".card-pins.json"
            cards.load_settings = lambda: {"library_path": str(root / "library")}  # type: ignore[method-assign]
            try:
                result = cards.import_template_xlsx(_xlsx_with_inline_strings())
                self.assertEqual(result["imported"], 1)
                self.assertEqual(result["errors"], [])
                self.assertEqual(
                    (root / "promptcards" / "风格" / "动漫风格.txt").read_text(encoding="utf-8"),
                    "anime style",
                )
            finally:
                (
                    cards.PROMPTCARDS_DIR,
                    cards.CARD_IMAGES_FILE,
                    cards.CARD_META_FILE,
                    cards.CARD_PINS_FILE,
                    cards.load_settings,
                ) = old


if __name__ == "__main__":
    unittest.main()
