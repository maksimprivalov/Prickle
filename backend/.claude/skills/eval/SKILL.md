---
name: eval
description: Run Prickle's eval (pnpm eval), check the mandate was never exceeded, and rebuild the README's eval and concurrency-timing tables from the run log — never from memory or by hand. Use after changing agents, checks or data, before submission, or when the user asks how many traps Prickle catches or how concurrent the agents are.
argument-hint: "[--no-readme]"
---

# Eval — numbers from the log only

The *Care with financial data* criterion and fixes 1 and 5 both depend on this: every number in
the README comes from a run log, never typed in.

1. **Run.** `pnpm eval` (needs the LLM key in `.env`; check with `test -f .env`, never read it).
   It writes run logs under `runs/` and prints the tables. A non-zero exit means the mandate was
   exceeded or the answer key was not met: that is the headline of your report, above everything
   else.
2. **Read the log, not the terminal.** Open the run's JSONL and recompute the figures yourself
   with a short script (scratchpad, not the repo): traps planted (from
   `data/fixtures/traps.json`), traps caught and by whom, honest deals wrongly rejected, max spend
   vs. mandate, and for timing: each scout's `scout.started`→`scout.finished` duration, their sum,
   and the wall-clock from the first start to the last finish. If your numbers and `pnpm eval`'s
   disagree, report it — that is a bug in the eval.
3. **README** (skip with `--no-readme`). Replace the two tables under *Eval* and *How the agents
   run concurrently* in `README.md` with the figures from step 2, and name the run log file they
   came from. Change nothing else in the README.
4. **Sample log.** If the user wants the committed sample refreshed, `runs/sample-run.jsonl` is
   replaced by copying a fresh `pnpm demo` log over it (the guard hook denies hand edits); ask
   before doing it.

Report: the tables, the log file name, and any disagreement or failure. Do not round or "tidy"
a number.
