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
