#!/usr/bin/env bash
# PreToolUse guard for Edit / Write / MultiEdit / NotebookEdit. Enforces the file rules in
# CLAUDE.md mechanically:
#
#   ../LICENSE                  -> denied (agreed by both owners)
#   .env, .env.* (not example)  -> denied (nothing secret belongs in the frontend anyway)
#   pnpm-lock.yaml (any level)  -> denied (run pnpm install after an agreed dependency change)
#   ../backend/**               -> asks (backend work has its own rules and hooks: start a
#                                  session in backend/ unless this is a deliberate contract fix)
#
# Hooks run under Git Bash on Windows, which ships without jq, so the path is pulled out with grep.
set -u

to_slashes() { printf '%s' "$1" | sed 's#\\\{1,\}#/#g'; }
to_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
normalize() {
  printf '%s' "$1" | sed -e ':a' -e 's#/\./#/#g' -e 's#/[^/][^/]*/\.\./#/#' -e 't a'
}

input=$(cat)
path=$(printf '%s' "$input" \
  | grep -oE '"(file_path|notebook_path)"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -n1 \
  | sed 's/^"[a-z_]*"[[:space:]]*:[[:space:]]*"\(.*\)"$/\1/')
[ -n "$path" ] || exit 0

path=$(normalize "$(to_slashes "$path")")
dir=$(to_slashes "${CLAUDE_PROJECT_DIR:-$PWD}")
dir=${dir%/}
root=${dir%/*}

decide() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"
  exit 0
}

lower_path=$(to_lower "$path")
lower_dir=$(to_lower "$dir")
lower_root=$(to_lower "$root")

case "$lower_path" in
  "$lower_root"/license)
    decide deny "LICENSE is the all-rights-reserved license both owners agreed on. Do not change it."
    ;;
  */pnpm-lock.yaml)
    decide deny "The lockfile is generated. Change package.json (after asking), then run pnpm install."
    ;;
  "$lower_root"/backend/*)
    decide ask "This edits the backend from a frontend session, without the backend's rules and guard hooks. Fine for a deliberate contract fix; otherwise start Claude Code in backend/."
    ;;
esac

[[ $lower_path == "$lower_dir"/* ]] || exit 0
rel=${path:${#dir}+1}

case "$rel" in
  .env.example) ;;
  .env | .env.*)
    decide deny "$rel is an env file. Document names in .env.example; and remember nothing in the frontend bundle is secret."
    ;;
esac

exit 0
