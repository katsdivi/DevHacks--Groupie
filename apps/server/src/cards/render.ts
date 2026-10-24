import { chromium, type Browser, type BrowserContext } from 'playwright';

/** Matches the body padding in the card templates so the card never touches the viewport edge. */
const PAGE_PADDING = 40;
const VIEWPORT = { width: 1080 + PAGE_PADDING * 2, height: 800 };

type Renderer = { browser: Browser; context: BrowserContext };

let current: Promise<Renderer> | null = null;

async function launch(): Promise<Renderer> {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  browser.on('disconnected', () => {
    current = null;
  });
  return { browser, context };
}

async function getRenderer(): Promise<Renderer> {
  if (current) {
    const r = await current.catch(() => null);
    if (r && r.browser.isConnected()) return r;
    current = null;
  }
  // Shared promise so concurrent first calls launch only one browser.
  current ??= launch();
  current.catch(() => {
    current = null;
  });
  return current;
}

/** Renders a full HTML document to PNG, screenshotting the element matching `selector` (default '.card'). Reuses one long-lived Chromium browser and context; pages are created per render and closed after. */
export async function renderPng(html: string, selector = '.card'): Promise<Buffer> {
  const { context } = await getRenderer();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return await page.locator(selector).first().screenshot({ type: 'png', omitBackground: false, animations: 'disabled' });
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeRenderer(): Promise<void> {
  const pending = current;
  current = null;
  if (!pending) return;
  const r = await pending.catch(() => null);
  await r?.browser.close().catch(() => {});
}
