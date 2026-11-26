---
name: pr
description: Draft a GitHub pull request title and description for the current branch from its commits and diff against main, with the gate result and the safety checklist (guard, money, devnet, grounding, judge mode). Use when the user is about to open a pull request or asks for a PR description.
argument-hint: "[base branch, default main]"
disable-model-invocation: true
---

# Draft a pull request

Produces text for the user. **Opening, editing or commenting on a pull request is outward-facing:
do it with `gh` only after the user's explicit go-ahead.** The repository is public.

1. **Scope.** Base is `$ARGUMENTS` or `main`. `git merge-base HEAD origin/<base>` (fall back to the
   local branch); read `git log --oneline <base>..HEAD`, `git diff --stat <base>...HEAD` and the
   diff. Uncommitted changes are not in the PR: if there are any, say so first.
2. **Gate.** If `/verify` has not run on this `HEAD` in this session, run it. A failure goes at the
   top of your reply, not into the description.
3. **Title:** the commit style of the repo, `<type>: <summary>` (`add:`, `fix:`, `change:`,
   `docs:`, `test:`), imperative, under 70 characters.
4. **Description:**

   ```markdown
   ## What and why
   <one paragraph: the effect on the demo, the judging criteria or the safety rules>

   ## Changes
   - <grouped by area: core, agents, tools, runtime, payments, data, app, frontend>

   ## Safety and contract
   - [ ] Touches the mandate guard / money / pay(): <how it is tested>
   - [ ] Event schema changed (frontend contract): <which events>
   - [ ] Fixtures regenerated (pnpm gen:data): <what changed>
   - [ ] New env var or setup step: <is judge mode still one key?>
   - [ ] None of the above

   ## How to verify
   <commands, e.g. pnpm demo, pnpm eval, the expected line>
   ```

   Tick boxes from the diff, not from memory.
