# Reprice Desk: Devpost draft

**Tagline:** Raise PayPal subscription prices for exactly the members you choose, and read every price back from PayPal.

## Inspiration

On PayPal, changing a plan's price changes it for every existing subscriber and PayPal emails them. Real operators work around this by hand or with scripts (one Stack Overflow question describes about 10,000 PayPal subscribers and calls the dashboard route "not a great idea"). We wanted a desk where an operator says "keep founders at $9, raise regular monthly to $12" and the dangerous parts are handled by code.

## What it does

An AG Studio dashboard with a Claude agent. The agent reads the subscribers, finds where three readings of "founders" disagree (tag, signup month, launch campaign), asks which one you mean, and explains a code-computed comparison of two strategies:

- A: raise the plan price, after pinning each kept member's price with a subscription override and reading it back.
- B: create a new plan for new signups and raise only chosen members one by one.

You type the prices (the model never sets one), approve, and the server runs a fixed order and reads every member's price back from PayPal. The Execution view shows the kept members unchanged, the new plan IDs, scheduled raises and the run log.

## How we built it

- **AG Studio:** Agent Framework with a custom Claude adapter (Studio ships none), our Reprice Agent delegating to the built-in data and widget agents, five custom widgets, two of them reading the Studio data engine through `widgetApi.getData` with a data mapping, a navy, mint and amber theme with a light variant, badge cell renderers on the grids, chat tool displays, and saved layouts.
- **APIMatic:** the live PayPal adapter is written on the `paypal` TypeScript SDK from the APIMatic Context Plugin. The contract sheet (`paypal-plan.md`) produced write claims (the same write cannot reach PayPal twice), "unknown" outcomes when a response is lost, and one error mapping.
- **Claude:** server-side proxy that converts Studio's adapter shapes to the Anthropic Messages API. Every number the agent states comes from a tool result.
- **Money rules in code:** fixed order, ten-day rule, notice window, locks per bundle, one run per plan.

## Challenges

- PayPal ignores a price change when the next charge is within 10 days, and the rule differs between plan changes and subscription PATCH.
- An override cannot be removed, so a bundle can be used once.
- The sandbox rejected `page_size=100` for `listSubscriptions`; the sandbox run found it and the adapter now asks for 20.

## Accomplishments

Sandbox checks run on 2026-11-12 (VERIFY.md): V1 (a, b) a keep-override and a plan price change work together and a 33 percent PATCH is accepted; V2 one 12-subscription bundle seeded; V3 future start dates give the expected next billing time; V5, V6, V7 read calls; V17 SDK smoke.

## What's next

A toggle that watches for plan price changes made in the PayPal dashboard.

## Built with

AG Studio, React 19, Vite, Express, zod, PayPal TypeScript SDK (APIMatic), Claude (Sonnet), Node.js.

## Testing instructions

Copy the "Testing instructions (judge walk-through)" section of README.md. No keys are needed; the header shows which mode you are in.
