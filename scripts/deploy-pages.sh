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
cp -r dist/. "$tmp/"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy game to GitHub Pages (from $rev)"
git push -f "$remote" gh-pages
rm -rf "$tmp"
echo "已發佈到 gh-pages 分支"
