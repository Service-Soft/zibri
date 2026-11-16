import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Page } from 'playwright';
import { PageBrowser, startPageBrowser, StartedTestServer } from 'zibri-testing';

import { buildStylesheet } from '../../__testing__/build-stylesheet.function';
import { startDocsSite } from '../../__testing__/start-docs-site.function';

const TIMEOUT: number = 30000;

/**
 * Where a code span linking an export sits on its line, against the text right after it.
 */
type LineOffsets = {
    // how far the middle of the code is below the middle of the text, in pixels
    code: number,
    // how far the middle of the badge is below the middle of the text, in pixels
    badge: number
};

describe('a code span naming an export, in a browser', () => {
    let server: StartedTestServer;
    let browser: PageBrowser;
    let page: Page;

    beforeAll(async () => {
        const stylesheet: string = buildStylesheet();
        server = await startDocsSite();
        browser = await startPageBrowser();
        page = await browser.open(`${await server.start()}/zibri/auth/passkeys/`, async opened => {
            await opened.route('**/zibri/assets/style.css', route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
        });
        page.setDefaultTimeout(10000);
        await page.setViewportSize({ width: 1440, height: 1000 });
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    it('sits on the line of the text around it, its badge too', async () => {
        // the link of `@Auth.require2fa` at the end of the intro, and the full stop after it on its line
        const offsets: LineOffsets = await page.locator('#content p a[href="/zibri/api/Auth/#require2fa"]').evaluate(link => {
            const range: Range = document.createRange();
            range.selectNodeContents(link.nextSibling ?? link);
            const text: DOMRect = range.getBoundingClientRect();
            const middle: (rect: DOMRect) => number = rect => rect.top + (rect.height / 2);
            const code: DOMRect = link.querySelector('code')?.getBoundingClientRect() ?? text;
            const badge: DOMRect = link.firstElementChild?.getBoundingClientRect() ?? text;
            return { code: middle(code) - middle(text), badge: middle(badge) - middle(text) };
        });

        expect(Math.abs(offsets.code)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(offsets.badge)).toBeLessThanOrEqual(1.5);
    }, TIMEOUT);
});