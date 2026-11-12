# Demo video script (2:45)

## Recording state

```bash
npm install
npm run demo:video      # builds, then starts on http://localhost:3002 with the PayPal stand-in and the recorded Claude run
```

`demo:video` ignores the keys in `.env` (`FORCE_MOCK=1`), so the screen is the same on any machine: PayPal runs on the built-in stand-in and the chat replays the real Claude Sonnet run recorded on 2026-11-12 (`builtin/recorded-runs/`). Keep the caption "PayPal stand-in, recorded Claude Sonnet run" on screen during scenes 3 to 8. Browser window 1680 x 1050, one fresh tab, dark theme.

Optional sandbox variant: `npm run demo:video:sandbox` uses the sandbox keys and `BUNDLES_FILE` in `.env` and the local Claude Code login. Use it only if `data/bundles.json` holds a fresh bundle (seeded within 2 days); a bundle can run once. If anything differs from the script, record the default state instead.

Step numbers below are the README "Testing instructions" steps.

## Scenes

| # | Time | On screen (action) | Narration / caption (English) | Criterion |
|---|---|---|---|---|
| 1 | 0:00-0:15 | PayPal docs page "Update pricing for the subscription plan", highlight "for all existing subscribers" and "Existing subscribers are notified by email" | "I promised my founders $9. On PayPal, a plan price change reaches every existing subscriber, and PayPal emails them." Caption: developer.paypal.com/subscriptions/change-price | Problem, impact |
| 2 | 0:15-0:27 | Stack Overflow question 75801698 (the "10000 subscriptions via Dashboard" line), then the OctoEverywhere post (2025-02-26, "$1-3") | "Operators do this by hand or with scripts: ten thousand subscribers through the dashboard, or a whole price rise announced in a blog post." | Problem, impact |
| 3 | 0:27-0:37 | Start screen, then **Open my bundle** (step 1). Header: 2 plans, 12 subscribers, MRR now $102.00 | "Reprice Desk: an AG Studio dashboard with a Claude agent. Here, a bundle of 12 subscribers." | Product, AG Studio |
| 4 | 0:37-1:00 | Click **Keep founders** (step 2). Chat shows the `scan_subscribers` tool row, then the answer: 4 subscribers disagree (F4, R4, A3, A4). Header chip "Recorded run: Claude Sonnet, 2026-11-12". Type `tag`, `propose_cohort_rules` row appears | "The agent reads the members and finds that three meanings of 'founder' disagree on four people. It asks; I answer 'tag'. It only saves a draft." | AI depth, safety |
| 5 | 1:00-1:08 | Click **Use this rule** (step 3). Strategy compare fills with eight metrics | "I confirm the rule myself. Only now does code compute anything." | Safety, AG Studio |
| 6 | 1:08-1:35 | Type "Founders must not get any email from PayPal. Which strategy do you recommend?" (step 4). `compare_strategies` row opens into the eight-metric table; the answer quotes it (B: 0 plan emails, +$17.00 either way, A needs no checkout change). Point at the widget's "Recommended: B" reason | "Code computes both ways to do it in PayPal. The model may only explain those numbers; it cannot set a price." | AI depth, correctness |
| 7 | 1:35-1:55 | Type "Show kept members by signup month." (step 4, optional part). Chat shows "Delegated to Data agent", "Page agent", "Widget agent"; scroll the dashboard to the new **Kept members by signup month** chart (1, 2, 3) | "Our agent hands dashboard work to AG Studio's own data, page and widget agents. A new chart appears." | AG Studio Agent Framework |
| 8 | 1:55-2:20 | Click **Choose B** (step 5): Approval card, Raise 6 / Keep 6, MRR $102.00 to $119.00 (+$17.00, computed), run now and scheduled lines, ten-day rule line. Click **Approve & run** (step 6), no cut. Execution view: "Kept members unchanged ... (read back from PayPal)", read-back chips, two new plan IDs, run log | "Prices come only from these boxes. After I approve, the server runs a fixed order and reads every member's price back. Founders untouched." | Safety, completeness |
| 9 | 2:20-2:30 | Click **Sandbox evidence** in the header: V1 (a), V1 (b), V2, V3, V5, V6, V7, V17, V11, V12 | "Against the real PayPal sandbox, a keep-override and a plan price change read back as designed: $9 overridden, $12 plain." | PayPal technical fit |
| 10 | 2:30-2:45 | README "Built with the APIMatic Context Plugin" section and `paypal-plan.md` for two seconds | "The PayPal adapter is built on the APIMatic SDK: a claim before every write, and a lost answer is 'unknown', never retried blindly." | APIMatic, engineering |

Total: 2:45.

## Not in the video

- Restyling the generated chart (Studio's column chart has no colour setting, VERIFY.md V12).
- Webhook delivery, sandbox emails (V10, V4, V9 not run) and a full app run against the sandbox in the default state.
- Strategy A (step 7) is left out for time; it is in the README.
