import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Locator, Page } from 'playwright';
import { Controller, Get, HtmlResponse, Response, TsxUtilities } from 'zibri';
import { PageBrowser, startPageBrowser, StartedTestServer, startTestServer } from 'zibri-testing';

import { ReleaseNotesPage } from './release-notes-page';
import { buildStylesheet } from '../../__testing__/build-stylesheet.function';
import { testApplicationOptions } from '../../__testing__/test-application-options';

const TIMEOUT: number = 30000;

// no route of this application renders a page written in markdown. Orphan allowed, since other suites start a
// server without it
@Controller('/release-notes', { allowOrphan: true })
class ReleaseNotesController {
    @Response.html()
    @Get()
    read(): HtmlResponse {
        return HtmlResponse.fromString(TsxUtilities.renderPage(ReleaseNotesPage));
    }
}

describe('a page written in markdown, in a browser', () => {
    const baseUrl: string = testApplicationOptions.baseUrl;
    let server: StartedTestServer;
    let browser: PageBrowser;
    let page: Page;

    beforeAll(async () => {
        const stylesheet: string = buildStylesheet();
        server = await startTestServer({
            application: { ...testApplicationOptions, controllers: [...testApplicationOptions.controllers, ReleaseNotesController] }
        });
        browser = await startPageBrowser({ behindProxy: { baseUrl, appUrl: await server.start() } });
        page = await browser.open(`${baseUrl}/release-notes`, async opened => {
            await opened.route('**/assets/style.css', route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
        });
        page.setDefaultTimeout(5000);
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    it('renders its constructs with the components the providers of the application name', async () => {
        // the Heading and the Link of the project, with their own classes
        expect(await page.locator('#release-notes').evaluate(element => element.tagName)).toBe('H1');
        expect(await page.locator('#release-notes').getAttribute('class')).toContain('tracking-wider');
        expect(await page.locator('#release-notes-intro a').getAttribute('href')).toBe('/explorer');
        expect(await page.locator('#release-notes-intro a').getAttribute('class')).toContain('hover:text-secondary');
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('renders every construct with a component of the project', async () => {
        async function findClassOf(selector: string): Promise<string | null> {
            return await page.locator(`#release-notes-constructs ${selector}`).first()
                .getAttribute('class');
        }

        expect(await findClassOf('p')).toContain('leading-relaxed');
        expect(await findClassOf('em')).toContain('italic');
        expect(await findClassOf('strong')).toContain('font-semibold');
        expect(await findClassOf('del')).toContain('line-through');
        expect(await findClassOf('p > code')).toContain('bg-primary/50');
        expect(await findClassOf('blockquote')).toContain('border-secondary');
        expect(await findClassOf('ul')).toContain('list-disc');
        expect(await findClassOf('ol')).toContain('list-decimal');
        expect(await findClassOf('li')).toContain('my-1');
        expect(await findClassOf('li input')).toContain('accent-secondary');
        expect(await findClassOf('table')).toContain('border-collapse');
        expect(await findClassOf('thead')).toContain('bg-primary');
        expect(await findClassOf('tbody')).toContain('divide-y');
        expect(await findClassOf('thead tr')).toContain('font-semibold');
        expect(await findClassOf('tbody tr')).toContain('even:bg-primary/20');
        expect(await findClassOf('td')).toContain('text-left');
        expect(await findClassOf('td:last-child')).toContain('text-right');
        expect(await findClassOf('hr')).toContain('border-primary');
        expect(await findClassOf('img')).toContain('max-w-full');
    }, TIMEOUT);

    it('sizes a heading by its level', async () => {
        const titleSize: string = await page.locator('#release-notes').evaluate(element => getComputedStyle(element).fontSize);
        const sectionSize: string = await page.locator('#what-changed').evaluate(element => getComputedStyle(element).fontSize);

        expect(await page.locator('#what-changed').evaluate(element => element.tagName)).toBe('H2');
        // text-4xl and text-2xl
        expect(titleSize).toBe('36px');
        expect(sectionSize).toBe('24px');
    }, TIMEOUT);

    it('renders the components it imports, and reads its frontmatter', async () => {
        expect(await page.locator('#release-notes-card > div').getAttribute('class')).toContain('shadow-elevation');
        expect(await page.locator('#release-notes-card').textContent()).toContain('Shipped as Release notes.');
    }, TIMEOUT);

    it('colors the code of a code block with the classes of the stylesheet', async () => {
        const keyword: string = await page.locator('#release-notes-code .shiki-token-keyword').first()
            .evaluate(element => getComputedStyle(element).color);

        expect(await page.locator('#release-notes-code pre').getAttribute('class')).toContain('bg-dark-gray');
        expect(await page.locator('#release-notes-code code').textContent()).toBe('const version: string = \'3.1.0\';');
        // #c678dd
        expect(keyword).toBe('rgb(198, 120, 221)');
    }, TIMEOUT);

    it('stacks each row of a table as a card on a narrow screen, a cell under the title of its column', async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        const cell: Locator = page.locator('#release-notes-constructs tbody td').nth(1);
        const narrow: { title: string | null, align: string } = {
            title: await cell.locator('span').first()
                .textContent(),
            align: await cell.evaluate(element => getComputedStyle(element).textAlign)
        };
        await page.setViewportSize({ width: 1440, height: 1000 });

        expect(narrow).toEqual({ title: 'Constructs', align: 'left' });
        expect(await cell.locator('span').first()
            .isVisible()).toBe(false);
    }, TIMEOUT);
});