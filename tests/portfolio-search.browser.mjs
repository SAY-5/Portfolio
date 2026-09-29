import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const executablePath = process.env.CHROME_PATH || (
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome'
);
let server;
let browser;
let origin;

before(async () => {
  assert.ok(existsSync(executablePath), `Chrome is required at ${executablePath}; set CHROME_PATH to an existing binary`);
  server = await preview({
    configFile: false,
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  // launch() creates its own temporary profile; never connect to a personal browser.
  browser = await chromium.launch({ executablePath, headless: true });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    if (server) await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
  }
});

async function withPage(width, run) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await run(page);
    assert.deepEqual(errors, [], 'page execution must not raise errors');
  } finally {
    await context.close();
  }
}

test('repository-name search survives a shared URL and reload', async () => {
  await withPage(1440, async (page) => {
    await page.goto(`${origin}/work?q=%20%20SCANGUARD%20%20`);
    await page.getByRole('searchbox', { name: 'Search projects' }).waitFor();
    assert.equal(await page.locator('.rows a[href="/p/scanguard"]').count(), 1, 'repository name must match even when the display title differs');
    assert.equal(await page.locator('.rows .row').count(), 1);
    await page.reload();
    await page.getByRole('searchbox', { name: 'Search projects' }).waitFor();
    assert.equal(await page.locator('.rows a[href="/p/scanguard"]').count(), 1);
    assert.equal(await page.getByRole('searchbox', { name: 'Search projects' }).inputValue(), '  SCANGUARD  ');
  });
});

test('query is AND-combined with category and language; empty state can recover', async () => {
  await withPage(1440, async (page) => {
    const params = new URLSearchParams({ q: 'declarative checklist', c: 'Instrumentation and Test', l: 'Go', sort: 'name' });
    await page.goto(`${origin}/work?${params}`);
    await page.getByRole('searchbox', { name: 'Search projects' }).waitFor();
    assert.equal(await page.locator('.rows a[href="/p/scanguard"]').count(), 1);
    params.set('l', 'Python');
    await page.goto(`${origin}/work?${params}`);
    await page.getByText('Nothing matches that.', { exact: true }).waitFor();
    assert.equal(await page.locator('.rows .row').count(), 0);
    assert.match(await page.locator('.work__status').innerText(), /^0 of \d+/);
    await page.getByRole('button', { name: 'clear the filters', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/work' && url.search === '');
    // The router can replace the URL before React commits the recovered rows.
    await page.waitForFunction(() => document.querySelectorAll('.rows .row').length > 1, undefined, { timeout: 5000 });
    assert.ok(await page.locator('.rows .row').count() > 1);
  });
});

for (const width of [1440, 390]) {
  test(`query-only clear preserves filters, sort and focus at ${width}px`, async () => {
    await withPage(width, async (page) => {
      const params = new URLSearchParams({ q: 'preflight', c: 'Instrumentation and Test', l: 'Go', sort: 'name' });
      await page.goto(`${origin}/work?${params}`);
      const input = page.getByRole('searchbox', { name: 'Search projects' });
      await input.waitFor();
      const clear = page.getByRole('button', { name: 'Clear search', exact: true });
      assert.equal(await clear.count(), 1, 'a separate query-only clear button must be available');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'nonempty search must not overflow horizontally');
      const clearBox = await clear.boundingBox();
      assert.ok(clearBox.x >= 0 && clearBox.x + clearBox.width <= width, 'clear search must remain inside the viewport');
      await input.focus();
      await page.keyboard.press('Tab');
      assert.equal(await clear.evaluate((element) => element === document.activeElement), true);
      assert.notEqual(await clear.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
      assert.ok((await clear.boundingBox()).height >= 44, 'clear search must have a usable touch target');
      await page.keyboard.press('Enter');
      await page.waitForURL((url) => !url.searchParams.has('q'));
      await page.waitForFunction(() => document.querySelector('#project-search')?.value === '');
      const actual = new URL(page.url()).searchParams;
      assert.equal(actual.get('c'), 'Instrumentation and Test');
      assert.equal(actual.get('l'), 'Go');
      assert.equal(actual.get('sort'), 'name');
      assert.equal(await input.inputValue(), '');
      assert.equal(await input.evaluate((element) => element === document.activeElement), true);
      assert.equal(await clear.count(), 0);
      assert.ok(await page.locator('.rows .row').count() > 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Work must not overflow horizontally');
      if (process.env.SCREENSHOTS_DIR) {
        await input.fill('preflight');
        await page.waitForURL((url) => url.searchParams.get('q') === 'preflight');
        await mkdir(process.env.SCREENSHOTS_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.SCREENSHOTS_DIR, `work-search-${width}.png`), fullPage: true });
      }
    });
  });
}

test('query edits preserve other filters and the query can be whitespace-only', async () => {
  await withPage(1440, async (page) => {
    const params = new URLSearchParams({ c: 'Instrumentation and Test', l: 'Go', sort: 'name' });
    await page.goto(`${origin}/work?${params}`);
    const input = page.getByRole('searchbox', { name: 'Search projects' });
    await input.waitFor();
    const totalInFilters = await page.locator('.rows .row').count();
    await input.fill('C++');
    await page.waitForURL((url) => url.searchParams.get('q') === 'C++');
    assert.equal(new URL(page.url()).searchParams.get('c'), 'Instrumentation and Test');
    assert.equal(new URL(page.url()).searchParams.get('l'), 'Go');
    assert.equal(new URL(page.url()).searchParams.get('sort'), 'name');
    await input.fill('   ');
    await page.waitForURL((url) => url.searchParams.get('q') === '   ');
    await page.waitForFunction((count) => document.querySelectorAll('.rows .row').length === count, totalInFilters);
    assert.equal(await page.locator('.rows .row').count(), totalInFilters);
  });
});

test('existing detail pages retain their showcase destination', async () => {
  await withPage(1440, async (page) => {
    await page.goto(`${origin}/p/scanguard`);
    await page.getByRole('link', { name: 'Open the app', exact: false }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open the app', exact: false }).getAttribute('href'), 'https://showcases-lime.vercel.app/scanguard');
    assert.equal(await page.getByRole('link', { name: 'Standalone app', exact: false }).getAttribute('href'), 'https://showcases-lime.vercel.app/scanguard');
  });
});

test('RankFault is searchable and both detail links use its verified replay demo', async () => {
  await withPage(1440, async (page) => {
    await page.goto(`${origin}/work?q=rankfault`);
    await page.getByRole('searchbox', { name: 'Search projects' }).waitFor();
    assert.equal(await page.locator('.rows a[href="/p/rankfault"]').count(), 1);
    await page.locator('.rows a[href="/p/rankfault"]').click();
    await page.getByRole('heading', { name: 'RankFault', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open the app', exact: false }).getAttribute('href'), 'https://say5-rankfault.vercel.app/');
    assert.equal(await page.getByRole('link', { name: 'Standalone app', exact: false }).getAttribute('href'), 'https://say5-rankfault.vercel.app/');
    assert.match(await page.locator('main').innerText(), /114 retained CPU\/Gloo runs/);
    assert.match(await page.locator('main').innerText(), /not a live faulting cluster/);
  });
});

test('KernelCheck is searchable and both detail links use its verified CPU-model demo', async () => {
  await withPage(390, async (page) => {
    await page.goto(`${origin}/work?q=kernelcheck`);
    await page.getByRole('searchbox', { name: 'Search projects' }).waitFor();
    assert.equal(await page.locator('.rows a[href="/p/kernelcheck"]').count(), 1);
    await page.locator('.rows a[href="/p/kernelcheck"]').click();
    await page.getByRole('heading', { name: 'KernelCheck', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open the app', exact: false }).getAttribute('href'), 'https://say5-kernelcheck.vercel.app/');
    assert.equal(await page.getByRole('link', { name: 'Standalone app', exact: false }).getAttribute('href'), 'https://say5-kernelcheck.vercel.app/');
    assert.match(await page.locator('main').innerText(), /six CUDA kernels/);
    assert.match(await page.locator('main').innerText(), /does not execute GPU kernels/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  });
});
