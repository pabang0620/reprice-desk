// Checks that passed against the real PayPal sandbox (and the real model), copied from VERIFY.md.
// Only PASS items and measured findings are listed. SKIPPED items (V1 c, V4, V8, V9, V10, V13, V14) are not claimed anywhere. Hosting (V16) is not sandbox evidence.
export const SANDBOX_EVIDENCE = {
  ranOn: '2026-11-12',
  sandbox: [
    { id: 'V1 (a)', result: 'PASS', text: 'Keep-override PATCH on A ($9.00), then plan price 9 -> 12. Read back: A plan_overridden=true $9.00, B $12.00.' },
    { id: 'V1 (b)', result: 'PASS', text: 'Subscription PATCH 9.00 -> 12.00 (33 percent) accepted.' },
    { id: 'V2', result: 'PASS', text: 'One bundle of 12 subscriptions seeded and ACTIVE (B-PROD-35116877UV205923S, 406 s).' },
    { id: 'V3', result: 'PASS', text: 'A future start_time gives next_billing_time = start_time (the first bundle read back 4 to 200 days ahead, as designed).' },
    { id: 'V5', result: 'PASS with a fix', text: 'listSubscriptions refused page_size=100; with page size 20 it lists all 12 ACTIVE.' },
    { id: 'V6', result: 'PASS (call)', text: 'listSubscriptionTransactions answered (empty, no charge yet).' },
    { id: 'V7', result: 'PASS', text: 'getSubscription(fields=plan) returns the override price for an overridden subscription, the plan price otherwise.' },
    { id: 'V17', result: 'PASS', text: 'APIMatic paypal SDK smoke: listBillingPlans, getBillingPlan, listSubscriptions on the sandbox host.' },
    { id: 'V19', result: 'PASS (whole app)', text: 'Strategy B on bundle B-PROD-35116877UV205923S: new plans P-7L574748CY976601KNL2VX3Y ($12.00) and P-5SD1647161414471MNL2VX3Y ($120.00); R2, R3, R4 read back $12.00 overridden; F1-F4, A3, A4 never written, read back $9.00 / $90.00.' },
    { id: 'V20', result: 'PASS (whole app)', text: 'Strategy A on bundle B-PROD-1BS32923AB899524L: 8 keep-overrides read back, then plans P-92J153053M285780RNL2V26A to $12.00 and P-51905554GW962014TNL2V26I to $120.00; kept members read back $9.00 / $90.00 overridden, R1-R4 follow the plan at $12.00.' },
    { id: 'V18', result: 'FINDING', text: 'An override PATCH inside 10 days of a charge is accepted but not applied (F1 at 6 days, R1 at 4 days stay plan_overridden=false; R2 at 12 days applies). The first strategy A run stopped at verify with "Plan price was NOT changed"; strategy A now waits until no member it must pin is that close to a charge.' },
  ],
  model: [
    { id: 'V11', result: 'PASS (account-mode Sonnet)', text: 'scan_subscribers, conflict question (F4, R4, A3, A4), propose_cohort_rules, compare_strategies, answer quoted the table.' },
    { id: 'V12', result: 'PASS (account-mode Sonnet)', text: 'Delegated to the data, page and widget agents; a "kept members by signup month" chart was added (1, 2, 3).' },
  ],
  notClaimed: 'Not run yet: webhooks (V10, needs the hosted server in sandbox mode with a registered webhook), sandbox emails (V4, V9, needs a person at the buyer inbox), the increase cap (V1 c), the ten-day boundary day (V14), whether PayPal applies a ten-day-zone override after the charge (V18).',
}
