import { optionalPeer, resolveAppRoot } from 'zibri';
import { vendorFileName } from 'zibri-tsx';

import { PageBrowserOptions } from './page-browser-options.model';
import { PageBrowser } from './page-browser.model';

const FEATURE: string = 'A page browser';

/**
 * Launches a headless Chromium for opening the pages of a started test server.
 *
 * Needs `playwright` installed, and its Chromium downloaded with `npx playwright install chromium`.
 * @param options - The vendor scripts to serve, and the proxy to play.
 * @returns The browser, which the test is responsible for closing.
 */
export async function startPageBrowser(options: PageBrowserOptions = {}): Promise<PageBrowser> {
    const { chromium } = optionalPeer<typeof import('playwright')>('playwright', FEATURE);
    const vendorScripts: Map<string, string> = new Map();
    if (options.vendorPackages?.length) {
        // not an optional peer, as zibri needs it, but loaded only here: the compiler loads TypeScript,
        // which nothing else a test imports from this package needs
        const { resolveVendorBundleCode } = optionalPeer<typeof import('zibri-tsx/compiler')>('zibri-tsx/compiler', FEATURE);
        const root: string = resolveAppRoot();
        await Promise.all(options.vendorPackages.map(async packageName => {
            vendorScripts.set(vendorFileName(packageName), await resolveVendorBundleCode(packageName, root));
        }));
    }
    return new PageBrowser(await chromium.launch(), vendorScripts, options.behindProxy);
}