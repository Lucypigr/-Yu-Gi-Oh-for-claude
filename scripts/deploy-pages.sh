#!/usr/bin/env bash
# 打包遊戲並發佈到 GitHub Pages（gh-pages 分支）
# 用法：npm run deploy
set -euo pipefail
cd "$(dirname "$0")/.."

# 確保卡圖已下載（已存在的會略過）
npm run fetch-art
npm run build
touch dist/.nojekyll

remote="$(git remote get-url origin)"
rev="$(git rev-parse --short HEAD)"
tmp="$(mktemp -d)"
# 保留上一版的程式檔：瀏覽器快取了舊版網頁時，舊的 JS／CSS 仍然可以載入，不會黑屏
old="$(mktemp -d)"
mkdir -p "$tmp/assets"
if git fetch -q "$remote" gh-pages 2>/dev/null; then
  git archive FETCH_HEAD index.html assets 2>/dev/null | tar -x -C "$old" 2>/dev/null || true
  # 只保留上一版 index.html 用到的檔案，舊檔不會一直累積
  for f in $(grep -o 'assets/[^"]*' "$old/index.html" 2>/dev/null || true); do
    [ -f "$old/$f" ] && cp -n "$old/$f" "$tmp/assets/"
  done
fi
rm -rf "$old"
cp -r dist/. "$tmp/"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy game to GitHub Pages (from $rev)"
git push -f "$remote" gh-pages
rm -rf "$tmp"
echo "已發佈到 gh-pages 分支"
