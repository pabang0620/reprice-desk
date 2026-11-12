<img src="client/public/logo-512.png" width="128" alt="logo" />

# Reprice Desk

**Try it:** https://reprice-desk.35-216-2-121.sslip.io (hosted demo: stand-in PayPal, recorded Claude Sonnet runs; no login).

Raise subscription prices on PayPal for exactly the members you choose.

**Pitch:** Reprice Desk lets a small business on PayPal Subscriptions raise prices for exactly the members it chooses: a Claude agent in an AG Studio desk turns "keep founders at $9, raise regular monthly to $12" into a plan, code compares two ways to do it in PayPal, and after the owner approves, every member's price is read back from PayPal.

## The problem

On PayPal, changing a plan's price updates it "for all existing subscribers", and "existing subscribers are notified by email about the price change" ([PayPal docs, update pricing for a plan](https://developer.paypal.com/subscriptions/change-price.md)). A subscription can instead carry its own price: a subscription PATCH can override plan attributes, and "once overridden, changes to plan resource will not impact subscription" ([Subscriptions API v1, Update subscription](https://developer.paypal.com/api/subscriptions/v1/subscriptions-patch)). We saw exactly this in the sandbox (V1 a below). So there are two ways to keep your founders at the old price:

- **Strategy A, raise the plan:** first write each kept member's current price onto their own subscription, verify it, then change the plan price.
- **Strategy B, new plan:** leave the old plan alone, create a new plan for new signups, and raise only the members you pick, one subscription at a time.

Which one is better depends on who your members are and when they are billed. Reprice Desk computes both, shows them side by side, runs the one you approve in a fixed order, and reads the prices back from PayPal.

Real operators do this by hand or with their own scripts: one Stack Overflow question (2023-03-21) describes "around 10000 active subscribed or recurring users" on legacy PayPal Standard buttons, where "updating 10000 subscriptions via Dashboard is not a great idea" ([source](https://stackoverflow.com/questions/75801698)), and OctoEverywhere announced on 2025-02-26 that all its PayPal plans would rise by $1-3 from April 1 ([blog](https://blog.octoeverywhere.com/supporter-perks-changes-for-paypal-users/)). Reprice Desk helps you keep a notice window you choose (for example California's "no less than 7 days and no more than 30 days" before a fee change, [Bus. & Prof. Code 17602](https://california.public.law/codes/business_and_professions_code_section_17602)). It is not legal advice and does not promise compliance.

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

- **Reprice Agent**, a custom Claude agent in Studio's Agent Framework (through a Claude adapter we wrote, with the model behind our server). It reads the subscribers, finds where three readings of "founders" disagree, asks which one you mean, and explains the strategy comparison using only numbers the server computed. It hands dashboard requests to Studio's built-in data, page and widget agents: asked "Show kept members by signup month.", a real Claude Sonnet run delegated to all three and added a working chart (VERIFY.md V12).
- **Recorded run.** Without keys the chat replays a real Claude Sonnet run recorded on 2026-11-12 (`builtin/recorded-runs/`, every tool call in order, the model's text and timings). The header names the source of each answer: "Recorded run: Claude Sonnet, 2026-11-12" for a recorded turn, "Scripted stand-in (no model)" when a question or a tool result does not match the recording. A recorded answer is only replayed when every tool result it relied on is the same as in the recording.
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

No keys are needed. `cp .env.example .env` (or no `.env` at all) runs PayPal on a built-in stand-in that follows the same call shapes and rules (a plan price change reaches only subscriptions without an override; an override cannot be removed) and the chat on the recorded Claude run described above. Nothing waits: every step answers within seconds. The header shows which mode you are in.

- `npm run demo:video` builds and starts the exact state used for the demo video (stand-in PayPal, recorded Claude run, keys in `.env` ignored).
- `npm run walk -- --url http://localhost:3002` walks the steps below in a headless browser and saves a screenshot per step (needs Playwright).

**Sandbox demo mode** (the same app on the real PayPal sandbox): put a sandbox app's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` and `BUNDLES_FILE=./data/bundles.json` in `.env`, seed bundles with `node scripts/seedBundles.js --count N --confirm` (each bundle is 12 subscriptions approved by a sandbox buyer in a headless browser, about 7 minutes; the buyer login comes from `SANDBOX_BUYER_EMAIL` / `SANDBOX_BUYER_PASSWORD` in the environment), then `npm start`. The header chip says "PayPal sandbox" and the Execution view says "read back from the PayPal sandbox"; without keys they say "Stand-in PayPal" and "read back from the PayPal stand-in". The chat stays on the recorded run unless a model backend is set. A bundle is used once; when none is fresh, the start screen says so and steps 1 to 5 run on a read-only copy.

Optional, local development only: `LLM_BACKEND=account npm start` runs the Reprice Agent and Studio's built-in agents on your own Claude Code login (Claude Agent SDK, model `claude-sonnet-5-5`). The API key is removed from the environment of that process. The screen then says "Claude Sonnet (local account)". It is not meant for a hosted server. Adding `LLM_RECORD_FILE=builtin/recorded-runs/my-run.json` records the run; that is how the shipped recording was made (`npm run walk -- --widget` against that server).

Development: `npm run dev:server` and `npm run dev:client` (Vite on port 5175, proxying `/api`).

## Testing instructions (judge walk-through)

1. Open the app and click **Open my bundle**. You get a pre-seeded bundle: 1 product, 2 plans (Pro Monthly $9, Pro Annual $90), 12 subscribers. The start screen shows how many fresh bundles are left. A bundle is used once, because a PayPal subscription override cannot be removed through the API.
2. In the AI Assistant panel click **Keep founders**. The agent calls `scan_subscribers` and says the three readings of "founders" disagree on 4 subscribers (F4, R4, A3, A4). Type `tag`; it saves a draft with `propose_cohort_rules`. The header chip says "Recorded run: Claude Sonnet, 2026-11-12".
3. In the dashboard click **Use this rule** (this is your confirmation). Then type the new prices in the **Approval card**: `12.00` in **New monthly (now $9.00)** and `120.00` in **New annual (now $90.00)**. Both boxes start empty; nothing is compared before you confirm a rule and type both prices.
4. Read the **Strategy compare** widget. Ask the agent "Founders must not get any email from PayPal. Which strategy do you recommend?". It calls `compare_strategies` and its answer quotes the table. Optional: type "Show kept members by signup month." The agent delegates to Studio's data, page and widget agents and a **Kept members by signup month** chart appears below the Members grid (bars 1, 2, 3).
5. Click **Choose B**. The **Approval card** shows the plan for the prices you typed (the two input boxes are the only price source), what runs now, what is scheduled, the ten-day rule, the MRR change (computed).
6. Click **Approve & run**. The Execution view opens: read-back table of every member's price (the first line names the source: "read back from the PayPal stand-in" without keys, "read back from the PayPal sandbox" in sandbox mode), the new plan IDs to put on your checkout button, scheduled raises (they wait for their real dates inside your notice window; **Run due raises** says which one is next and on which date), the run log and webhook rows. The approval and strategy buttons are now disabled.
7. Click **Open a new bundle**, click the **Tagged "founder" (6)** rule in Strategy compare, type `12.00` and `120.00` again, then **Choose A** and **Approve & run** to see the other order: keep-overrides first, verify, then the plan price. In the Execution view the Members table shows F1-F4, A3, A4 as Kept and R1-R4, A1, A2 as Raised, and the first line of **What to do next** lists the kept members as read back.

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

- **Prices come from you.** The two price boxes start empty and the desk computes nothing until you type both. The model never sets a price: a price typed in the chat gets "type it in the approval card", a drafted price in a tool call is ignored and flagged; notice drafts containing amounts the code did not compute are rejected.
- **Fixed order.** Strategy A never changes a plan price until every keep-override has been read back from PayPal; one failure aborts with "Plan price was NOT changed". Strategy B creates the new plans, then raises members one by one, then reads everything back.
- **No pin inside ten days.** In the sandbox an override PATCH on a member charged within 10 days was accepted but not applied (VERIFY.md V18). Strategy A's safety rests on pinning every kept member first, so A waits: the card names the members and the first day A can run, Approve stays disabled, and the server refuses with nothing written. B has no such wait. The stand-in applies the same rule, and bundles are seeded so that no kept member is that close on seed day.
- **Ten-day rule.** A plan price change does not reach a billing cycle within 10 days ([PayPal docs](https://developer.paypal.com/subscriptions/change-price.md)); a subscription price PATCH "will not impact billing cycles within next 10 days" for PayPal-funded subscriptions ([Update subscription](https://developer.paypal.com/api/subscriptions/v1/subscriptions-patch)). The planner shifts or schedules around it.
- **Increase cap.** No cap is assumed: the sandbox accepted a 33 percent subscription PATCH (VERIFY.md V1 b). If an account does show a cap, set `INCREASE_CAP_PCT` and `INCREASE_CAP_DAYS`; a raise above it is then clamped to the cap or blocked, and the card says so.
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
| `LLM_RECORD_FILE` | empty | Development only: append every real model turn to this transcript file |
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

- **Claude** (Anthropic): the Reprice Agent, through a small server-side proxy that converts AG Studio's adapter format to the Anthropic Messages API (API key) or to the Claude Agent SDK (local Claude Code login, used for the recorded run).
- **AG Studio** (`ag-studio`, `ag-studio-react` 3.1.0): dashboard, custom widgets, theme, layout tools, Agent Framework with the built-in data and widget agents.
- **PayPal TypeScript SDK `paypal`** (generated by APIMatic, installed from the plugin's repository; see the next section): every subscription and plan call goes through `client.subscriptions`.
- The code was written with an AI coding assistant.

## Built with the APIMatic Context Plugin

The live PayPal adapter (`server/paypal/livePaypal.js`) was written with the APIMatic Context Plugin for PayPal (version 0.4.1, TypeScript skills). Skills used: `typescript-integrate-paypal` (plan first, contract sheet), `typescript-getting-started` (SDK map lookups), `typescript-error-handling`, `typescript-client-initialization`, `typescript-calling-endpoints`, `typescript-authentication`, `typescript-models`, `typescript-configuration-resilience` and `typescript-testing`.

- **SDK package:** `paypal` (client `PaypalClient`), installed with `npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main`. It is not on npm and is built on install. It replaces `@paypal/paypal-server-sdk`.
- **Through the SDK:** create plan, get plan, update plan pricing schemes, create subscription, get subscription, list subscriptions, patch subscription, list subscription transactions (all `client.subscriptions`).
- **Kept on REST (not in the SDK):** Catalog Products (`createProduct`, used by the seed scripts) and webhook signature verification (`verifyWebhook`).
- **What the SDK work added:** a claim before every PayPal write so the same write cannot reach PayPal twice, a re-read when a write's answer is lost (the result is "unknown", never "failed"), one mapping from PayPal errors to this app's errors (PayPal's reason is shown for a 4xx, credential and quota problems are not blamed on the user), and a check that a write only names members and plans of the bundle being run.
- **Contract sheet:** [`paypal-plan.md`](paypal-plan.md) (signatures, request fields and channels, durable writes, unknown outcomes, error table, configuration decisions).

The tests drive the real SDK through a fake `fetch`. In the PayPal sandbox (2026-11-12) the SDK created plans and subscriptions, patched a keep-override, changed a plan price and read both back (`plan_overridden=true` at $9.00, plain subscription at $12.00). The sandbox refused `page_size=100` for `listSubscriptions`, so the adapter now asks for 20. Details: VERIFY.md V1, V2, V5, V17. The whole app then ran both strategies on fresh sandbox bundles (V19, V20, next section).

## Sandbox evidence

Checks that passed on 2026-11-12 (full rows in VERIFY.md; the same list is in the app under **Sandbox evidence**):

| ID | Result |
|---|---|
| V1 (a) | PASS. Keep-override PATCH on A ($9.00), then plan price 9 -> 12. Read back: A `plan_overridden=true` $9.00, B $12.00 |
| V1 (b) | PASS. Subscription PATCH 9.00 -> 12.00 (33 percent) accepted |
| V2 | PASS. One bundle of 12 subscriptions seeded and ACTIVE (406 s) |
| V3 | PASS. A future `start_time` gives `next_billing_time = start_time` |
| V5 | PASS with a fix. `page_size=100` refused; page size 20 lists all 12 |
| V6 | PASS for the call (no charge yet, empty list) |
| V7 | PASS. `getSubscription(fields=plan)` returns the override price for an overridden subscription |
| V17 | PASS. APIMatic `paypal` SDK smoke on the sandbox host |
| V19 | PASS, whole app, strategy B. Bundle B-PROD-35116877UV205923S: new plans P-7L574748CY976601KNL2VX3Y ($12.00) and P-5SD1647161414471MNL2VX3Y ($120.00); R2, R3, R4 read back $12.00 `plan_overridden=true`; F1-F4, A3, A4 never written, read back $9.00 / $90.00 `plan_overridden=false` |
| V20 | PASS, whole app, strategy A. Bundle B-PROD-1BS32923AB899524L: 8 keep-overrides read back first, then P-92J153053M285780RNL2V26A to $12.00 and P-51905554GW962014TNL2V26I to $120.00; kept members read back $9.00 / $90.00 `plan_overridden=true`, R1-R4 follow the plan at $12.00 |
| V18 | FINDING. An override PATCH inside 10 days of a charge is accepted but not applied (F1 at 6 days, R1 at 4 days stay `plan_overridden=false`; R2 at 12 days applies). Our first strategy A run stopped at verify with "Plan price was NOT changed", as designed |
| V11 | PASS (account-mode Sonnet). `scan_subscribers`, conflict question, `propose_cohort_rules`, `compare_strategies` |
| V12 | PASS (account-mode Sonnet). Delegation to the data, page and widget agents added the chart |

Every sub, plan and step is in `docs/sandbox-checks.md`; the screens are in `docs/sandbox-run/`.

Not run yet, so not claimed: webhooks (V10, needs the hosted server in sandbox mode with a registered webhook), sandbox emails (V4, V9, needs a person at the buyer inbox), the increase cap (V1 c), the ten-day boundary day (V14), whether PayPal applies a ten-day-zone override after the charge (V18).

## Layout

```
server/domain   pure functions: dates, money, cohorts, strategies A/B, derived charges, seed table
server/paypal   live adapter on the APIMatic `paypal` SDK (+ REST for the two calls the SDK lacks) and the stand-in with the same interface
server/studio   Claude <-> AG Studio adapter conversion, account backend, recorder and replay, stand-in model
builtin         recorded-runs: the real Claude Sonnet run replayed in stand-in mode
server/*.js     service, executor, scheduler, routes, store, notices, seed
client          React 19 + AG Studio, widgets, theme, saved layouts
scripts         sandbox checks, bundle seeding, buyer approval, headless walk (never run by build or tests)
test            node --test suites
```

## License

MIT, see LICENSE.
