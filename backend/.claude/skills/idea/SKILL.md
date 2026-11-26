---
name: idea
description: Print one section of the design document ../prickle-idea.md instead of the whole file. Use whenever a task needs the design — Summary, How it works, Mozaik design, Technology stack, Portability, Payments, Synthetic data and eval, Scoring (incl. the six fixes), Plan, Rules checklist, License.
argument-hint: "<section heading or part of it, e.g. Mozaik design>"
allowed-tools: Bash(awk *) Bash(grep *)
---

# Read one section of the idea

`../prickle-idea.md` (repository root) is the design document. Locate sections by heading, not
by remembered line numbers.

Print the `##` section whose heading contains the argument (case-sensitive substring):

```bash
awk -v h="$ARGUMENTS" '/^## /{p=index($0,h)>0} p' ../prickle-idea.md
```

List the sections: `grep -n '^##' ../prickle-idea.md`. A `###` subsection (e.g. one scoring
criterion or *The six fixes*): `awk -v h="<heading>" '/^##/{p=index($0,h)>0} p' ../prickle-idea.md`.

| Section | Read it for |
| --- | --- |
| How it works | the flow and the example run (Stores B, C, D) |
| **Mozaik design** | **which agent is a loop, a handler, the reviewer; the guard as interception** |
| Technology stack | the chosen libraries and why |
| **Portability** | **folder layout, the port, where Mozaik may be imported** |
| Payments | wallet, `pay()`, devnet, fallback at Thu 17:00 |
| Synthetic data and eval | dataset size, the five traps, what the eval reports |
| **Scoring** | **criteria, risks, the six fixes (1–3 are must-haves)** |
| Plan | timeline, who owns what, cut order |
| Rules checklist | what must be true before submitting |

The idea file is shared by both owners: edit it only when the user asks, and keep it in English.
