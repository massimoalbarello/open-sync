const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const HTTP_UNAUTHORIZED = 401;
const HTTP_OK = 200;

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { virtualPasskeyBrowser } from '@repo/browser-testing/browser';
import { startIsolatedApp } from './isolated-app';

const app = await startIsolatedApp();
let browser: Awaited<ReturnType<typeof virtualPasskeyBrowser>> | undefined;
try {
  browser = await virtualPasskeyBrowser({ headless: true });
  const { page } = browser;
  page.on('pageerror', (error) => console.error(error));
  await page.goto(app.origin);
  await page.getByRole('button', { name: 'Create account with a passkey' }).click();
  const field = page.getByLabel('What’s on your mind?');
  await field.waitFor();
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Write something' }).waitFor();
  await field.fill('My first private note');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByText('My first private note', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('My first private note', { exact: true }).waitFor();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/notebook-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/notebook-mobile.png', fullPage: true });
  const before = await page.request.get(`${app.origin}/api/notes`);
  const notes = (await before.json()) as { id: string }[];
  assert.equal(notes.length, 1);
  const noteId = notes[0]!.id;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).waitFor();
  assert.equal((await page.request.get(`${app.origin}/api/notes`)).status(), HTTP_UNAUTHORIZED);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.getByText('My first private note', { exact: true }).waitFor();
  // A separate authenticator and cookie jar establish a genuinely different account.
  const second = await virtualPasskeyBrowser({ headless: true });
  try {
    await second.page.goto(app.origin);
    await second.page.getByRole('button', { name: 'Create account with a passkey' }).click();
    await second.page.getByText('A fresh page. Write your first note above.').waitFor();
    const denied = await second.page.request.delete(`${app.origin}/api/notes/${noteId}`, {
      headers: { origin: app.origin },
    });
    assert.equal(denied.status(), HTTP_NOT_FOUND);
    assert.equal((await page.request.get(`${app.origin}/api/notes`)).status(), HTTP_OK);
  } finally {
    await second.close();
  }
  const csrf = await page.request.post(`${app.origin}/api/notes`, {
    headers: { origin: 'https://untrusted.invalid' },
    data: { body: 'Injected' },
  });
  assert.equal(csrf.status(), HTTP_FORBIDDEN);
  await page.getByRole('button', { name: 'Delete note: My first private note' }).click();
  await page.getByText('A fresh page. Write your first note above.').waitFor();
  console.log(
    'Browser journey passed: registration, validation, persistence, sign-out, sign-in, owner isolation, CSRF, deletion.',
  );
} catch (error) {
  console.error(await browser?.page.locator('body').innerText());
  throw error;
} finally {
  await browser?.close();
  await app.stop();
}
