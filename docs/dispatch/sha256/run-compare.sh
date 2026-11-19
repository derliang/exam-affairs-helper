#!/usr/bin/env bash
# 用法（Git Bash）：bash run-compare.sh <repo 路徑> [舊 ref，預設 475eff0] [新 ref，預設 bb79efb]
# 作法：兩個 ref 各開一個暫時 worktree（node_modules 用 junction 借 repo 的），把 zzsnap.test.ts 放進 src/ 跑，
# 各產一份雜湊 JSON，最後列出不同的鍵。預期：只有 gsat-absent2/* 10 項不同（該組有未參加者），其餘 70 項相同（共 80 項）。
set -euo pipefail
REPO="${1:?請給 repo 路徑（要有 node_modules）}"
OLD="${2:-475eff0}"; NEW="${3:-bb79efb}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${SNAP_WORK:-$HERE/out}"; mkdir -p "$OUT"
cd "$REPO"; git fetch -q origin
run() { # $1 ref  $2 輸出檔
  local W="$OUT/wt-$1"
  [ -d "$W" ] && { cmd //c rmdir "$(cygpath -w "$W/node_modules")" 2>/dev/null || true; git worktree remove --force "$W"; }
  git worktree add -q --detach "$W" "$1"
  cmd //c mklink //J "$(cygpath -w "$W/node_modules")" "$(cygpath -w "$REPO/node_modules")" > /dev/null
  cp "$HERE/zzsnap.test.ts.txt" "$W/src/zzsnap.test.ts"
  (cd "$W" && SNAP_OUT="$2" npx vitest run src/zzsnap.test.ts > "$2.log" 2>&1) || { echo "vitest 失敗，見 $2.log"; exit 1; }
  cmd //c rmdir "$(cygpath -w "$W/node_modules")"   # 先拆 junction，避免刪到 repo 的 node_modules
  git worktree remove --force "$W"
}
run "$OLD" "$OUT/old.json"
run "$NEW" "$OUT/new.json"
node -e '
const [a,b]=process.argv.slice(1).map(f=>JSON.parse(require("fs").readFileSync(f,"utf8")));
const keys=[...new Set([...Object.keys(a),...Object.keys(b)])];
const diff=keys.filter(k=>a[k]!==b[k]);
console.log(`共 ${keys.length} 項，相同 ${keys.length-diff.length}，不同 ${diff.length}`);
for(const k of diff) console.log("  不同：",k);
' "$OUT/old.json" "$OUT/new.json"
