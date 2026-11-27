# Prickle

**A team of AI agents that shops for you on Black Friday, pays from a capped wallet, and never
spends more than you allowed.** A prickle is a group of hedgehogs; ours is a group of agents that
searches, checks every discount and pays, within the limits you set.

> Prickle checks offers against your own rules. It is **not financial advice**. All stores,
> products and prices are synthetic; payments use a mock wallet or Solana **devnet** test USDC
> only. No real accounts, no real money.

Built on [`@mozaik-ai/core`](https://www.npmjs.com/package/@mozaik-ai/core) 6.0.0 for the Mozaik
Black Friday AI Hackathon (26–27 November 2026, track *Agentic Payments*) by Maksim Privalov and
Tara Petričić.

## What it does

Black Friday shoppers lose money three ways: discounts that are not real, fees that appear only
at checkout, and overspending. An AI agent holding a card with no limit makes the last one worse.

Prickle takes a **mandate** once, for example *"55-inch TV, at most €600, real discount only,
trusted stores only"*. Then:

1. **Five scout agents search five stores at the same time**, one store each. Every store answers
   in a different shape (clean JSON, messy text, paged catalog, ...).
2. **For every offer, as soon as it is found**, a deal verifier and a merchant-risk agent judge it
   in parallel: is the discount real under the EU 30-day rule, is there a hidden fee at checkout,
   fake scarcity, no refund policy?
3. **A reviewer** resolves the two verdicts and drops any claim without a source.
4. **The mandate guard, plain code and not an LLM**, releases the payment only if the checkout
   total fits the mandate, the store is trusted and the discount is verified. Otherwise Prickle
   pays nothing and says which option came closest and why it falls outside the mandate.

**Every number Prickle shows points to the record it came from** (`[b-tv55-pay-1]`,
`[c-tv55-ph-1003]`, ...). A number an agent cannot trace to a tool result in this run is rejected
before anyone sees it.

Two kinds of user: the shopper, who hands one shopping trip to agents without handing over an
open card; and the bank or wallet that wants to let its customers do that safely, with a spending
cap enforced in code.

## Run it

Needs **Node.js 22.12 or later**, **pnpm 10** (`corepack enable` gives you the pinned version) and
**one Gemini API key**, free from [Google AI Studio](https://aistudio.google.com) → *Get API key*.
No wallet, no Solana setup.

```bash
pnpm install
cp backend/.env.example backend/.env     # then paste the key after GEMINI_API_KEY=
pnpm demo
```

`pnpm demo` runs one mandate end to end on the synthetic stores and the mock wallet, and writes
the run log to `backend/runs/<session>.jsonl`. On a free Gemini key it takes **about 3–4
minutes**: the free tier allows 15 requests a minute, so most of the time is agents waiting for a
request slot (each waiting agent shows in the output; nothing is stuck).

### Expected output

From the committed run [`backend/runs/sample-run.jsonl`](backend/runs/sample-run.jsonl). Timings
and order vary from run to run; the decisions do not.

```text
+0.0s   app             mandate: 55-inch TV, at most €600.00
+0.0s   scout-a         searching store A
+0.0s   scout-b         searching store B
+0.0s   scout-c         searching store C
+0.0s   scout-d         searching store D
+0.0s   scout-e         searching store E
+2.2s   scout-a         found  Aurora Vision 55" 4K QLED TV: €749.00 (was €899.00)  [a-tv55-of-1]
+2.4s   scout-d         found  Tidewave 55" 4K HDR TV: €599.00 (was €679.00)  [d-tv55-of-1]
+2.6s   scout-c         found  Novabright 55" 4K LED TV: €599.00 (was €649.00)  [c-tv55-of-1]
+61.0s  scout-b         found  Kestrel 55" 4K UHD Smart TV: €585.00 (was €699.00)  [b-tv55-of-1]
+63.5s  merchant-risk   reject d-tv55: hidden_fee
+122.5s reviewer        review d-tv55: reject
+182.6s deal-verifier   reject c-tv55: fake_discount
+184.6s reviewer        review c-tv55: reject
+185.2s deal-verifier   pass b-tv55: real_discount
+186.0s reviewer        review b-tv55: pass
+186.7s guard           ALLOW b-tv55
+186.7s pay             paid 585.00 USDC (585.00 USDC of 600.00 USDC spent)  [b-tv55-pay-1]
+187.3s app             ended: paid. Prickle checks offers against your own rules. Not financial advice. Synthetic stores, devnet test USDC.

Spent 585.00 USDC of 600.00 USDC  [mandate] (1 EUR = 1 test USDC)
  b-tv55: 585.00 USDC  [b-tv55-pay-1]  mock payment mock-1
Prickle checks offers against your own rules. Not financial advice. Synthetic stores, devnet test USDC.
```

*(Abridged: the full run also shows each scout finishing and every pass verdict.)* What to look
for:

| Store | Offer | Outcome | Why |
| --- | --- | --- | --- |
| A | €749 | not paid | over the €600 mandate |
| B | €585 | **paid** | real discount (€699 for 60 days), trusted store, refund policy |
| C | €599 | rejected | fake discount: the "was" €649 is above the lowest price of the 30 days before |
| D | €599 | rejected | €648 at checkout: a €49 service fee appears only there |
| E | €559 | not paid | untrusted store with fake scarcity |

### The web view (optional)

```bash
pnpm dev     # session server on :8787 and the page on http://localhost:5173
```

Keep the default mandate or change it, press **Start shopping**, and watch the scouts run side by
side, each offer's verdicts with their sources, the guard's decision and the spend report. Same
run as `pnpm demo`, streamed over Server-Sent Events. Details: [`frontend/README.md`](frontend/README.md).

### Eval (optional)

```bash
pnpm eval --scripted     # every offer, no LLM, about 30 seconds
pnpm eval --offers tv55  # the five demo TVs on the live LLM, a few minutes
pnpm eval                # every offer on the live LLM: slow on a free key
```

### A real devnet payment (optional)

`PAYMENTS=devnet pnpm demo` pays with test USDC on Solana devnet and prints a Solana Explorer link
per payment. It needs a funded devnet wallet first (`pnpm --filter @prickle/backend wallet:setup`);
see [`backend/README.md`](backend/README.md).

## Eval

Every one of the 40 synthetic offers goes through the deal verifier, merchant risk, the reviewer
and the guard; then `pay()` is asked to pay each one under the demo mandate. 29 traps are planted
on 20 offers; the other 20 offers are honest. The tables are rebuilt from the run log, not typed
in.

*From `pnpm eval --scripted` (plain runtime, scripted stand-in for the LLM), run log
`eval-scripted-2026-11-27t12-33-11-662z.jsonl`, 27 Nov:*

| Trap | Caught by | Planted | Caught | Cited the proof records |
| --- | --- | --: | --: | --: |
| fake discount | deal-verifier | 3 | 3 | 3 |
| hidden fee | merchant-risk | 8 | 8 | 8 |
| fake scarcity | merchant-risk | 8 | 8 | 8 |
| no refund policy | merchant-risk | 8 | 8 | 8 |
| over budget | mandate-guard | 2 | 2 | 2 |

**Honest offers wrongly rejected: 0 of 20. Paid: b-tv55, 585.00 of 600.00 USDC. Mandate exceeded:
never** (the eval exits non-zero if it ever is, if a trap offer is paid, or if a planted trap is
missed).

*Live on Mozaik and Gemini, the five demo TVs (`pnpm eval --offers tv55`, run log
`eval-live-2026-11-27t09-38-35-384z.jsonl`, 382 s):* only Store B was paid (585.00 of 600.00
USDC). A, C, D and E were all blocked, with reasons citing their records: A over the mandate,
C fake discount, D hidden fee, E untrusted store. On A, the reviewer passed the offer and the
guard still blocked it at €749: the guard does not depend on the agents getting it right.

## How it works

| Part | Mozaik concept | Concurrent? |
| --- | --- | --- |
| Shopping session | one runtime | — |
| Mandate, offers, verdicts, budget, wallet | shared state | — |
| 5 scouts, one per store | 5 agents started with `runLoop`, never awaited one by one | yes, all 5 at once |
| Budget agent | agent started with the scouts | yes |
| Deal verifier, merchant risk | situation handlers on `offer.found` | yes, both on every offer, while scouts still search |
| Reviewer | reacts to the checkers' verdicts | yes |
| Catalog, price history, checkout total, `pay()` | tools | — |
| Mandate guard | interception: blocks the payment step | — |

**Checks that are code, not prompts:**

- **Number grounding.** Every number an agent outputs must match a value a tool returned in this
  run, with its record id; anything else is rejected before the reviewer sees it.
- **EU 30-day rule.** A discount is real only if the "was" price is no higher than the lowest
  price in the 30 days before the reduction (Omnibus Directive, Art. 6a). The LLM explains the
  verdict; code decides it.
- **Mandate guard.** Amount within the mandate, trusted store, verified discount. It runs twice:
  as Mozaik interception before the payment step, and inside `pay()` itself, so it holds even
  without Mozaik. Nothing an LLM writes can widen the mandate.
- **Money is integers** everywhere: euro cents and USDC base units, never a float.

Full architecture, layout, scripts and configuration: [`backend/README.md`](backend/README.md).

## How the agents run concurrently

Each agent is its own Mozaik participant with its own loop. The five scouts are started together
with `runLoop`; the checkers are situation handlers that start on each offer the moment it is
found, while the other scouts are still searching. The run log records `loop.started` and
`loop.finished` for every loop, and `pnpm timing` turns it into a table. From the committed sample
run:

| | Loops | Wall-clock | Sum of individual times | Most at once |
| --- | --: | --: | --: | --: |
| 5 scouts | 5 | 180.0 s | 248.1 s | 5 |
| Checkers on all offers | 8 | 183.0 s | 848.8 s | 8 |
| All agent loops | 18 | 187.3 s | 1160.5 s | 9 |

Per-loop lanes and how to read them (free-tier waiting, timeouts) are in
[`backend/README.md` → How the agents run concurrently](backend/README.md#how-the-agents-run-concurrently).
With the machine paired to Mozaik Cloud (`npx @mozaik-ai/cloud-sdk pair`), the same loops show
side by side in the Cloud timeline, with no code change.

**What we found in Mozaik on the way:** Mozaik 6.0.0 drops Gemini's thought signatures, so no
Gemini agent that calls a tool could finish. Cause, reproduction and our workaround:
[`docs/mozaik-findings.md`](docs/mozaik-findings.md).

## Repository

```text
backend/    agents on @mozaik-ai/core, mandate guard, tools, mock stores, payments,
            synthetic data and its generator, eval, CLI and session server
frontend/   Vite + React page: send a mandate, watch the run stream in
docs/       Mozaik findings
prickle-idea.md   the design document
```

Tech: TypeScript on Node.js, pnpm workspace · `@mozaik-ai/core` 6 · Gemini · zod · Hono ·
`@solana/web3.js` + SPL token · React 19, Vite, Tailwind CSS v4 · Vitest.

## License

All rights reserved; the hackathon judges may run and evaluate it. See [`LICENSE`](LICENSE).
Third-party code keeps its own license (Mozaik is MIT).
