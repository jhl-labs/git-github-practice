"""엑셀(.xlsx) → 대시보드용 JSON 변환기.

사용 예:
    python scripts/excel_to_json.py input.xlsx --out build/data.json --engine auto

엔진:
    xlwings  : 실제 Microsoft Excel 앱을 띄워 읽는다. 수식 결과를 Excel이 계산해 준다.
               (Windows/macOS + Excel 설치 필요 → GitHub-hosted runner에는 Excel이 없다)
    openpyxl : 순수 파이썬으로 파일을 읽는다. 어디서나 빠르게 동작하지만
               수식 셀은 "마지막으로 Excel에서 저장할 때의 계산값"만 읽을 수 있다.
    auto     : xlwings를 먼저 시도하고, 실패하면 openpyxl로 대체한다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

SCHEMA_VERSION = 1
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


@dataclass
class Sheet:
    name: str
    header: list[str]
    rows: list[list[Any]]


@dataclass
class ReadResult:
    sheets: list[Sheet]
    engine: str
    warnings: list[str] = field(default_factory=list)


class WorkbookReader(Protocol):
    name: str

    def read(self, path: Path) -> list[Sheet]: ...


class XlwingsReader:
    """실제 Excel 앱을 백그라운드로 실행해 읽는다."""

    name = "xlwings"

    def read(self, path: Path) -> list[Sheet]:
        import xlwings as xw  # Excel이 없는 환경에서도 모듈 import 자체는 지연시킨다

        app = xw.App(visible=False, add_book=False)
        try:
            app.display_alerts = False
            book = app.books.open(str(path.resolve()), read_only=True)
            try:
                return [to_sheet(ws.name, ws.used_range.options(ndim=2).value or []) for ws in book.sheets]
            finally:
                book.close()
        finally:
            app.quit()


class OpenpyxlReader:
    """Excel 없이 .xlsx 파일 구조(XML)를 직접 읽는다."""

    name = "openpyxl"

    def read(self, path: Path) -> list[Sheet]:
        from openpyxl import load_workbook

        book = load_workbook(path, read_only=True, data_only=True)
        try:
            return [to_sheet(ws.title, [list(r) for r in ws.iter_rows(values_only=True)]) for ws in book.worksheets]
        finally:
            book.close()


READERS: dict[str, list[type]] = {
    "auto": [XlwingsReader, OpenpyxlReader],
    "xlwings": [XlwingsReader],
    "openpyxl": [OpenpyxlReader],
}


def to_sheet(name: str, values: list[list[Any]]) -> Sheet:
    """빈 행을 버리고 첫 행을 머리글로 사용한다. 빈 머리글은 '열N'으로 채운다."""
    rows = [list(r) for r in values if r is not None and any(v not in (None, "") for v in r)]
    if not rows:
        return Sheet(name=name, header=[], rows=[])
    header = [str(h).strip() if h not in (None, "") else f"열{i + 1}" for i, h in enumerate(rows[0])]
    width = len(header)
    body = [(r + [None] * width)[:width] for r in rows[1:]]
    return Sheet(name=name, header=header, rows=body)


def read_workbook(path: Path, engine: str) -> ReadResult:
    warnings: list[str] = []
    for reader_cls in READERS[engine]:
        reader: WorkbookReader = reader_cls()
        try:
            return ReadResult(sheets=reader.read(path), engine=reader.name, warnings=warnings)
        except Exception as error:  # noqa: BLE001 - 다음 엔진으로 넘어가기 위해 모든 실패를 기록
            warnings.append(f"{reader.name} 실패: {type(error).__name__}: {error}")
    raise RuntimeError("엑셀을 읽지 못했습니다.\n" + "\n".join(warnings))


def to_json_value(value: Any) -> Any:
    """JSON으로 표현할 수 있는 값으로 정규화한다."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, dt.datetime):
        return value.date().isoformat() if value.time() == dt.time() else value.isoformat(timespec="minutes")
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, float):
        return int(value) if value.is_integer() else round(value, 6)
    if isinstance(value, int):
        return value
    return str(value).strip()


def column_type(values: list[Any]) -> str:
    present = [v for v in values if v is not None and v != ""]
    if present and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in present):
        return "number"
    if present and all(isinstance(v, str) and ISO_DATE.match(v) for v in present):
        return "date"
    return "text"


def build_sheet_payload(sheet: Sheet) -> dict[str, Any]:
    rows = [[to_json_value(v) for v in r] for r in sheet.rows]
    columns = [{"name": name, "type": column_type([r[i] for r in rows])} for i, name in enumerate(sheet.header)]
    totals = {
        col["name"]: round(sum(r[i] or 0 for r in rows), 6)
        for i, col in enumerate(columns)
        if col["type"] == "number"
    }
    return {
        "name": sheet.name,
        "columns": columns,
        "rows": [dict(zip(sheet.header, r)) for r in rows],
        "summary": {"rowCount": len(rows), "totals": totals},
    }


def build_payload(result: ReadResult, source: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": {**source, "engine": result.engine, "warnings": result.warnings},
        "sheets": [build_sheet_payload(s) for s in result.sheets if s.header],
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="엑셀 파일을 대시보드용 JSON으로 변환합니다.")
    parser.add_argument("input", type=Path, help="변환할 .xlsx 파일")
    parser.add_argument("--out", type=Path, default=Path("build/data.json"), help="출력 JSON 경로")
    parser.add_argument("--engine", choices=sorted(READERS), default="auto", help="엑셀 읽기 엔진")
    parser.add_argument("--issue", type=int, default=None, help="엑셀이 첨부된 GitHub 이슈 번호")
    parser.add_argument("--file-name", default=None, help="원본 파일 이름(표시용)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if not args.input.is_file():
        print(f"::error::입력 파일이 없습니다: {args.input}", file=sys.stderr)
        return 1
    try:
        result = read_workbook(args.input, args.engine)
    except RuntimeError as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1

    for warning in result.warnings:
        # GitHub Actions 로그에서 노란 경고로 표시된다
        print(f"::warning::{warning} → 다음 엔진으로 대체했습니다.")

    payload = build_payload(result, {"file": args.file_name or args.input.name, "issue": args.issue})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    sheets = ", ".join(f"{s['name']}({s['summary']['rowCount']}행)" for s in payload["sheets"])
    print(f"✅ 변환 완료 [{result.engine}] → {args.out} : {sheets}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
