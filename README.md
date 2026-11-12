# Reprice Desk

Raise subscription prices on PayPal for exactly the members you choose.

**Pitch:** Reprice Desk lets a small business on PayPal Subscriptions raise prices for exactly the members it chooses: a Claude agent in an AG Studio desk turns "keep founders at $9, raise regular monthly to $12" into a plan, code compares two ways to do it in PayPal, and after the owner approves, every member's price is read back from PayPal.

## The problem

On PayPal, changing a plan's price changes it for every existing subscriber, and every subscriber is emailed ([PayPal docs, "Change the price of a plan"](https://developer.paypal.com/subscriptions/change-price.md)). A subscription can instead carry its own price override, and an override ignores later plan price changes ([Subscriptions API v1](https://developer.paypal.com/api/subscriptions/v1/)). So there are two ways to keep your founders at the old price:

- **Strategy A, raise the plan:** first write each kept member's current price onto their own subscription, verify it, then change the plan price.
- **Strategy B, new plan:** leave the old plan alone, create a new plan for new signups, and raise only the members you pick, one subscription at a time.

Which one is better depends on who your members are and when they are billed. Reprice Desk computes both, shows them side by side, runs the one you approve in a fixed order, and reads the prices back from PayPal.

Real operators do this by hand or with their own scripts: one Stack Overflow question describes a site with about 10,000 PayPal subscribers for which "updating 10000 subscriptions via Dashboard is not a great idea" ([source](https://stackoverflow.com/questions/75801698), 2023-03-21), and OctoEverywhere raised the price of its PayPal-paid plans by $1-3 and told those members two months ahead ([blog](https://blog.octoeverywhere.com/?p=7278), 2025-02-26). Reprice Desk helps you keep a notice window you choose (for example California's 7 to 30 days). It is not legal advice and does not promise compliance.

Scope: plans and prices only. There are no cancel, pause, suspend or refund features in this app.

## Architecture

```
AG Studio harness (browser)  --turn-->  Express proxy /api/studio/llm  -->  Claude (API key, local account, or stand-in)
   |  tools: scan_subscribers, compare_strategies, ...                     (Studio tool loop runs in the browser)
   v
Express server (money rules, plan freezing, locks)  -->  APIMatic `paypal` SDK  -->  PayPal sandbox
                                                    <--  webhooks (/api/webhooks/paypal)
```

## What you see

An AG Studio dashboard (AG Grid's embedded analytics component) is the main screen:

- **Reprice Agent**, a custom Claude agent in Studio's Agent Framework (a server-side adapter, because Studio ships none for Claude). It reads the subscribers, finds where three readings of "founders" disagree, asks which one you mean, and explains the strategy comparison using only numbers the server computed. It is wired to hand dashboard requests to Studio's built-in data and widget agents (this needs a real Claude model; the stand-in says it cannot, and the account-mode run is recorded in VERIFY.md V11 and V12).
- **Five custom widgets** (Price ladder and Notice window strip read the `price_timeline` and `subscribers` sources through `widgetApi.getData` with a data mapping, so the Filters panel and cross filters change what they draw): Strategy compare (eight code-computed metrics), Approval card (the only place prices are typed and money-moving steps are approved), Price ladder, Notice window strip, Next steps.
- A navy, mint and amber theme (mint = kept at the old price, amber = raised) with a working light variant (a second CSS variable set plus a Studio light theme), the Members and Run log grids with badge cell renderers, tool calls in the chat that open into the eight-metric table, and two saved layouts (**Compare**, **Execution**) you can rearrange in edit mode and save.
- Six data sources behind the built-in grid: subscribers, plans, strategy outcomes, a 13-month price timeline, projected revenue, events.

## Run it

Needs Node 20 or newer.

```bash
npm install
npm run build
npm start          # http://localhost:3002
```

No keys are needed. Without keys, PayPal and Claude run on built-in stand-ins that follow the same call shapes and rules (a plan price change reaches only subscriptions without an override; an override cannot be removed). The header shows which mode you are in.

Optional, local development only: `LLM_BACKEND=account npm start` runs the Reprice Agent and Studio's built-in agents on your own Claude Code login (Claude Agent SDK, model `claude-sonnet-5-5`). The API key is removed from the environment of that process. The screen then says "Claude Sonnet (local account)". It is not meant for a hosted server.

Development: `npm run dev:server` and `npm run dev:client` (Vite on port 5175, proxying `/api`).

## Testing instructions (judge walk-through)

1. Open the app and click **Open my bundle**. You get a pre-seeded bundle: 1 product, 2 plans (Pro Monthly $9, Pro Annual $90), 12 subscribers. The start screen shows how many fresh bundles are left. A bundle is used once, because a PayPal subscription override cannot be removed through the API.
2. In the AI Assistant panel click **Keep founders**. The agent scans the subscribers and says the three readings of "founders" disagree on 4 subscribers (F4, R4, A3, A4). Type `tag`.
3. In the dashboard click **Use this rule** (this is your confirmation; nothing is computed before it).
4. Read the **Strategy compare** widget. Ask the agent "Founders must not get any email from PayPal. Which strategy do you recommend?" Its answer quotes the table.
5. Click **Choose B**. The **Approval card** shows the plan: new monthly and annual prices (the two input boxes are the only price source), what runs now, what is scheduled, the ten-day rule, the MRR change (computed).
6. Click **Approve & run**. The Execution view opens: read-back table of every member's price from PayPal, the new plan IDs to put on your checkout button, scheduled raises (not yet run), the run log and webhook rows.
7. Try **Choose A** on another bundle to see the other order: keep-overrides first, verify, then the plan price. In the Execution view the Members table shows F1-F4 as Kept and R1-R4 as Raised, and the first line of **What to do next** reads the kept members back from PayPal.

If no fresh bundle is left, steps 1 to 5 still work on a read-only copy (clearly labelled) and the Approve button is replaced by a note.

Example numbers for a bundle on its seed day (the screen always shows numbers computed from your bundle's real billing dates, so they can differ in a later week because billing dates have moved on):

| | Strategy A | Strategy B |
|---|---|---|
| PayPal writes (incl. scheduled) | 12 | 8 |
| Overrides left behind | 8 | 6 |
| Plan emails (PayPal sends) | up to 12, not verified yet | 0 |
| Ten-day shifted / outside notice window | 1 / 1 (R1) | 1 / 0 (R1) |
| Checkout button change | no | yes |
| MRR change | +$17.00 | +$17.00 |

For strategy B the webhooks expected for the immediate step are `BILLING.PLAN.PRICING-CHANGE.ACTIVATED` x0 and `BILLING.SUBSCRIPTION.UPDATED` x3 (the three immediate raises, R2, R3, R4); the three scheduled raises add three more `UPDATED` later. For strategy A they are `PRICING-CHANGE.ACTIVATED` x2 and `UPDATED` x8.

## How the money rules work

- **Prices come from you.** The model never sets a price. A drafted price in a tool call is ignored and flagged; notice drafts containing amounts the code did not compute are rejected.
- **Fixed order.** Strategy A never changes a plan price until every keep-override has been read back from PayPal; one failure aborts with "Plan price was NOT changed". Strategy B creates the new plans, then raises members one by one, then reads everything back.
- **Ten-day rule.** PayPal ignores a price change when the next charge is within 10 days (plan change: PayPal docs; subscription PATCH: Subscriptions API v1, PayPal-funded subscriptions). The planner shifts or schedules around it.
- **Increase cap.** Older PayPal documentation (no current link found) says an increase may be capped at 20 percent per 180 days. The sandbox accepted one 33 percent raise (VERIFY.md V1 b), so no cap is assumed; the planner can clamp if a cap shows up. If your sandbox shows such a cap (`INCREASE_CAP_PCT`), a two-step raise inside the period is not available, so a 33 percent raise is either clamped to the cap now or blocked, and the card says so.
- **One run per plan, one money action at a time per bundle.** Approving re-reads the subscribers; if they changed since the card was frozen, nothing is written ("Review again").
- **Derived next charge.** PayPal has no "next charge amount" field. The desk derives it (override, else plan price, plus the ten-day rule applied to a recent plan price change) and labels it derived. Actual charges are only visible after the charge happens.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3002 | Server port |
| `FORCE_MOCK` | 0 | `1` ignores all keys and runs the stand-ins |
| `ANTHROPIC_API_KEY` | empty | Claude for the agent (server side only). Empty = scripted stand-in |
| `LLM_BACKEND` | empty | `account` runs the model through the local Claude Code login instead of a key (development only; ignored when `FORCE_MOCK=1`; the API key is never used in this mode) |
| `ANTHROPIC_MODEL` | claude-sonnet-5-5 | Model id |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | empty | PayPal sandbox app. Empty = in-memory stand-in |
| `PAYPAL_WEBHOOK_ID` | empty | Needed to verify webhook signatures in sandbox mode |
| `VITE_AG_STUDIO_LICENSE_KEY` | empty | AG Studio trial key (set before `npm run build`). Without it Studio shows a trial notice |
| `BUNDLES_FILE` | empty | JSON file that remembers bundles, so a restart never re-leases a used one |
| `BUNDLE_MAX_AGE_DAYS` | 2 | Older bundles are never leased, so the screen matches the README example |
| `MOCK_BUNDLE_COUNT` | 16 | Stand-in bundle pool size |
| `BUNDLE_STORE_MAX` / `MAX_SESSIONS` | 200 / 500 | Memory caps for bundles and sessions |
| `LLM_CALLS_PER_SESSION` / `LLM_CALLS_PER_DAY` | 150 / 2000 | Limits on the Studio model proxy (needs a live session) |
| `V9_KEPT_RECEIVE_PLAN_EMAIL` | empty | `true`/`false` after the sandbox check (see VERIFY.md); empty shows "pending" |
| `V4_PATCH_SENDS_EMAIL` | empty | Same, for subscription PATCH emails |
| `INCREASE_CAP_PCT`, `INCREASE_CAP_DAYS` | empty, 180 | Increase cap found by V1 (c) |
| `SCHEDULER_INTERVAL_MS` | 3600000 | How often scheduled raises are checked |

## Tests

```bash
npm test
```

Runs `node --test` (mock only, the account backend is never called): the PayPal SDK adapter against a fake `fetch` (request shape of each call, duplicate write claims, lost responses, error mapping, calls kept on REST), money and date math against the seed table, both strategies, the ten-day rules, the increase cap fallback, execution order, abort on failed override, double-run and concurrent-run guards, changed-subscriber rejection, scheduler window and idempotency, bundle lease and aging, session separation, HTTP validation, agent tool validation, the Claude conversion and the stand-in model protocol.

## AI and tools used

- **Claude** (Anthropic): the Reprice Agent, through a small server-side proxy that converts AG Studio's adapter format to the Anthropic Messages API.
- **AG Studio** (`ag-studio`, `ag-studio-react` 3.1.0): dashboard, custom widgets, theme, layout tools, Agent Framework with the built-in data and widget agents.
- **PayPal TypeScript SDK `paypal`** (generated by APIMatic, installed from the plugin's repository; see the next section): every subscription and plan call goes through `client.subscriptions`. `listSubscriptions` is in this SDK and not in the public OpenAPI file.
- The code was written with an AI coding assistant.

## Built with the APIMatic Context Plugin

The live PayPal adapter (`server/paypal/livePaypal.js`) was written with the APIMatic Context Plugin for PayPal (version 0.4.1, TypeScript skills). Skills used: `typescript-integrate-paypal` (plan first, contract sheet), `typescript-getting-started` (SDK map lookups), `typescript-error-handling`, `typescript-client-initialization`, `typescript-calling-endpoints`, `typescript-authentication`, `typescript-models`, `typescript-configuration-resilience` and `typescript-testing`.

- **SDK package:** `paypal` (client `PaypalClient`), installed with `npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main`. It is not on npm and is built on install. It replaces `@paypal/paypal-server-sdk`.
- **Through the SDK:** create plan, get plan, update plan pricing schemes, create subscription, get subscription, list subscriptions, patch subscription, list subscription transactions (all `client.subscriptions`).
- **Kept on REST (not in the SDK):** Catalog Products (`createProduct`, used by the seed scripts) and webhook signature verification (`verifyWebhook`).
- **What the SDK work added:** a claim before every PayPal write so the same write cannot reach PayPal twice, a re-read when a write's answer is lost (the result is "unknown", never "failed"), one mapping from PayPal errors to this app's errors (PayPal's reason is shown for a 4xx, credential and quota problems are not blamed on the user), and a check that a write only names members and plans of the bundle being run.
- **Contract sheet:** [`paypal-plan.md`](paypal-plan.md) (signatures, request fields and channels, durable writes, unknown outcomes, error table, configuration decisions).

The tests drive the real SDK through a fake `fetch`. In the PayPal sandbox (2026-11-12) the SDK created plans and subscriptions, patched a keep-override, changed a plan price and read both back (`plan_overridden=true` at $9.00, plain subscription at $12.00). The sandbox refused `page_size=100` for `listSubscriptions`, so the adapter now asks for 20. Details: VERIFY.md V1, V2, V5, V17. A full walk-through of the app against the sandbox is a separate step and is not claimed here.

## Layout

```
server/domain   pure functions: dates, money, cohorts, strategies A/B, derived charges, seed table
server/paypal   live adapter on the APIMatic `paypal` SDK (+ REST for the two calls the SDK lacks) and the stand-in with the same interface
server/studio   Claude <-> AG Studio adapter conversion, stand-in model
server/*.js     service, executor, scheduler, routes, store, notices, seed
client          React 19 + AG Studio, widgets, theme, saved layouts
scripts         sandbox checks, bundle seeding, buyer approval (never run by build or tests)
test            node --test suites
```

## License

MIT, see LICENSE.
