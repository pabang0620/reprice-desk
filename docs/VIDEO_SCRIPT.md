# Demo video script (about 2:45)

Recorded on the hosted app, https://reprice-desk.35-216-2-121.sslip.io, 1920 x 1080, with `video/record.py`. PayPal runs on the built-in stand-in; the chat is a live Claude Sonnet agent (the tag on screen says so). If a live reply fails twice, the take falls back to the recorded run and the tag says "Recorded run". Every claim stays within `VERIFY.md`. Step numbers are the README "Testing instructions".

## Scenes

| # | On screen | Narration (English) |
|---|---|---|
| 1 | Title card: logo, Reprice Desk, "Raise PayPal subscription prices for exactly the members you choose." | Reprice Desk. Raise subscription prices on PayPal, for exactly the members you choose. |
| 2 | Problem card: PayPal docs line "Existing subscribers are notified by email about the price change" with its source | I promised my founders nine dollars. On PayPal, changing a plan's price reaches every existing subscriber, and PayPal emails them. |
| 3 | Start screen, **Open my bundle** (step 1): 2 plans, 12 subscribers, MRR $102.00 | Bundle of twelve subscribers, AG Studio dashboard, a live Claude Sonnet agent, PayPal stand-in. |
| 4 | **Keep founders**, agent reads members, 4 subscribers disagree (F4, R4, A3, A4); type `tag`; draft saved (step 2) | The agent finds three meanings of founder disagree on four people, asks, saves only a draft. |
| 5 | **Use this rule**, type 12.00 and 120.00 in the Approval card (step 3) | I confirm the rule and type the prices myself. Only now does code compute anything. |
| 6 | Strategy compare, eight metrics (step 4) | Two ways to do it in PayPal, side by side. B: zero plan emails, six overrides. A: no checkout change. |
| 7 | Ask the recommendation question; `compare_strategies` row; answer quotes the table | The model explains the numbers, it cannot set a price. |
| 8 | Ask "Show kept members by signup month."; delegation to Data, Page, Widget agents; new chart (step 4, optional) | AG Studio's own agents add a chart. |
| 9 | **Choose B**, Approval card, **Approve & run**, Execution view with read-back (steps 5, 6) | Fixed order, every member's price read back, founders untouched. |
| 10 | **Sandbox evidence** panel (V1 a/b, V2, V3, V5, V6, V7, V17, V18, V19, V20) labelled sandbox | Real PayPal sandbox: keep-override and plan change read back as designed; strategy A waits when a charge is within ten days. |
| 11 | End card: repo, hosted URL, PayPal, APIMatic, AG Studio, Claude | Built with PayPal Subscriptions, the APIMatic SDK, AG Studio and Claude. |

## Not in the video

- Restyling the generated chart (Studio's column chart has no colour setting, VERIFY.md V12).
- Webhook delivery and sandbox emails (V10, V4, V9 not run).
- Strategy A walk-through (step 7); it is in the README.
