import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Page } from 'playwright';
import { inject, MetricsServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';
import { PageBrowser, startPageBrowser, StartedTestServer, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from '../../../__testing__/test-application-options';

const TIMEOUT: number = 30000;

describe('the metrics page, in a browser', () => {
    let server: StartedTestServer;
    let appUrl: string;
    let browser: PageBrowser;
    let page: Page;

    beforeAll(async () => {
        server = await startTestServer({ application: testApplicationOptions });
        appUrl = await server.start();
        browser = await startPageBrowser({ vendorPackages: ['chart.js'] });
    }, 60000);

    afterAll(async () => {
        await browser.close();
        await server.shutdown();
    }, TIMEOUT);

    async function open(): Promise<void> {
        page = await browser.open(`${appUrl}/metrics/dashboard`);
    }

    it('shows the overview first', async () => {
        await open();

        expect(await page.locator('#overview').isVisible()).toBe(true);
        expect(await page.locator('#caches').isVisible()).toBe(false);
        expect(await page.locator('#rate-limiters').isVisible()).toBe(false);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('switches to the tab that is clicked', async () => {
        await open();

        await page.locator('#button-caches').click();

        expect(await page.locator('#caches').isVisible()).toBe(true);
        expect(await page.locator('#overview').isVisible()).toBe(false);
        expect(await page.locator('#rate-limiters').isVisible()).toBe(false);
    }, TIMEOUT);

    it('loads the metrics every second while automatic reload is checked, and not while it is unchecked', async () => {
        const loads: string[] = [];
        page = await browser.open(`${appUrl}/metrics/dashboard`, async opened => {
            // the clock of the page stands still, and moves only when the test moves it
            await opened.clock.install({ time: 0 });
            await opened.clock.pauseAt(1000);
            opened.on('request', request => {
                if (new URL(request.url()).pathname === '/metrics') {
                    loads.push(request.url());
                }
            });
        });
        async function waitForLoads(count: number): Promise<void> {
            while (loads.length < count) {
                await page.waitForTimeout(50);
            }
        }

        await waitForLoads(1);
        await page.clock.runFor(3000);
        await waitForLoads(4);
        await page.locator('#automatic-reload').uncheck();
        await page.clock.runFor(5000);
        await page.waitForTimeout(500);
        const whileUnchecked: number = loads.length - 4;
        await page.locator('#automatic-reload').check();
        await waitForLoads(5);

        expect(whileUnchecked).toBe(0);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('shows the metrics it loads in the components that read them', async () => {
        // the scheduler of a test runs no job on its own, so the snapshot the page loads is taken here
        await inject<MetricsServiceInterface>(ZIBRI_DI_TOKENS.METRICS_SERVICE).collect();
        await open();

        await page.waitForFunction(() => document.getElementById('uptimeInfo-overview')?.textContent !== '...');

        expect(await page.locator('#uptimeInfo-overview').textContent()).toMatch(/^\d+d \d+h \d+m \d+s$/);
        expect(await page.locator('#rateLimiterSizeStat').textContent()).toMatch(/^\d+$/);
        expect(browser.findPageErrors(page)).toEqual([]);
    }, TIMEOUT);

    it('marks its tabs for assistive technology', async () => {
        await open();
        await page.locator('#button-caches').click();

        expect(await page.locator('#button-caches').getAttribute('role')).toBe('tab');
        expect(await page.locator('#button-caches').getAttribute('aria-selected')).toBe('true');
        expect(await page.locator('#button-caches').getAttribute('aria-controls')).toBe('caches');
        expect(await page.locator('#button-overview').getAttribute('aria-selected')).toBe('false');
        expect(await page.locator('#caches').getAttribute('role')).toBe('tabpanel');
        expect(await page.locator('#caches').getAttribute('aria-labelledby')).toBe('button-caches');
        expect(await page.locator('#button-caches').evaluate(button => button.parentElement?.getAttribute('role'))).toBe('tablist');
    }, TIMEOUT);
});
