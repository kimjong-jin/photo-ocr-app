#!/bin/zsh
# deploy.sh — git push만으로 자동 배포됩니다
# git push → GitHub → Vercel 자동 배포 (~20초)

MSG=${1:-"update"}
cd /Users/kimjongjin/coding/photo-ocr-app

git add -A
git commit -m "$MSG"
git push

echo "✅ 배포 완료 → https://www.parser.work (~20초)"
