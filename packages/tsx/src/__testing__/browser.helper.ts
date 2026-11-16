import { Browser, Page } from 'playwright';

import { RenderEnvironment } from '../runtime/render-environment';
import { CompiledPage, renderPage } from '../runtime/render-page';

/**
 * A page opened in a real browser, and what went wrong on it.
 */
export type OpenedPage = {
    /**
     * The page.
     */
    page: Page,
    /**
     * Its uncaught errors and CSP violations so far, in the order they happened. It keeps filling while
     * the page runs.
     */
    errors: string[]
};

const PAGE_URL: string = 'https://zibri-tsx.test/';
const NONCE: string = 'zibri-tsx-test';
// zibri's default policy, with the nonce its router adds to script-src. zibri-testing's PageBrowser opens
// real routes and gets the real header, but this package builds before zibri and cannot boot an
// application, so the header is written down here
const CONTENT_SECURITY_POLICY: string = [
    'base-uri \'self\'',
    'default-src \'self\'',
    'form-action \'self\'',
    'frame-ancestors \'self\'',
    'object-src \'none\'',
    `script-src 'self' 'nonce-${NONCE}'`,
    'script-src-attr \'none\''
].join('; ');

/**
 * Renders a compiled page and opens it in the browser, served under the policy zibri sends.
 * @param browser - The browser, launched by the test.
 * @param compiled - The page.
 * @param props - The props to render it with.
 * @param environment - Where it is rendered, `development` as in every test unless the test is about
 * `production`.
 * @param beforeLoad - Runs on the page before it loads, such as to add a script that watches it from the start.
 * @returns The opened page, once it has loaded.
 */
export async function openPage(
    browser: Browser,
    compiled: CompiledPage,
    props: Record<string, unknown> = {},
    environment: RenderEnvironment = 'development',
    beforeLoad?: (page: Page) => Promise<void>
): Promise<OpenedPage> {
    const html: string = renderPage(compiled, props, { environment, nonce: NONCE });
    const page: Page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`${error.name}: ${error.message}`));
    // Chromium reports a CSP violation as a console error, and only there. The wording around the name of
    // the policy changes between versions ("Refused to load ..." became "Loading ... violates ...")
    page.on('console', message => {
        if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
            errors.push(message.text());
        }
    });
    await page.route('**/*', async route => {
        if (route.request().url() === PAGE_URL) {
            // the charset zibri sends with a page, without which the browser reads it as windows-1252
            await route.fulfill({
                contentType: 'text/html; charset=utf-8',
                headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
                body: html
            });
            return;
        }
        await route.abort();
    });
    await beforeLoad?.(page);
    await page.goto(PAGE_URL);
    return { page, errors };
}