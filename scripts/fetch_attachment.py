"""GitHub 이슈 본문에서 첫 번째 .xlsx 첨부 파일을 찾아 내려받는다.

이슈 본문은 누구나 쓸 수 있는 "신뢰할 수 없는 입력"이다. 그래서
  - 워크플로우에서는 본문을 ${{ }} 로 스크립트에 끼워 넣지 않고 환경 변수(ISSUE_BODY)로 받는다.
  - GitHub 첨부 파일 도메인만 허용하고, 크기를 제한한다.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

MAX_BYTES = 10 * 1024 * 1024
ALLOWED_HOSTS = ("github.com", "user-images.githubusercontent.com", "objects.githubusercontent.com")
LINK_PATTERN = re.compile(r"https://[^\s)\]\"'<>]+?\.xlsx", re.IGNORECASE)


def find_attachment_url(body: str) -> str | None:
    for match in LINK_PATTERN.finditer(body or ""):
        url = match.group(0)
        host = urlparse(url).hostname or ""
        if host in ALLOWED_HOSTS or host.endswith(".githubusercontent.com"):
            return url
    return None


def download(url: str, out: Path, token: str | None) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": "excel-dashboard-workflow"})
    if token and urlparse(url).hostname == "github.com":
        # private 저장소 첨부 파일 접근용. 리다이렉트된 다른 도메인에는 전달되지 않는다.
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError(f"첨부 파일이 너무 큽니다 (최대 {MAX_BYTES // 1024 // 1024}MB)")
    if not data.startswith(b"PK"):
        raise ValueError("올바른 .xlsx 파일이 아닙니다 (zip 서명 없음)")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return len(data)


def write_output(name: str, value: str) -> None:
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as fh:
            fh.write(f"{name}={value}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="이슈 본문의 .xlsx 첨부 파일 다운로드")
    parser.add_argument("--out", type=Path, default=Path("input.xlsx"))
    args = parser.parse_args()

    url = find_attachment_url(os.environ.get("ISSUE_BODY", ""))
    if not url:
        print("::error::이슈 본문에서 .xlsx 첨부 파일을 찾지 못했습니다. 파일을 본문에 끌어다 놓았는지 확인하세요.", file=sys.stderr)
        return 1
    try:
        size = download(url, args.out, os.environ.get("GITHUB_TOKEN"))
    except Exception as error:  # noqa: BLE001
        print(f"::error::첨부 파일 다운로드 실패: {error}", file=sys.stderr)
        return 1

    file_name = Path(urlparse(url).path).name
    write_output("file_name", file_name)
    print(f"✅ {file_name} 다운로드 완료 ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
