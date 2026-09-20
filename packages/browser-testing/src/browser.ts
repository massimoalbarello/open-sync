import { chromium } from 'playwright';
import { enableVirtualPasskey } from './auth';
export async function virtualPasskeyBrowser(input: { headless: boolean }) {
  const browser = await chromium.launch({
    headless: input.headless,
    handleSIGINT: false,
    handleSIGTERM: false,
  });
  try {
    const context = await browser.newContext({
      viewport: input.headless ? { width: 1280, height: 720 } : null,
    });
    const page = await context.newPage();
    await enableVirtualPasskey(page);
    return { page, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
