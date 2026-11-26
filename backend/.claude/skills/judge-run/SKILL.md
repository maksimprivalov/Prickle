---
name: judge-run
description: Rehearse what a hackathon judge does — fresh clone into a temp directory, follow the README exactly (pnpm install && pnpm demo, one LLM key, mock wallet), and report every step that fails or differs from the README's expected output. Use before submission, after changing setup, scripts, dependencies or env vars, or when the user asks whether the project runs from the README.
argument-hint: "[branch, default the current one]"
disable-model-invocation: true
---

# Judge run — fix 3, rehearsed

"It works" is 25 points, and one broken setup step means zero. A judge has Node, pnpm, the
README and one LLM key; nothing from this machine's state.

1. **Clone fresh** into the scratchpad: the pushed branch (`$ARGUMENTS` or the current one) from
   the remote, not a copy of this working tree. Uncommitted or unpushed changes are not what the
   judge gets: if there are any, say so at the top.
2. **Follow the root and backend READMEs literally**, step by step, as written. Don't fix a step
   silently: if a command is wrong, missing or needs knowledge the README does not give, that is
   the finding.
3. **The LLM key.** Copy `.env` from this working tree into the clone with `cp` (never read or
   print it). That is the one thing a judge brings.
4. **Run** `pnpm install` and `pnpm demo` from the clone, logging to files. Time both.
5. **Compare** the output with the README's *expected output* block: same structure, same
   decisions (Store B passes, C fake discount, D hidden fee), spend ≤ mandate, the
   not-financial-advice line, a run log written.
6. **Optional:** `pnpm eval` and, if the user asks, the devnet path (`PAYMENTS=devnet`), which
   needs the wallet and is opt-in for judges.
7. **Clean up** the clone.

Report: one line per README step (ok / failed with the first error / unclear instruction),
timings, differences from the expected output, and the smallest README or code change that
fixes each. Do not edit the repo unless asked.
