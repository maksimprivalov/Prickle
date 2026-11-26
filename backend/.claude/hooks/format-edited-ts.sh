#!/usr/bin/env bash
# PostToolUse hook for Edit / Write / MultiEdit: runs Prettier on the .ts / .json / .md file that
# was just changed. Never blocks: before scaffolding (no node_modules) it does nothing, and a
# Prettier failure is left for /verify and the lint step to report.
set -u

to_slashes() { printf '%s' "$1" | sed 's#\\\{1,\}#/#g'; }
to_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

input=$(cat)
path=$(printf '%s' "$input" \
  | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -n1 \
  | sed 's/^"[a-z_]*"[[:space:]]*:[[:space:]]*"\(.*\)"$/\1/')
path=$(to_slashes "$path")
case "$path" in
  *.ts | *.tsx | *.json) ;;
  *) exit 0 ;;
esac

dir=$(to_slashes "${CLAUDE_PROJECT_DIR:-$PWD}")
dir=${dir%/}
[[ $(to_lower "$path") == "$(to_lower "$dir")"/* ]] || exit 0
rel=${path:${#dir}+1}

# Generated files are left exactly as their generator wrote them.
case "$rel" in
  data/fixtures/* | runs/* | pnpm-lock.yaml) exit 0 ;;
esac

prettier="$dir/node_modules/.bin/prettier"
[ -x "$prettier" ] || prettier="${dir%/*}/node_modules/.bin/prettier"
[ -x "$prettier" ] || exit 0

cd "$dir" && "$prettier" --write --log-level silent "$rel" >/dev/null 2>&1
exit 0
