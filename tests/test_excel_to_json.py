"""변환기 단위 테스트 — Excel 없이(openpyxl) 실행된다.  실행: python -m pytest tests"""

import datetime as dt
import json
import sys
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import excel_to_json as conv  # noqa: E402


def make_workbook(path: Path) -> Path:
    book = Workbook()
    ws = book.active
    ws.title = "매출"
    ws.append(["월", "지역", "매출액", None])
    ws.append([dt.date(2026, 1, 1), "서울", 1000, None])
    ws.append([None, None, None, None])  # 빈 행은 버려져야 한다
    ws.append([dt.date(2026, 2, 1), "부산", 2500.0, "메모"])
    book.save(path)
    return path


def test_to_sheet_fills_blank_headers_and_drops_empty_rows():
    sheet = conv.to_sheet("s", [["a", None], [None, None], [1, 2]])
    assert sheet.header == ["a", "열2"]
    assert sheet.rows == [[1, 2]]


def test_to_json_value_normalizes_types():
    assert conv.to_json_value(dt.datetime(2026, 1, 1)) == "2026-01-01"
    assert conv.to_json_value(3.0) == 3
    assert conv.to_json_value("  공백 ") == "공백"


def test_end_to_end_with_openpyxl(tmp_path):
    src = make_workbook(tmp_path / "in.xlsx")
    out = tmp_path / "out.json"
    assert conv.main([str(src), "--out", str(out), "--engine", "openpyxl", "--issue", "7"]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    sheet = data["sheets"][0]
    assert data["source"] == {"file": "in.xlsx", "issue": 7, "engine": "openpyxl", "warnings": []}
    assert [c["type"] for c in sheet["columns"]] == ["date", "text", "number", "text"]
    assert sheet["summary"] == {"rowCount": 2, "totals": {"매출액": 3500}}


def test_auto_engine_falls_back_when_excel_is_unavailable(tmp_path, monkeypatch):
    def broken(self, path):
        raise OSError("Excel이 설치되어 있지 않습니다")

    monkeypatch.setattr(conv.XlwingsReader, "read", broken)
    result = conv.read_workbook(make_workbook(tmp_path / "in.xlsx"), "auto")
    assert result.engine == "openpyxl"
    assert "xlwings 실패" in result.warnings[0]


def test_missing_input_returns_error(tmp_path):
    assert conv.main([str(tmp_path / "nope.xlsx")]) == 1
