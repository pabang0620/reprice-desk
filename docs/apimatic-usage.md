# APIMatic Context Plugin usage (V15)

Date: 2026-11-12

## Install command

```
npx context-plugins install paypal --targets claude
```

## Output of `claude plugin list`

```
Installed plugins:

  paypal@context-plugins
    Version: 0.4.1
    Scope: user
    Status: enabled
```

(Other installed plugins are left out; only the PayPal plugin was used for this app.)

## How the plugin was used (in order)

1. `typescript-integrate-paypal`: wrote the contract sheet `paypal-plan.md` before any code (signatures, write claims, unknown outcomes, error table).
2. `typescript-getting-started`, `typescript-calling-endpoints`, `typescript-models`: looked up SDK method names and argument shapes in the SDK map; wrote `server/paypal/livePaypal.js`.
3. `typescript-error-handling`, `typescript-testing`: one error mapping in `sdkErrors.js`; fake-`fetch` tests drive the real SDK (`test/liveSdk*.test.js`).
4. V17 (`scripts/sdkSmoke.js`), then V2 and V1 on the PayPal sandbox: the writes worked.
5. V5 found that the sandbox rejects `page_size=100` for `listSubscriptions`; the adapter now asks for 20.
