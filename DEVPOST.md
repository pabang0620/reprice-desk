# Reprice Desk: Devpost draft

**Tagline:** Raise PayPal subscription prices for exactly the members you choose, and read every price back from PayPal.

## Inspiration

On PayPal, changing a plan's price updates it "for all existing subscribers", and "existing subscribers are notified by email about the price change" (PayPal docs: https://developer.paypal.com/subscriptions/change-price.md). The way to keep some members at their old price is a per-subscription override: "once overridden, changes to plan resource will not impact subscription" (Subscriptions API, Update subscription: https://developer.paypal.com/api/subscriptions/v1/subscriptions-patch). Doing that safely, member by member and in the right order, is left to the merchant.

Real operators do it by hand or with scripts. One Stack Overflow question (2023-03-21) describes "around 10000 active subscribed or recurring users" on legacy PayPal Standard buttons and says "updating 10000 subscriptions via Dashboard is not a great idea" (https://stackoverflow.com/questions/75801698). OctoEverywhere announced on 2025-02-26 that all its PayPal plans would rise by $1-3 from April 1 (https://blog.octoeverywhere.com/supporter-perks-changes-for-paypal-users/). We wanted a desk where an operator says "keep founders at $9, raise regular monthly to $12" and the dangerous parts are handled by code.

## Who it is for

**First real user:** the owner of a small membership business (a newsletter, a paid community, a small SaaS) that bills a few hundred to a few thousand members through PayPal Subscriptions and wants to raise prices without touching the founders who were promised the old price.

**The problem in numbers:** a plan price change reaches every existing subscriber and emails them (PayPal docs above); an override is the only per-member protection; a price change does not reach a billing cycle within 10 days, and for a subscription PATCH this applies to PayPal-funded subscriptions (both PayPal docs above); and in California a fee change needs notice "no less than 7 days and no more than 30 days" before it takes effect (Bus. & Prof. Code 17602: https://california.public.law/codes/business_and_professions_code_section_17602). For our 12-member demo bundle that is 12 versus 8 PayPal writes, 8 versus 6 overrides left behind, and 1 member pushed out of a 7-30 day notice window by strategy A (computed by the app, see the table in README).

## What it does

An AG Studio dashboard with a Claude agent. The agent reads the subscribers, finds where three readings of "founders" disagree (tag, signup month, launch campaign), asks which one you mean, and explains a code-computed comparison of two strategies:

- A: raise the plan price, after pinning each kept member's price with a subscription override and reading it back.
- B: create a new plan for new signups and raise only chosen members one by one.

You type the prices into two empty boxes (the model never sets one, and nothing is computed before you do), approve, and the server runs a fixed order and reads every member's price back. The Execution view shows the kept members unchanged, the new plan IDs, scheduled raises and the run log.

## Why this is good for PayPal

- **Merchant volume stays on PayPal.** A merchant who cannot raise prices safely on PayPal either freezes prices or moves members to another processor (OctoEverywhere offered its PayPal members a switch to other payment methods to avoid the increase, in the same post). A safe repricing path keeps that recurring volume on PayPal Subscriptions.
- **Less risk and fewer support cases.** Wrong-order repricing (plan price first, overrides second) charges protected members the new price. The desk refuses that order, reads every price back, and treats a lost write response as "unknown" instead of retrying blindly.
- **A product PayPal could ship.** "Reprice with cohorts" as a Subscriptions dashboard feature or an Agent Toolkit tool: choose who keeps the old price, preview the ten-day and notice-window effects, then run overrides and plan changes in a verified order.

## What the demo proves today, and what needs PayPal

- **Proven today:** the whole app ran both strategies on fresh PayPal sandbox bundles (VERIFY.md V19, V20, 2026-11-12). B created new plans P-7L574748CY976601KNL2VX3Y and P-5SD1647161414471MNL2VX3Y, raised R2, R3, R4 to $12.00 and never wrote to the six kept members, who read back at $9.00 / $90.00. A pinned eight members, read them back, then moved plans P-92J153053M285780RNL2V26A and P-51905554GW962014TNL2V26I to $12.00 / $120.00; the kept members read back at their old price with `plan_overridden=true`. The money rules and both strategies are covered by 123 `node --test` tests. Earlier the same day, on the PayPal sandbox (VERIFY.md, 2026-11-12) a keep-override and a plan price change work together and read back as designed (V1 a), a 33 percent subscription PATCH is accepted (V1 b), a 12-subscription bundle was seeded (V2), and the APIMatic SDK calls work on the sandbox host (V3, V5, V6, V7, V17); a real Claude Sonnet run (local Claude Code account) used the desk's tools and Studio's built-in agents (V11, V12).
- **Not proven yet:** sandbox webhooks (V10), whether PayPal emails overridden members on a plan change (V9), whether a PATCH sends email (V4), and whether PayPal applies an override placed inside the ten-day zone after the charge (V18).
- **Needs PayPal or partners:** a first-party "next charge amount" field (the desk derives it), a way to remove an override (bundles are single-use because there is none), and a documented answer on increase caps.

## How we built it

- **AG Studio:** Agent Framework with a Claude adapter we wrote, our Reprice Agent delegating to the built-in data, page and widget agents, five custom widgets, two of them reading the Studio data engine through `widgetApi.getData` with a data mapping, a navy, mint and amber theme with a light variant, badge cell renderers on the grids, chat tool displays, and saved layouts.
- **APIMatic:** the live PayPal adapter is written on the `paypal` TypeScript SDK from the APIMatic Context Plugin. The contract sheet (`paypal-plan.md`) produced write claims (the same write cannot reach PayPal twice), "unknown" outcomes when a response is lost, and one error mapping.
- **Claude:** server-side proxy that converts Studio's adapter shapes to the Anthropic Messages API or the Claude Agent SDK. Every number the agent states comes from a tool result. The judge build replays a recorded real Claude Sonnet run (2026-11-12, `builtin/recorded-runs/`), labelled "Recorded run: Claude Sonnet, 2026-11-12"; a question outside the recording is answered by a scripted stand-in that is labelled as such.
- **Money rules in code:** fixed order, ten-day rule, notice window, locks per bundle, one run per plan.

## Challenges

- PayPal ignores a price change when the next charge is within 10 days, and the rule differs between plan changes and subscription PATCH.
- An override cannot be removed, so a bundle can be used once.
- The sandbox rejected `page_size=100` for `listSubscriptions`; the sandbox run found it and the adapter now asks for 20.
- Our first strategy A run in the sandbox stopped at its own verify step: PayPal accepted the override PATCH for a founder charged in 6 days but did not apply it (`plan_overridden=false` after 35 seconds; a member 12 days out was applied). The plan price was not changed, as designed. A direct check confirmed it (VERIFY.md V18), so strategy A now waits until no member it must pin is within 10 days of a charge, and the stand-in follows the same rule.

## Accomplishments

The whole app ran strategy B and strategy A on fresh PayPal sandbox bundles and read every price back (V19, V20). Sandbox checks that passed on 2026-11-12 (VERIFY.md, also in the app under **Sandbox evidence**): V1 (a) a keep-override and a plan price change work together, read back $9.00 overridden and $12.00 plain; V1 (b) a 33 percent PATCH is accepted; V2 one 12-subscription bundle seeded; V3 future start dates give the expected next billing time; V5 list subscriptions (page size 20, 100 was refused); V6, V7 read calls; V17 SDK smoke. Model checks: V11 and V12 (account-mode Claude Sonnet).

## What's next

What is already in the code is marked; the rest is not built yet.

- **Dashboard change watch (not built; the switch is shown disabled in Next steps):** read the bundle's plans on the hourly scheduler and warn when a plan price was changed in the PayPal dashboard outside the desk, before the next charge.
- **Increase caps (in the code):** `INCREASE_CAP_PCT` / `INCREASE_CAP_DAYS` already clamp or block a raise above a cap and say so on the card. Next: detect the cap from PayPal's refusal message instead of a setting.
- **More than one currency (not built):** today the bundle is USD only; the strategy math is per plan, so a plan per currency is the next step.
- **"Reprice with cohorts" as an agent tool (not built):** the same three steps (choose who keeps the price, compare A and B, run the verified order) offered as a tool to other agents, for example through the PayPal Agent Toolkit, with the approval card staying the only place a price is set.

## Built with

AG Studio, React 19, Vite, Express, zod, PayPal TypeScript SDK (APIMatic), Claude (Sonnet), Node.js.

## Testing instructions

**Try it:** https://reprice-desk.35-216-2-121.sslip.io (hosted demo: stand-in PayPal, recorded Claude Sonnet runs; no login).

No keys are needed (`npm install && npm run build && npm start`, then http://localhost:3002). The header shows which mode you are in and where each chat answer came from.

1. Click **Open my bundle** (1 product, 2 plans, 12 subscribers).
2. Click **Keep founders**. The agent calls `scan_subscribers` and says the three readings of "founders" disagree on 4 subscribers (F4, R4, A3, A4). Type `tag`.
3. Click **Use this rule** in the dashboard, then type `12.00` and `120.00` in the two empty price boxes of the Approval card.
4. Ask "Founders must not get any email from PayPal. Which strategy do you recommend?" The answer quotes the Strategy compare table. Optional: "Show kept members by signup month." adds a chart through Studio's built-in agents.
5. Click **Choose B**. The Approval card shows the plan and the computed MRR change.
6. Click **Approve & run**. The Execution view shows every member's price read back, the new plan IDs and the run log.
7. Click **Open a new bundle**, the **Tagged "founder" (6)** rule, type the two prices again, **Choose A**, **Approve & run**: F1-F4, A3, A4 stay Kept.
