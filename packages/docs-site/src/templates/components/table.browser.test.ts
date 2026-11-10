import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Locator, Page } from 'playwright';
import { PageBrowser, startPageBrowser, StartedTestServer } from 'zibri-testing';

import { buildStylesheet } from '../../__testing__/build-stylesheet.function';
import { startDocsSite } from '../../__testing__/start-docs-site.function';

const TIMEOUT: number = 30000;

type Box = {
    x: number,
    width: number
};

describe('a table of a page, in a browser', () => {
    let server: StartedTestServer;
    let browser: PageBrowser;
    let page: Page;
    let origin: string;

    /**
     * Opens a page of the documentation.
     * @param path - Its path below `/zibri/`, such as `data/data-source`.
     */
    async function open(path: string): Promise<void> {
        await page.goto(`${origin}/zibri/${path}/`);
    }

    beforeAll(async () => {
        const stylesheet: string = buildStylesheet();
        server = await startDocsSite();
        origin = await server.start();
        browser = await startPageBrowser();
        page = await browser.open(`${origin}/zibri/data/data-source/`, async opened => {
            await opened.route('**/zibri/assets/style.css', route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
        });
        page.setDefaultTimeout(10000);
        await page.setViewportSize({ width: 1440, height: 1000 });
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    it('shows the first rows of a long table of key exports, and all of them in the page', async () => {
        await open('data/data-source');

        expect(await page.locator('#key-exports-table tbody tr:visible').count()).toBe(8);
        expect(await page.locator('#key-exports-table tbody tr').count()).toBe(110);
        expect(await page.locator('#key-exports-toggle').textContent()).toBe('Show all 110 exports');
    }, TIMEOUT);

    it('shows all rows on a click, and the first again on another', async () => {
        await open('data/data-source');
        await page.locator('#key-exports-toggle').click();

        expect(await page.locator('#key-exports-table tbody tr:visible').count()).toBe(110);
        expect(await page.locator('#key-exports-toggle').textContent()).toBe('Show the first 8');

        await page.locator('#key-exports-toggle').click();

        expect(await page.locator('#key-exports-table tbody tr:visible').count()).toBe(8);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('shows a table of key exports of 12 rows whole', async () => {
        await open('auth/api-keys');

        expect(await page.locator('#key-exports-table tbody tr:visible').count()).toBe(12);
        expect(await page.locator('#key-exports-toggle').count()).toBe(0);
    }, TIMEOUT);

    it('shows a long table under another heading whole', async () => {
        await open('application/configuration');

        const rows: number = await page.locator('#content tbody tr').count();

        expect(rows).toBeGreaterThan(46);
        expect(await page.locator('#content tbody tr:visible').count()).toBe(rows);
        expect(await page.locator('#key-exports-toggle').count()).toBe(0);
    }, TIMEOUT);

    it('stacks each row as a card on a narrow screen, a cell under the title of its column', async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await open('data/data-source');
        const purpose: Locator = page.locator('#key-exports-table tbody tr').first()
            .locator('td')
            .nth(2);
        const cell: Box | null = await purpose.boundingBox();
        const title: string | null = await purpose.locator('span').first()
            .textContent();
        const shown: number = await page.locator('#key-exports-table tbody tr:visible').count();
        await page.setViewportSize({ width: 1440, height: 1000 });

        expect((cell?.x ?? 0) + (cell?.width ?? 0)).toBeLessThanOrEqual(390);
        expect(title).toBe('Purpose');
        expect(shown).toBe(8);
    }, TIMEOUT);

    it('shows the titles of the columns only in the head on a wide screen', async () => {
        await open('data/data-source');

        expect(await page.locator('#key-exports-table tbody tr').first()
            .locator('td')
            .nth(2)
            .locator('span')
            .first()
            .isVisible()).toBe(false);
    }, TIMEOUT);

    it('tells a screen reader whether the rows are shown', async () => {
        await open('data/data-source');
        const toggle: string | null = await page.getByRole('button', { name: 'Show all 110 exports', expanded: false }).getAttribute('id');
        await page.locator('#key-exports-toggle').click();

        expect(toggle).toBe('key-exports-toggle');
        expect(await page.locator('#key-exports-toggle').getAttribute('aria-expanded')).toBe('true');
        expect(await page.locator('#key-exports-toggle').getAttribute('aria-controls')).toBe('key-exports-table');
    }, TIMEOUT);
});