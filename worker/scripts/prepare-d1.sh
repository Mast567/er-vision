#!/usr/bin/env bash
# D1 데이터베이스 er-vision의 ID를 찾아(없으면 만들어) wrangler.toml에 넣는다. worker/ 에서 실행한다.
set -euo pipefail
find_id() { npx wrangler d1 list --json | jq -r '.[] | select(.name=="er-vision") | (.uuid // .id // .database_id)' | head -1; }
ID=$(find_id)
if [ -z "$ID" ]; then
  npx wrangler d1 create er-vision < /dev/null
  ID=$(find_id)
fi
if [ -z "$ID" ]; then echo "::error::D1 데이터베이스 ID를 찾지 못했습니다. 토큰에 Account / D1 / Edit 권한이 있는지 확인하세요."; exit 1; fi
sed -i "s/__D1_ID__/$ID/" wrangler.toml
