import type { Browser, Page } from 'playwright';

import { PageBrowserProxy } from './page-browser-options.model';
import type { TestBrowser } from '../test-browser.model';

/**
 * A real Chromium that opens the pages of a started test server, so what runs in the browser is
 * tested under the application's own headers, its Content Security Policy included.
 *
 * Not the {@link TestBrowser}, which sends requests and keeps cookies but runs no page.
 */
export class PageBrowser {
    private readonly errors: WeakMap<Page, string[]> = new WeakMap();

    constructor(
        private readonly browser: Browser,
        /**
         * The code of each vendor script, by the file name a page loads it under.
         */
        private readonly vendorScripts: Map<string, string>,
        private readonly proxy: PageBrowserProxy | undefined
    ) {}

    /**
     * Opens a url in a page of its own, with cookies of its own.
     * @param url - The url, such as where the test server listens and a path.
     * @param beforeLoad - Runs on the page before it loads, such as to stub a request with `page.route`.
     * A route added there or later takes precedence over the vendor scripts this browser serves.
     * @returns The page, once it has loaded.
     */
    async open(url: string, beforeLoad?: (page: Page) => Promise<void>): Promise<Page> {
        const page: Page = await this.browser.newPage();
        const errors: string[] = [];
        this.errors.set(page, errors);
        page.on('pageerror', error => errors.push(`${error.name}: ${error.message}`));
        // Chromium reports a CSP violation as a console error, and only there. The wording around the name
        // of the policy changes between versions ("Refused to load ..." became "Loading ... violates ...")
        page.on('console', message => {
            if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
                errors.push(message.text());
            }
        });
        if (this.proxy != undefined) {
            const { baseUrl, appUrl } = this.proxy;
            // fetched and handed back rather than continued to another url, which moves the page to that
            // url's origin. A redirect is the page's to follow, as it would be behind a real proxy
            await page.route(requested => requested.href.startsWith(baseUrl), async route => {
                const url: string = `${appUrl}${route.request().url()
                    .slice(baseUrl.length)}`;
                await route.fulfill({ response: await route.fetch({ url, maxRedirects: 0 }) });
            });
        }
        // added after the proxy, so they are asked first
        for (const [fileName, code] of this.vendorScripts) {
            await page.route(
                requested => requested.pathname.endsWith(`/assets/vendor/${fileName}`),
                route => route.fulfill({ contentType: 'text/javascript', body: code })
            );
        }
        await beforeLoad?.(page);
        await page.goto(url);
        return page;
    }

    /**
     * Finds what went wrong on a page so far: its uncaught errors and what its Content Security Policy
     * refused, in the order they happened.
     * @param page - A page this browser opened.
     * @returns The messages, empty when nothing went wrong.
     * @throws When this browser did not open the page.
     */
    findPageErrors(page: Page): string[] {
        const errors: string[] | undefined = this.errors.get(page);
        if (errors == undefined) {
            throw new Error('The page was not opened by this page browser.');
        }
        return [...errors];
    }

    /**
     * Closes the browser and every page it opened.
     */
    async close(): Promise<void> {
        await this.browser.close();
    }
}