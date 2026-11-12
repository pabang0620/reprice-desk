// PayPal wallet buyer approval for a sandbox subscription (V2). It is NOT run by the build or the tests.
// Run it only through scripts/seedBundles.js or scripts/sandboxChecks.js after you approve the run (see VERIFY.md).
// Playwright is not a dependency of the app. Install it yourself: npm i -D playwright && npx playwright install chromium
// The selectors below follow the PayPal login and consent pages seen in the dispute experiment. If PayPal changed
// them, adjust here and record what changed in docs/sandbox-checks.md.
export async function createBrowserApprover({ email, password, headless = true }) {
  if (!email || !password) throw new Error('Set SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD (a sandbox personal account).')
  let chromium
  try {
    ({ chromium } = await import('playwright'))
  } catch {
    throw new Error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium')
  }
  const browser = await chromium.launch({ headless, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  return {
    async approve(approveUrl, label) {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        await page.goto(approveUrl, { waitUntil: 'domcontentloaded' })
        await page.fill('#email', email)
        const next = page.locator('#btnNext')
        if (await next.count()) await next.click()
        await page.fill('#password', password)
        await page.click('#btnLogin')
        const consent = page.locator('[data-id="payment-submit-btn"]:visible, #consentButton:visible, button:visible:has-text("Agree"), button:visible:has-text("Subscribe"), button:visible:has-text("Continue"), [role="button"]:visible:has-text("Agree"), a:visible:has-text("Agree & Subscribe"), input[type="submit"]:visible').first()
        for (let step = 0; step < 4; step += 1) {
          await consent.waitFor({ timeout: 45000 })
          await consent.click()
          const left = await page.waitForURL((url) => !url.hostname.includes('paypal.com'), { timeout: 15000 }).then(() => true, () => false)
          if (left) break
        }
      } catch (err) {
        if (process.env.APPROVE_DEBUG_DIR) await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => /Agree/.test(e.textContent) && e.children.length === 0).map((e) => e.outerHTML + ' <- ' + e.parentElement.outerHTML.slice(0, 200)).join('\n')).then((h) => console.error('DOMDBG', h)).catch(() => {})
        if (process.env.APPROVE_DEBUG_DIR) await page.screenshot({ path: `${process.env.APPROVE_DEBUG_DIR}/${label}.png` }).catch(() => {})
        throw new Error(`Buyer approval failed for ${label}: ${err.message}`)
      } finally {
        await context.close()
      }
    },
    close: () => browser.close(),
  }
}
