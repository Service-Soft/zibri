// cspell:ignore pasky hashng -- typos the search is to see through
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Page } from 'playwright';
import { PageBrowser, startPageBrowser, StartedTestServer } from 'zibri-testing';

import { buildStylesheet } from '../../__testing__/build-stylesheet.function';
import { startDocsSite } from '../../__testing__/start-docs-site.function';

const TIMEOUT: number = 30000;

describe('the search of the site, in a browser', () => {
    let server: StartedTestServer;
    let browser: PageBrowser;
    let page: Page;
    let origin: string;

    /**
     * Types into the search, and waits for what it finds.
     * @param query - What to type.
     * @returns The address of each result, the best first.
     */
    async function searchFor(query: string): Promise<string[]> {
        await page.locator('#search-input').fill('');
        await page.locator('#search-results').waitFor({ state: 'detached' });
        await page.locator('#search-input').fill(query);
        await page.locator('#search-results').waitFor();
        return await page.locator('#search-results a').evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''));
    }

    beforeAll(async () => {
        const stylesheet: string = buildStylesheet();
        server = await startDocsSite();
        origin = await server.start();
        browser = await startPageBrowser();
        page = await browser.open(`${origin}/zibri/application/configuration/`, async opened => {
            await opened.route('**/zibri/assets/style.css', route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
        });
        page.setDefaultTimeout(10000);
        await page.setViewportSize({ width: 1440, height: 1000 });
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    it('finds a page by its title despite a typo', async () => {
        expect((await searchFor('pasky'))[0]).toBe('/zibri/auth/passkeys/');
        // a typo of a word of a longer title, whose stem leaves its ending out
        expect((await searchFor('hashng'))[0]).toBe('/zibri/data/encryption-and-hashing/');
    }, TIMEOUT);

    it('finds a page by another form of a word of its title', async () => {
        expect((await searchFor('logs'))[0]).toBe('/zibri/operations/logging/');
    }, TIMEOUT);

    it('finds a page by the keywords of its frontmatter', async () => {
        expect(await searchFor('sign in')).toContain('/zibri/auth/auth/');
        expect(await searchFor('2fa')).toContain('/zibri/auth/two-factor/');
    }, TIMEOUT);

    it('finds a section of a page under its anchor, and an export of the API reference with its kind', async () => {
        expect(await searchFor('replacing a service')).toContain('/zibri/application/configuration/#replacing-a-service');
        expect((await searchFor('MarkdownService'))[0]).toBe('/zibri/api/MarkdownService/');
        expect(await page.locator('#search-results a').first()
            .textContent()).toContain('C');
    }, TIMEOUT);

    it('prefers a page to an export of the API reference that only shares its words', async () => {
        expect((await searchFor('cache'))[0]).toBe('/zibri/data/caching/');
    }, TIMEOUT);

    it('chooses a result with the arrow keys and Enter', async () => {
        const results: string[] = await searchFor('passkeys');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.waitForURL(url => url.pathname + url.hash === results[1]);

        expect(new URL(page.url()).pathname + new URL(page.url()).hash).toBe(results[1]);
    }, TIMEOUT);

    it('focuses the search on /, and closes its results on Escape and on a click outside', async () => {
        await page.locator('#content').click();
        await page.keyboard.press('/');

        expect(await page.evaluate(() => document.activeElement?.id)).toBe('search-input');

        await searchFor('cron');
        await page.keyboard.press('Escape');
        await page.locator('#search-results').waitFor({ state: 'detached' });
        await searchFor('cron');
        await page.locator('#content').click();
        await page.locator('#search-results').waitFor({ state: 'detached' });

        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('keeps the results on a narrow screen', async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await searchFor('passkeys');
        const results: { x: number, width: number } | null = await page.locator('#search-results').boundingBox();
        await page.setViewportSize({ width: 1440, height: 1000 });

        expect(results?.x).toBeGreaterThanOrEqual(0);
        expect((results?.x ?? 0) + (results?.width ?? 0)).toBeLessThanOrEqual(390);
    }, TIMEOUT);

    it('names the search for a screen reader', async () => {
        expect(await page.getByRole('searchbox', { name: 'Search the documentation' }).getAttribute('id')).toBe('search-input');
    }, TIMEOUT);
});