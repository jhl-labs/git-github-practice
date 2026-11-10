#!/usr/bin/env bash
# dashboard/ 의 정적 파일과 build/data.json 을 docs 브랜치에 커밋·push 한다.
# docs 브랜치 = 배포할 결과물 + 데이터 변경 이력. 실제 Pages 배포는 pages-deploy.yml 이 한다.
# (GITHUB_TOKEN으로 push한 커밋은 Pages 빌드를 자동으로 트리거하지 않기 때문)
#
#   사용법: bash scripts/publish_docs.sh "커밋 메시지"
#   - build/data.json 이 있으면 data/data.json 으로 함께 반영
#   - 없으면 기존 docs 브랜치의 데이터는 그대로 두고 화면 파일만 갱신
set -euo pipefail

MESSAGE="${1:-docs: 대시보드 갱신}"
BRANCH="docs"
WORKTREE="$(mktemp -d)"
trap 'git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true' EXIT

if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git fetch --depth=1 origin "$BRANCH"
  git worktree add --detach "$WORKTREE" "origin/$BRANCH"
else
  echo "docs 브랜치가 없어 새로 만듭니다 (orphan)."
  git worktree add --detach "$WORKTREE"
  git -C "$WORKTREE" checkout --orphan "$BRANCH"
  git -C "$WORKTREE" rm -rf --quiet . || true
fi

cp -R dashboard/. "$WORKTREE/"
if [ -f build/data.json ]; then
  mkdir -p "$WORKTREE/data"
  cp build/data.json "$WORKTREE/data/data.json"
fi
touch "$WORKTREE/.nojekyll"

cd "$WORKTREE"
git add -A
if git diff --cached --quiet; then
  echo "변경 사항이 없어 커밋하지 않습니다."
  exit 0
fi
git commit -m "$MESSAGE"
git push origin "HEAD:refs/heads/$BRANCH"
echo "✅ $BRANCH 브랜치에 반영했습니다."
