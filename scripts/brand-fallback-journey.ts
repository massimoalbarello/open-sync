import assert from 'node:assert/strict';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';

export async function brandFallbackJourney({ origin }: { origin: string }) {
  const browser = await virtualPasskeyBrowser({ headless: true });
  try {
    const { page } = browser;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(origin);
    await page.locator('[data-light-state="unavailable"]').waitFor();
    const register = page.getByRole('button', { name: 'Create account' });
    assert.ok(await register.isEnabled());
    assert.equal(await page.locator('[data-light-state] span').isVisible(), true);
    await page.screenshot({ path: 'artifacts/login-reduced-motion.png' });
    // A missing GPU must never prevent the real passkey flow from mounting.
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await page.locator('[data-light-state="unavailable"]').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await register.isEnabled());
    assert.equal(await page.locator('[data-light-state] span').isVisible(), true);
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'));
    await page.screenshot({ path: 'artifacts/login-mobile-fallback.png', fullPage: true });
  } finally {
    await browser.close();
  }
}
