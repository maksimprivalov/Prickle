#!/usr/bin/env bash
# PreToolUse guard for Bash / PowerShell. Two rules from CLAUDE.md that must never slip:
#
#   - devnet only: any command that names a Solana mainnet cluster or RPC is denied;
#   - keys stay out of the transcript: printing a keypair or .env file is denied.
#
# Pattern matching on the raw tool input is deliberately blunt: a false positive costs one
# rephrased command, a false negative could move real money or leak a key.
set -u

input=$(cat)
lower=$(printf '%s' "$input" | tr '[:upper:]' '[:lower:]')

decide() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"
  exit 0
}

case "$lower" in
  *mainnet-beta* | *api.mainnet* | *"--url m "* | *"-um "* | *"--url mainnet"*)
    decide deny "Prickle runs on Solana devnet only (hackathon rule: no real money). Use devnet."
    ;;
esac

secret_reason="That prints a secret into the transcript. Check presence with test -f, never print the contents."

# Any read of the devnet keypair folder (the public key is fine: solana-keygen pubkey).
case "$lower" in
  *"solana-keygen pubkey"*) ;;
  *.wallet/* | *.wallet\\\\*)
    case "$lower" in
      *"cat "* | *"type "* | *"get-content "* | *"gc "* | *"head "* | *"tail "* | *"less "* | *"more "*)
        decide deny "$secret_reason" ;;
    esac
    ;;
esac

# Printing .env (but not .env.example).
case "$lower" in
  *".env.example"*) ;;
  *"cat .env"* | *"type .env"* | *"get-content .env"* | *"gc .env"* | *"head .env"* | *"tail .env"*)
    decide deny "$secret_reason"
    ;;
esac

exit 0
