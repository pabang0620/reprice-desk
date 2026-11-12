# paypal-plan.md: Reprice Desk on the APIMatic PayPal TypeScript SDK

Scope: move the live PayPal calls of `server/paypal/livePaypal.js` from `@paypal/paypal-server-sdk` to the plugin SDK `paypal` (client `PaypalClient`). The mock adapter and the adapter interface do not change.

Sources read: `typescript-integrate-paypal`, `typescript-getting-started`, `typescript-error-handling`, `typescript-client-initialization`, `typescript-calling-endpoints`, `typescript-authentication`, `typescript-models`, `typescript-configuration-resilience`, `typescript-testing` (plugin 0.4.1). Facts below come from `node_modules/paypal/sdk-map.md`, `map/operations/subscriptions.md` and the model files named in the Type sources tables. SDK version 2.29.0.

## Toolchain and repo survey

| Item | Value |
| --- | --- |
| Language / module format | plain JavaScript, ESM (`"type": "module"`), Node >= 20 (SDK floor 20.3) |
| Package manager | npm. SDK installed with `npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main`; `dist/` is present after install (the SDK builds in its `prepare` script) |
| Type check | none configured (no tsconfig); the SDK types cannot be checked by a compiler here. Every call is written from the map. This is stated in BUILD_REPORT.md |
| Tests | `node --test test/*.test.js`; baseline before changes: 56 pass |
| Build | `vite build` (client only) |
| Layering imitated | `server/paypal/mockPaypal.js` for the adapter shape, `server/paypal/errors.js` for `PaypalError(code, message, status)`, `server/http.js` central `errorHandler` (reads `err.status`, `err.message`) |
| Replaced dependency | `@paypal/paypal-server-sdk` (removed from package.json) |

## Host decision

The SDK declares one environment (`https://api-m.sandbox.paypal.com`) and no `ServerEnvironment`. This app only ever talks to the PayPal sandbox. `LivePaypal` sets `serverOptions.baseUrl` to the sandbox URL explicitly and the constructor refuses any other host and refuses blank credentials, so a live secret cannot be aimed at another host. The REST calls that stay on REST use the same constant.

## Operations in scope

All eight Subscriptions operations the adapter uses are in the SDK (`client.subscriptions`).

| Adapter method | SDK operation | Request type (Signature bullet) | Wire | Returns | Error class |
| --- | --- | --- | --- | --- | --- |
| `createPlan` | `createBillingPlan` | `Subscriptions.CreateBillingPlanRequest` | `POST /v1/billing/plans` | `BillingPlan` | `Subscriptions.CreateBillingPlanError` |
| `getPlan` | `getBillingPlan` | `Subscriptions.GetBillingPlanRequest` | `GET /v1/billing/plans/{id}` | `BillingPlan` | `Subscriptions.GetBillingPlanError` |
| `getSubscription` | `getSubscription` | `Subscriptions.GetSubscriptionRequest` | `GET /v1/billing/subscriptions/{id}` | `Subscription` | `Subscriptions.GetSubscriptionError` |
| `listSubscriptions` | `listSubscriptions` | `Subscriptions.ListSubscriptionsRequest` | `GET /v1/billing/subscriptions` | `SubscriptionCollection` | `Subscriptions.ListSubscriptionsError` |
| `overrideSubscriptionPrice` | `patchSubscription` | `Subscriptions.PatchSubscriptionRequest` | `PATCH /v1/billing/subscriptions/{id}` | `undefined` | `Subscriptions.PatchSubscriptionError` |
| `updatePlanPrice` | `updateBillingPlanPricingSchemes` | `Subscriptions.UpdateBillingPlanPricingSchemesRequest` | `POST /v1/billing/plans/{id}/update-pricing-schemes` | `undefined` | `Subscriptions.UpdateBillingPlanPricingSchemesError` |
| `listTransactions` | `listSubscriptionTransactions` | `Subscriptions.ListSubscriptionTransactionsRequest` | `GET /v1/billing/subscriptions/{id}/transactions` | `TransactionsList` | `Subscriptions.ListSubscriptionTransactionsError` |
| `createSubscription` | `createSubscription` | `Subscriptions.CreateSubscriptionRequestParams` (the `RequestParams` spelling) | `POST /v1/billing/subscriptions` | `Subscription` | `Subscriptions.CreateSubscriptionError` |

All eight carry `Auth: oauth2`. All 4xx/5xx arms of every operation carry a `SubscriptionError` body (`name`, `message`, `debugId` required; `details?`); arm tags are `subscriptionError`, `subscriptionError2`, ... by position and differ per operation, so the code never switches on the tag. It reads `err.status` and takes the body from whichever arm carries a `body`.

Response mode: awaited (throwing) form for all eight. The two `undefined` operations (`patchSubscription`, `updateBillingPlanPricingSchemes`) are decided by "did not reject", then re-read with a read operation; no status or header of a success is needed, so `.asApiResult()` is not used.

### Not in the SDK, kept on REST

| Adapter method | REST call | Why |
| --- | --- | --- |
| `createProduct` | `POST /v1/catalogs/products` | Catalog Products is not among the SDK's five resources (orders, payments, vault, transactionSearch, subscriptions). Used only by the seed and check scripts |
| `verifyWebhook` | `POST /v1/notifications/verify-webhook-signature` | Webhook verification is not in the SDK (no webhook surface at all) |
| token for the two calls above | `POST /v1/oauth2/token` | Needed only because the two REST calls cannot use the SDK's token cache |

Listed in the README as "kept on REST". They keep their existing code and are now unit tested through an injected `fetch`.

## Request field tables

Channel and defaults are from the Fields tables. Only fields a row of this sheet or the task requires are set.

### createBillingPlan (`CreateBillingPlanRequest`)

| Field | Channel | Requires it | Set? |
| --- | --- | --- | --- |
| `prefer` (default `return=minimal`) | header `Prefer` | nothing. Minimal still returns `id`; the adapter re-reads the plan with `getBillingPlan` | leave out (the SDK still sends its default) |
| `payPalRequestId` | header `PayPal-Request-Id` | DUPLICATE CLAIMS and UNKNOWN OUTCOMES rows (reference stored on the claim) | set |
| `body` (`PlanRequest`): `productId`, `name`, `billingCycles`, `paymentPreferences` | body | required members | set |
| `body.billingCycles[0]`: `frequency.intervalUnit`, `tenureType = REGULAR`, `sequence = 1`, `pricingScheme.fixedPrice` (`currencyCode`, `value`) | body | task: one regular cycle at the chosen price | set |
| `body.billingCycles[0].totalCycles = 0` | body | task: the plan renews until cancelled. Default is `1`, which would end the plan after one cycle | set |
| `body.billingCycles[0].frequency.intervalCount` | body | nothing (default 1 is what we want) | leave out |
| `body.paymentPreferences` members (`autoBillOutstanding`, `setupFeeFailureAction`, `paymentFailureThreshold`) | body | nothing. The old code set them; nothing in the task requires them, so provider/SDK defaults apply | leave out (object sent as `{}`; the SDK adds its schema defaults) |
| `body.status`, `description`, `merchantPreferences`, `taxes`, `quantitySupported` | body | nothing | leave out |

### createSubscription (`CreateSubscriptionRequestParams`)

| Field | Channel | Requires it | Set? |
| --- | --- | --- | --- |
| `prefer` (default `return=minimal`) | header | nothing. Minimal returns `id` and `links` including `approve` | leave out |
| `payPalRequestId` | header | DUPLICATE CLAIMS / UNKNOWN OUTCOMES rows | set |
| `payPalClientMetadataId` | header | nothing | leave out |
| `body.planId` | body | required | set |
| `body.startTime` | body | task: seeded members get future billing dates | set |
| `body.customId` | body | task: carries the cohort tag; also the reference an UNKNOWN OUTCOMES re-read searches by | set |
| `body.applicationContext.returnUrl`, `cancelUrl` | body | required members of the context | set |
| `body.applicationContext.shippingPreference = NO_SHIPPING` | body | the seeding approver (`scripts/lib/approve.js`) has no shipping step; the default would ask for an address | set |
| `body.applicationContext.userAction` | body | nothing (default `SUBSCRIBE_NOW` is the old value) | leave out |
| `body.quantity`, `shippingAmount`, `subscriber`, `autoRenewal`, `plan` | body | nothing | leave out |

### patchSubscription (`PatchSubscriptionRequest`)

| Field | Channel | Requires it | Set? |
| --- | --- | --- | --- |
| `id` | path | required | set |
| `body` = `[ { op: replace, path: /plan/billing_cycles/@sequence==1/pricing_scheme/fixed_price, value: { currency_code, value } } ]` | body | task: the price override. `Patch.value` is a free record sent verbatim, so its keys are wire spellings | set |
| `Idempotency-Key` | header | minted by the SDK per call; a repeat by our own code is a new call, so the claim (not this key) stops the second write | not ours |

### updateBillingPlanPricingSchemes (`UpdateBillingPlanPricingSchemesRequest`)

| Field | Channel | Requires it | Set? |
| --- | --- | --- | --- |
| `id` | path | required | set |
| `body.pricingSchemes[0]`: `billingCycleSequence = 1`, `pricingScheme.fixedPrice` | body | task: raise the plan price | set |
| other `pricingScheme` members | body | nothing | leave out |

### Reads

| Operation | Fields set | Requires it |
| --- | --- | --- |
| `getBillingPlan` | `id` | required |
| `getSubscription` | `id`; `fields = "plan"` | task: the overridden price of a member lives in the plan section (V7 in VERIFY.md) |
| `listSubscriptions` | `planIds` (comma-joined string), `statuses = "ACTIVE"`, `pageSize = 100` | task: list the bundle's active members; the default page size 10 would hide members of a 12-member bundle. Not paginated (see below) |
| `listSubscriptionTransactions` | `id`, `startTime`, `endTime` | required |

Reads use only the fields above; the test "sends no key we did not set" checks the captured request.

## DURABLE WRITES

The app has no database. The claim store it owns is `server/paypal/writeClaims.js`, an in-memory map (same lifetime as the session store). The durable, restart-safe "this bundle already ran" mark is the existing `store.claimBundleForRun`, which sits one level above and runs before any adapter write. The adapter claim is the second line: it stops a repeat of the same write inside one process (double click through a different route, scheduler plus run, a retry by our own code).

### DUPLICATE CLAIMS

| Write | Where the claim is stored | What rejects the second one | Where that rejection is caught | Where in the code |
| --- | --- | --- | --- | --- |
| `createPlan` | `WriteClaims` map, key `plan:{productId}:{interval}:{priceCents}` | `WriteClaims.begin()` refuses a key that already exists (same value every caller computes: product, interval, target price) | `LivePaypal.#write`: the loser (`claims.begin` returns `won: false`) uses the winner's recorded result instead of calling the SDK | `server/paypal/livePaypal.js` `createPlan` -> `#write` (claim via `WriteClaims.begin`) -> `subscriptions.createBillingPlan` |
| `overrideSubscriptionPrice` | key `override:{subId}:{priceCents}` | same | same | `LivePaypal.overrideSubscriptionPrice` -> `#write` -> `subscriptions.patchSubscription` |
| `updatePlanPrice` | key `planprice:{planId}:{priceCents}` | same | same | `LivePaypal.updatePlanPrice` -> `#write` -> `subscriptions.updateBillingPlanPricingSchemes` |
| `createSubscription` | key `sub:{customId}:{planId}` | same | same | `LivePaypal.createSubscription` -> `#write` -> `subscriptions.createSubscription` |

Rules implemented: claim, then SDK call, then record. The claim is released when PayPal refuses the call (an `api` error, an `encode` error, an `auth` error: the request never took effect) so a later legitimate attempt is not blocked. A claim in state `unknown` is kept; the next caller settles it by re-reading before doing anything (see below). The `PayPal-Request-Id` of createBillingPlan / createSubscription is the claim key, sent beside the claim, never in place of it. patch and update-pricing-schemes declare no request-id field of their own; the SDK-minted `Idempotency-Key` is not relied on.

Limit, stated plainly: the claims are in memory. After a process restart a claim is gone; the bundle-level `used` mark (persisted in `BUNDLES_FILE`) and the read-before-write in `overrideIfNeeded` are what protect a restarted server.

### UNKNOWN OUTCOMES

Only `connection` and `timeout` (and `decode` on a 2xx status) mean "PayPal may have acted". `auth` and `encode` never left, so they do not re-read.

| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |
| --- | --- | --- | --- | --- |
| `createPlan` | `listBillingPlans` filtered by `productId`, matched on plan `name` (list is read in full, up to 10 pages); found -> `getBillingPlan` | plan name + the `PayPal-Request-Id` sent. Name is unique per run (`{old name} {price} (new signups)`) | `LivePaypal.#findPlanByName` (called from `#settleUnknown`) | `test/liveSdk.test.js` `test/liveSdk.test.js` "createPlan lost response: ..."; never-sent: "never-sent failure (credential refused) on a write" (asserts zero requests) |
| `overrideSubscriptionPrice` | `getSubscription(id, fields=plan)` | subscription id; settled when `planOverridden` and price equals the target | the `settle` closure in `LivePaypal.overrideSubscriptionPrice` (called from `#settleUnknown`) | "patch lost response: ..." (three tests); never-sent: "never-sent failure (credential refused)" and "(value the SDK refuses to encode)" |
| `updatePlanPrice` | `getBillingPlan(id)` | plan id; settled when the regular cycle price equals the target | the `settle` closure in `LivePaypal.updatePlanPrice` | "plan price lost response: ..."; never-sent as above |
| `createSubscription` | `listSubscriptions({ planIds: planId })`, matched on `customId` | `customId` (set by us, includes the label) | `LivePaypal.#findSubscription` | "createSubscription lost response" |

Re-read found / matches: settle from what PayPal holds and return success. Not found, mismatch, or the re-read itself fails: throw `PaypalError('OUTCOME_UNKNOWN', ..., 502)` with a message saying PayPal may have applied the write. Never "failed", never "retry".

## CROSS-OPERATION INVARIANTS

| Invariant | Where the legal set comes from | Enforced where | The test that proves it |
| --- | --- | --- | --- |
| A price write may only name subscriptions and plans that belong to the bundle being run | the bundle record (`bundle.subscriptions[].subId`, `bundle.plans`), read in full by `loadSnapshot` before the run | `executePlan` -> `assertStepsInBundle`, before the first write and so before any claim | `test/liveSdk.test.js` "a step outside the bundle is rejected and no write is made" |

## WHEN THE API SAYS NO

One mapping, applied to every SDK call by `toPaypalError` in `server/paypal/sdkErrors.js`. The app's central `errorHandler` returns `err.status` and `err.message` of the resulting `PaypalError`.

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` | the API's reason text (`message` plus `details[].description` when present) from the declared error body | `test/liveSdk.test.js` "a 422 reason reaches the caller" (patch) and the same for createPlan |
| 401 / 403 | 502 | fixed: "PayPal rejected this app's credentials." | "401 becomes 502 with a fixed message" |
| 429 | 503 | fixed: "PayPal is rate limiting this app. Try again shortly." | "429 becomes 503" |
| 5xx on a read | 502 | fixed: "PayPal had an error." | "429 becomes 503 and 500 becomes 502" |
| 5xx on a write | per UNKNOWN OUTCOMES (a 5xx may have been applied, so the write is settled by a re-read) | unknown, never "failed" | "a 5xx on a write is a possible write" |
| `decode` on a 2xx | 502 | fixed: "PayPal answered but the reply could not be read." (outcome unknown on a write) | "unreadable success body" |
| `decode` on a declared error status | the same 4xx / 502 for 5xx | fixed "PayPal rejected the request." | covered with the 422 row |
| no response, on a write | per UNKNOWN OUTCOMES | unknown, never "failed" | lost-response tests |
| no response, on a read | 502 | fixed: "PayPal could not be reached." | "read connection failure" |
| `auth` | 502 | fixed credentials message; the underlying token error stays on `cause` | "bad credentials" |
| `encode` | 500 | not shown (integration defect) | "encode failure sends nothing" |

The reason is logged only through the central handler's stderr path for 500; 4xx reasons are returned in the response body. No SDK `message` (it names method and URL) is put on the wire.

## Configuration and resilience decisions

| Topic | Decision |
| --- | --- |
| Client lifetime | one `PaypalClient` per `LivePaypal`, built in the constructor; `createPort()` builds one `LivePaypal` per process |
| Credentials | `oauth2: { clientId, clientSecret }`; constructor throws naming the missing key (no value echoed) when either is blank |
| Retry | defaults stand for reads (3 retries on GET). `retry.timeout = 20000` ms per attempt (the old code used 20 s for the whole call). Writes use the default method gate (POST/PATCH sent once); no write is added to `httpMethodsToRetry`. No second retry layer anywhere |
| Logging | `logging: { level: 'off' }` set explicitly so `PAYPAL_CLIENT_LOG` cannot turn logging on from outside; no request body logging; no per-call level |
| Pagination / streaming | the SDK has none. `listSubscriptions` is one call with `pageSize` 100 (a bundle has 12 members); `listBillingPlans` for the UNKNOWN OUTCOMES re-read walks pages up to a fixed bound. `loadSnapshot` already falls back to reading each member by id if the list call is refused (V5) |
| Hooks / middleware | none exist, none built. `ClientOptions.fetch` is used only by tests |
| `Error` import | the SDK's `PaypalError` base is imported as `SdkError`; the app's own `PaypalError` (errors.js) keeps its name. The SDK model type named `Error` is not imported |
| Module format | one dialect (ESM) in this process, so `instanceof` on SDK errors is reliable; narrowing still uses `err.kind` |

## Test plan (`test/liveSdk.test.js`, fake `fetch`, no network)

Token request is answered first (OAuth2 lazy token); every test client uses `retry: { maxRetries: 0 }` except the one about reads.

- (`test/liveSdk.test.js`, `test/liveSdkErrors.test.js`) request shape of each of the eight operations (method, path, query, headers, body, and "no key we did not set")
- claim exists inside the fake fetch when the write request leaves (read from the claim store inside `fetch`)
- duplicate claim: two concurrent identical writes reach PayPal once; the second gets the winner's result
- claim released after a 4xx refusal; a later attempt reaches PayPal
- lost response (connection error) on each write: the re-read request is made; settled when PayPal holds the change; `OUTCOME_UNKNOWN` when it does not
- never-sent failure (auth refusal, encode failure) on a write: no re-read request
- error mapping table above
- decode failure on a 2xx and a truncated 2xx (missing `id`)
- kept-on-REST: `createProduct` and `verifyWebhook` through an injected fetch
- invariant: step outside the bundle rejected, adapter never called

## Assumptions and Blockers

- Blocker: none.
- Minor assumption: the SDK has no compile step in this repo, so types cannot be checked by `tsc`. Mitigation: names taken from the map and model files; fake-fetch tests exercise the real request-building and decoding code of the SDK, which rejects a wrong field name with `EncodeError` or `DecodeError`.
- Minor assumption: `listSubscriptions` accepts `page_size=100`. The map does not state a maximum. V5 in VERIFY.md covers it and `loadSnapshot` has a fallback.
- Minor assumption: the old `paymentPreferences` values (failure threshold 3, continue on setup fee failure) are no longer sent; provider defaults apply. Called out in VERIFY.md as part of V1 so a changed seeding behaviour is noticed.

## REQUIRED READING

- MUST load `typescript-error-handling` (done): the `err.kind` ladder, four throwables outside the family, 4xx reasons, DecodeError on success is unknown.
- MUST load `typescript-client-initialization` (done): long-lived client, credential check before construction, explicit host.
- MUST load `typescript-calling-endpoints` (done): flat channel-blind request, defaults are sent, `RequestParams` spelling, `undefined` operations.
- MUST load `typescript-models` (done): required vs optional, wire spellings inside free records, open enums.
- MUST load `typescript-authentication` (done): lazy token, `AuthError` never sent, missing credentials stop the app.
- MUST load `typescript-configuration-resilience` (done): retry gate, per-attempt timeout, logging off, no second retry layer.
- MUST load `typescript-testing` (done): fake `fetch`, token request first, wire-shape bodies, `maxRetries: 0`, assert the outgoing request.
