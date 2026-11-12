# Sandbox checks (real sandbox) 2026-11-12T01:35:20.138Z

## V3 / V5 / V7
- V5 listSubscriptions on P1: REJECTED PAYPAL_REJECTED Request is not well-formed, syntactically incorrect, or violates schema. Incorrect pagination parameters
- V3 next billing time of A (start_time + 20d): OK "2026-12-02T10:00:00Z"
## V1 (a) keep-override, then plan price 9 -> 12
- PATCH A to the same price 9.00: OK 
- plan P1 9.00 -> 12.00 (33 percent): OK 
- read back A: overridden=true price=$9.00 | B: overridden=false price=$12.00
## V1 (b) raise PATCH 9 -> 12 on C (plan P2 untouched)
- PATCH C to 12.00 (33 percent): OK 
## V6 transactions of A
- listSubscriptionTransactions: OK []

Human steps: (V9) open the sandbox buyer inbox and note whether A received a plan price change email. (V4) note whether C received a PATCH email. (V10) check webhook delivery in the developer dashboard.

## 2026-11-12 follow-up
- V5 `page_size=100` refused; `pageSize: 20` works and lists 12 ACTIVE. List items are summaries, loadSnapshot reads each by id.
- V2 bundle B-PROD-35116877UV205923S: 12 subscriptions ACTIVE in 406s (first run of 12 also took 6m43s; its save failed because ./data did not exist, fixed in server/store.js).
- Code fixes: scripts/lib/approve.js (Continue step, visible-button selector, CHROMIUM_PATH, debug screenshot via APPROVE_DEBUG_DIR), server/store.js (mkdir), server/paypal/livePaypal.js (pageSize 20).

## 2026-11-12 app run against the sandbox (V18, V19)

Server: `npm start` with the sandbox app keys in `.env` (header chip "PayPal sandbox"), chat on the recorded Claude run. Driven by `npm run walk` (headless chromium). Screens and the walk log: `docs/sandbox-run/`.

### V19 strategy B, whole app, bundle B-PROD-35116877UV205923S: PASS
- Steps: Open my bundle, Keep founders, `tag`, Use this rule, typed 12.00 / 120.00, recommendation question, Choose B, Approve & run.
- Card: Raise 6, Keep 6, MRR $102.00 to $119.00 (+$17.00, computed). Run now: create 2 new plans, PATCH R2 R3 R4.
- New plans created: monthly P-7L574748CY976601KNL2VX3Y ($12.00), annual P-5SD1647161414471MNL2VX3Y ($120.00).
- PATCHed and read back: R2 I-NVHKBAP97TXH, R3 I-YEN1B22UKC7U, R4 I-PMDA9FHBWCTB at $12.00, `plan_overridden=true`.
- Kept, never written, read back: F1 I-VYG4W74UD5CD, F2 I-EA3LU4SGGLUG, F3 I-121AHF4BJG5T, F4 I-L2866TXXMY84 at $9.00, A3 I-HLLP8FMX3V0E, A4 I-2BGXBCMRABLX at $90.00, all `plan_overridden=false`. Old plans unchanged (P-8P490882XJ023910LNL2RRPY $9.00, P-75A96992D6228694VNL2RRQA $90.00).
- Scheduled, not run: R1 2026-11-17 (charged in 4 days, ten-day rule), A1 2026-11-27, A2 2027-02-10.
- Screen: "Strategy B: every price read back from the PayPal sandbox as planned."

### Strategy A, whole app, bundle B-PROD-75N74227JH045615N: stopped by the safety check (finding V18)
- Card: 8 keep-overrides -> verify -> 2 plan price changes. All 8 override PATCHes were accepted.
- Verify: F1 (I-4BN7NSPF05T9, next charge in 6 days) read back `plan_overridden=false`. The run stopped: "Override for F1 did not read back. Plan price was NOT changed." Plans P-0MP093386J087762HNL2VP6Q and P-81W36883MB825112ENL2VP6Y stayed at $9.00 / $90.00.

### V18 does an override PATCH apply inside 10 days of a charge: NO (sandbox)
`node scripts/tenDayOverrideCheck.js --bundle B-PROD-75N74227JH045615N --labels F1,R1,R2 --confirm` (same price, no change of amount):
- F1, next charge in 6 days: PATCH accepted, read back after 5 s and 35 s `plan_overridden=false`.
- R1, next charge in 4 days: PATCH accepted, read back after 5 s and 35 s `plan_overridden=false`.
- R2, next charge in 12 days: PATCH accepted, read back after 5 s `plan_overridden=true`.

What changed because of V18: strategy A now waits (card note, Approve disabled, server refuses with nothing written) while a member it must pin is charged within 10 days; the stand-in applies the same rule; new bundles seed F1 16 days out (was 6) so strategy A can run on seed day.

### V20 strategy A, whole app, fresh bundle B-PROD-1BS32923AB899524L (F1 seeded 16 days out): PASS
- `npm run walk -- --strategy A --one-bundle` against the sandbox server, prices typed 12.00 / 120.00.
- Order in the run log: 8 keep-overrides (F1 I-R532VW6WAXYX, F2 I-U45RR05F8FKE, F3 I-7WW21S09W0V8, F4 I-0Y9ANCAAA4UM at $9.00; A1 I-TPN9A42M6S9C, A2 I-2KF5042CXBVV, A3 I-4E0YKRV7YJ8N, A4 I-A36P4XPHUJ83 at $90.00), then "8 overrides done: all keep-overrides read back from the PayPal sandbox", then plan price P-92J153053M285780RNL2V26A to $12.00. The annual plan P-51905554GW962014TNL2V26I also changed to $120.00 (header after the run: Pro Monthly $12, Pro Annual $120).
- Read back: F1-F4 $9.00 and A1-A4 $90.00 `plan_overridden=true`; R1 I-08XMFG4EL61Y, R2 I-BF6YS7XYJM7S, R3 I-WB7NE7XN59Y9, R4 I-8STVNNRJM0VJ follow the plan at $12.00 (R1's derived next charge stays $9.00, ten-day rule).
- Scheduled, not run: A1 2026-11-27, A2 2027-02-10 (raise by PATCH inside the notice window).
- Screen: "Strategy A: every price read back from the PayPal sandbox as planned." Screens `docs/sandbox-run/a-05-approval-card.png`, `a-06-execution.png`.
- No webhook rows: no webhook is registered (V10 needs a public host).
