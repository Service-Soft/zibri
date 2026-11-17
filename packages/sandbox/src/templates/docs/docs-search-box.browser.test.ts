// cspell:ignore writng -- a typo the search is to see through
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Page } from 'playwright';
import { PageBrowser, startPageBrowser, StartedTestServer, startTestServer } from 'zibri-testing';

import { buildStylesheet } from '../../__testing__/build-stylesheet.function';
import { testApplicationOptions } from '../../__testing__/test-application-options';

const TIMEOUT: number = 30000;

describe('the search of the documentation, in a browser', () => {
    const baseUrl: string = testApplicationOptions.baseUrl;
    let server: StartedTestServer;
    let browser: PageBrowser;
    let page: Page;

    /**
     * Types into the search, and waits for what it finds.
     * @param query - What to type.
     * @returns The address of each result, the best first.
     */
    async function searchFor(query: string): Promise<string[]> {
        await page.locator('#docs-search-input').fill('');
        await page.locator('#docs-search-results').waitFor({ state: 'detached' });
        await page.locator('#docs-search-input').fill(query);
        await page.locator('#docs-search-results').waitFor();
        return await page.locator('#docs-search-results a').evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''));
    }

    beforeAll(async () => {
        const stylesheet: string = buildStylesheet();
        server = await startTestServer({ application: testApplicationOptions });
        browser = await startPageBrowser({ behindProxy: { baseUrl, appUrl: await server.start() } });
        page = await browser.open(`${baseUrl}/docs/`, async opened => {
            await opened.route('**/assets/style.css', route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
        });
        page.setDefaultTimeout(5000);
        await page.setViewportSize({ width: 1440, height: 1000 });
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    it('finds a page by its title despite a typo, and by another form of a word', async () => {
        expect((await searchFor('writng'))[0]).toBe('/docs/guides/writing-a-page/');
        expect((await searchFor('adds'))[0]).toBe('/docs/#adding-a-page');
    }, TIMEOUT);

    it('finds a page by the keywords of its frontmatter, and a section under its anchor', async () => {
        expect((await searchFor('markdown'))[0]).toBe('/docs/guides/writing-a-page/');
        expect(await searchFor('linking')).toContain('/docs/guides/writing-a-page/#linking-another-page');
    }, TIMEOUT);

    it('chooses a result with the arrow keys and Enter', async () => {
        const results: string[] = await searchFor('page');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.waitForURL(url => url.pathname + url.hash === results[1]);

        expect(new URL(page.url()).pathname + new URL(page.url()).hash).toBe(results[1]);
    }, TIMEOUT);

    it('focuses the search on /, and closes its results on Escape and on a click outside', async () => {
        await page.locator('#docs-content').click();
        await page.keyboard.press('/');

        expect(await page.evaluate(() => document.activeElement?.id)).toBe('docs-search-input');

        await searchFor('code');
        await page.keyboard.press('Escape');
        await page.locator('#docs-search-results').waitFor({ state: 'detached' });
        await searchFor('code');
        await page.locator('#docs-content').click();
        await page.locator('#docs-search-results').waitFor({ state: 'detached' });

        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('keeps the results on a narrow screen', async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await searchFor('page');
        const results: { x: number, width: number } | null = await page.locator('#docs-search-results').boundingBox();
        await page.setViewportSize({ width: 1440, height: 1000 });

        expect(results?.x).toBeGreaterThanOrEqual(0);
        expect((results?.x ?? 0) + (results?.width ?? 0)).toBeLessThanOrEqual(390);
    }, TIMEOUT);

    it('names the search for a screen reader', async () => {
        expect(await page.getByRole('searchbox', { name: 'Search the documentation' }).getAttribute('id')).toBe('docs-search-input');
    }, TIMEOUT);
});