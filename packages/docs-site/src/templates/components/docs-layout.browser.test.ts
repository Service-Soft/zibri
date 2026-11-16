import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Page } from 'playwright';
import { PageBrowser, startPageBrowser, StartedTestServer } from 'zibri-testing';

import { buildStylesheet } from '../../__testing__/build-stylesheet.function';
import { startDocsSite } from '../../__testing__/start-docs-site.function';

const TIMEOUT: number = 30000;

type Box = {
    x: number,
    y: number,
    width: number,
    height: number
};

describe('the layout of a page, in a browser', () => {
    let server: StartedTestServer;
    let browser: PageBrowser;
    let page: Page;
    let origin: string;

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
        server = await startDocsSite();
        browser = await startPageBrowser();
        origin = await server.start();
        page = await browser.open(`${origin}/zibri/application/configuration/`, async opened => {
            await opened.route('**/zibri/assets/style.css', route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
        });
        page.setDefaultTimeout(5000);
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    it('starts and ends the bar where the columns below it do', async () => {
        await page.setViewportSize({ width: 1920, height: 1000 });
        const home: Box = await resolveBox('home-link');
        const github: Box = await resolveBox('github-link');
        const pages: Box = await resolveBox('sidebar > nav');
        const sections: Box = await resolveBox('on-this-page-column > nav');

        expect(home.x).toBe(pages.x);
        expect(github.x + github.width).toBe(sections.x + sections.width);
    }, TIMEOUT);

    it('shows neither button where the columns have room', async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });

        expect(await page.locator('#pages-button').isVisible()).toBe(false);
        expect(await page.locator('#on-this-page-button').isVisible()).toBe(false);
    }, TIMEOUT);

    it('opens the pages from the button of the bar as a drawer down the left edge, closed by Escape', async () => {
        await page.setViewportSize({ width: 800, height: 1000 });
        await page.locator('#pages-button').click();
        const drawer: Box = await resolveBox('pages-drawer');

        expect(drawer).toMatchObject({ x: 0, y: 0, height: 1000 });
        expect(await page.locator('#pages-drawer [aria-current="page"]').textContent()).toBe('Configuring the framework');

        await page.keyboard.press('Escape');

        expect(await page.locator('#pages-drawer').isVisible()).toBe(false);
    }, TIMEOUT);

    it('opens the sections from the button at the bottom right, and closes them when one is chosen', async () => {
        await page.setViewportSize({ width: 800, height: 1000 });
        await page.locator('#on-this-page-button').click();
        const button: Box = await resolveBox('on-this-page-button');
        const panel: Box = await resolveBox('on-this-page-panel');

        expect(panel.y + panel.height).toBeLessThan(button.y);
        expect(panel.x + panel.width).toBe(button.x + button.width);

        await page.locator('#on-this-page-panel a[href="#replacing-a-service"]').click();

        expect(await page.locator('#on-this-page-panel').isVisible()).toBe(false);
        expect(new URL(page.url()).hash).toBe('#replacing-a-service');
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('marks the section being read beside the page, following the scrolling', async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const current: string = '#on-this-page-column a[aria-current="location"]';
        await page.evaluate(() => document.querySelector('#replacing-a-service')?.scrollIntoView());
        await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('href') === '#replacing-a-service', current);

        expect(await page.locator(current).count()).toBe(1);

        const first: string | null = await page.locator('#on-this-page-column a').first()
            .getAttribute('href');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(
            wanted => document.querySelector(wanted.selector)?.getAttribute('href') === wanted.href,
            { selector: current, href: first ?? '' }
        );

        expect(await page.locator(current).getAttribute('href')).toBe(first);
    }, TIMEOUT);

    it('moves the mark down the sections as the reader scrolls with the wheel', async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${origin}/zibri/data/data-source/`);
        const current: string = '#on-this-page-column a[aria-current="location"]';
        const marked: string[] = [];
        for (let step: number = 0; step < 6; step++) {
            await page.mouse.move(700, 500);
            await page.mouse.wheel(0, 1500);
            await page.waitForTimeout(200);
            marked.push(await page.locator(current).getAttribute('href') ?? '');
        }
        await page.goto(`${origin}/zibri/application/configuration/`);

        expect(new Set(marked).size).toBeGreaterThan(1);
    }, TIMEOUT);

    it('copies the address of a section from the link beside its heading', async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await page.locator('#replacing-a-service').hover();
        await page.locator('#link-to-replacing-a-service').click();

        expect(await page.evaluate(async () => await navigator.clipboard.readText()))
            .toBe(`${origin}/zibri/application/configuration/#replacing-a-service`);
        expect(new URL(page.url()).hash).toBe('#replacing-a-service');
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('names the link beside a heading for a screen reader', async () => {
        expect(await page.locator('#replacing-a-service').getByRole('link', { name: 'Copy the link to this section' })
            .getAttribute('id')).toBe('link-to-replacing-a-service');
    }, TIMEOUT);

    it('names both buttons for a screen reader', async () => {
        await page.setViewportSize({ width: 800, height: 1000 });

        expect(await page.getByRole('button', { name: 'Pages' }).getAttribute('id')).toBe('pages-button');
        expect(await page.getByRole('button', { name: 'On this page' }).getAttribute('id')).toBe('on-this-page-button');
    }, TIMEOUT);
});