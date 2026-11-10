import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Page } from 'playwright';
import { PageBrowser, startPageBrowser, StartedTestServer, startTestServer } from 'zibri-testing';

import { buildStylesheet } from '../../__testing__/build-stylesheet.function';
import { testApplicationOptions } from '../../__testing__/test-application-options';

const TIMEOUT: number = 30000;

type Box = {
    x: number,
    y: number,
    width: number,
    height: number
};

describe('a page of the documentation, in a browser', () => {
    const baseUrl: string = testApplicationOptions.baseUrl;
    let server: StartedTestServer;
    let browser: PageBrowser;
    let page: Page;

    /**
     * Where an element is drawn.
     * @param id - The id of the element.
     * @returns Its box, in pixels of the viewport.
     */
    async function resolveBox(id: string): Promise<Box> {
        const box: Box | null = await page.locator(`#${id}`).boundingBox();
        if (box === null) {
            throw new Error(`#${id} is not drawn.`);
        }
        return box;
    }

    beforeAll(async () => {
        const stylesheet: string = buildStylesheet();
        server = await startTestServer({ application: testApplicationOptions });
        browser = await startPageBrowser({ behindProxy: { baseUrl, appUrl: await server.start() } });
        page = await browser.open(`${baseUrl}/docs/guides/writing-a-page/`, async opened => {
            await opened.route('**/assets/style.css', route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
        });
        page.setDefaultTimeout(5000);
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    it('shows the pages beside the content and its sections beside it on a wide screen, the page marked', async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const pages: Box = await resolveBox('docs-sidebar');
        const content: Box = await resolveBox('docs-content');
        const sections: Box = await resolveBox('docs-on-this-page-column');

        expect(pages.x + pages.width).toBeLessThanOrEqual(content.x);
        expect(content.x + content.width).toBeLessThanOrEqual(sections.x);
        expect(await page.locator('#docs-sidebar [aria-current="page"]').textContent()).toBe('Writing a page');
        expect(await page.locator('#docs-pages-button').isVisible()).toBe(false);
        expect(await page.locator('#docs-on-this-page-button').isVisible()).toBe(false);
    }, TIMEOUT);

    it('leads a link naming another page by its file to the address of that page', async () => {
        expect(await page.locator('#docs-content a', { hasText: 'adding a page' }).getAttribute('href'))
            .toBe('/docs/#adding-a-page');
    }, TIMEOUT);

    it('keeps the bar with the search at the top while the page scrolls', async () => {
        await page.setViewportSize({ width: 1440, height: 400 });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const search: Box = await resolveBox('docs-search-input');
        await page.evaluate(() => window.scrollTo(0, 0));

        expect(search.y).toBeGreaterThanOrEqual(0);
        expect(search.y).toBeLessThan(56);
    }, TIMEOUT);

    it('opens the pages from the button of the bar as a drawer down the left edge, closed by Escape', async () => {
        await page.setViewportSize({ width: 800, height: 1000 });
        await page.locator('#docs-pages-button').click();
        const drawer: Box = await resolveBox('docs-pages-drawer');

        expect(drawer).toMatchObject({ x: 0, y: 0, height: 1000 });
        expect(await page.locator('#docs-pages-drawer [aria-current="page"]').textContent()).toBe('Writing a page');

        await page.keyboard.press('Escape');

        expect(await page.locator('#docs-pages-drawer').isVisible()).toBe(false);
    }, TIMEOUT);

    it('opens the sections from the button at the bottom right, and closes them when one is chosen', async () => {
        await page.setViewportSize({ width: 800, height: 1000 });
        await page.locator('#docs-on-this-page-button').click();
        const button: Box = await resolveBox('docs-on-this-page-button');
        const panel: Box = await resolveBox('docs-on-this-page-panel');

        expect(panel.y + panel.height).toBeLessThan(button.y);

        await page.locator('#docs-on-this-page-panel a[href="#linking-another-page"]').click();

        expect(await page.locator('#docs-on-this-page-panel').isVisible()).toBe(false);
        expect(new URL(page.url()).hash).toBe('#linking-another-page');
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('marks the section being read beside the page, following the scrolling', async () => {
        await page.setViewportSize({ width: 1440, height: 400 });
        const current: string = '#docs-on-this-page-column a[aria-current="location"]';
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('href') === '#linking-another-page', current);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('href') === '#showing-code-and-tables', current);

        expect(await page.locator(current).count()).toBe(1);
    }, TIMEOUT);

    it('copies the address of a section from the link beside its heading', async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
        await page.locator('#linking-another-page').hover();
        await page.locator('#link-to-linking-another-page').click();

        expect(await page.evaluate(async () => await navigator.clipboard.readText()))
            .toBe(`${baseUrl}/docs/guides/writing-a-page/#linking-another-page`);
        expect(new URL(page.url()).hash).toBe('#linking-another-page');
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('names the link beside a heading for a screen reader', async () => {
        expect(await page.locator('#linking-another-page').getByRole('link', { name: 'Copy the link to this section' })
            .getAttribute('id')).toBe('link-to-linking-another-page');
    }, TIMEOUT);

    it('names both buttons for a screen reader', async () => {
        await page.setViewportSize({ width: 800, height: 1000 });

        expect(await page.getByRole('button', { name: 'Pages' }).getAttribute('id')).toBe('docs-pages-button');
        expect(await page.getByRole('button', { name: 'On this page' }).getAttribute('id')).toBe('docs-on-this-page-button');
    }, TIMEOUT);
});