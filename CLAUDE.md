# 엑셀 → GitHub Actions → Pages 대시보드

## 서비스 개요
1. 사용자가 GitHub 이슈(제목 `[EXCEL] ...`)에 엑셀(.xlsx) 파일을 첨부해 등록한다.
2. GitHub Actions의 `windows-latest` runner(job마다 새로 만들어지는 실제 Windows 서버 VM)가 첨부 파일을 내려받아
   xlwings로 읽고 JSON으로 변환한다. Excel이 없어 xlwings가 실패하면 openpyxl로 대체하고 경고를 남긴다.
3. 결과를 `docs` 브랜치의 `data/data.json`으로 커밋한다. (`docs` = 배포할 결과물 + 데이터 변경 이력)
4. 같은 실행의 deploy job이 `docs` 브랜치 내용을 GitHub Pages에 배포한다(Settings → Pages → Source: GitHub Actions).
   GITHUB_TOKEN으로 push한 커밋은 Pages 빌드를 트리거하지 않기 때문이다.
5. 대시보드는 비밀번호를 입력해야 KPI·차트·표를 보여준다. **학습용 흉내 로그인**이며 진짜 보안이 아니다.

## 폴더 구조
| 경로 | 내용 |
| --- | --- |
| `scripts/` | 파이썬 스크립트: 엑셀→JSON 변환기, 이슈 첨부파일 다운로드, docs 브랜치 반영 스크립트 |
| `dashboard/` | Pages에 올라갈 정적 파일 (빌드 도구 없이 순수 HTML/CSS/JS) |
| `tests/` | pytest 테스트 |
| `.github/` | 워크플로우와 이슈 템플릿 |

## 규칙
- 사용자에게 보이는 문구와 주석은 한국어
- 파이썬 3.12, 외부 라이브러리는 xlwings, openpyxl 만 사용 (테스트는 pytest)
- 사용자 데이터를 화면에 출력할 때 innerHTML 금지 (textContent 사용)
- 비밀번호·토큰을 코드에 하드코딩 금지 (대시보드에는 비밀번호의 SHA-256 해시만 둔다)
- 이슈 제목·본문 같은 신뢰할 수 없는 입력은 워크플로우에서 `env:`로만 전달 (`run:`에 `${{ }}` 직접 삽입 금지)
- 워크플로우 `permissions`는 필요한 것만
- 작업이 끝나면 무엇을 바꿨는지 짧게 요약하고, 커밋은 사람이 확인한 뒤 한다

## 자주 쓰는 명령
```bash
pip install -r scripts/requirements.txt pytest
python -m pytest -q
python scripts/excel_to_json.py sample.xlsx --out build/data.json --engine auto
```
