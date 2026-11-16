import { createRequire } from 'node:module';

import type * as Cheerio from 'cheerio';

const peerRequire: NodeJS.Require = createRequire(__filename);

/**
 * Loads the optional packages of email components, only once an email uses the component that needs one, so a
 * project without it installs none of them.
 */
export abstract class EmailPeerUtilities {
    private static cheerio: typeof Cheerio | undefined;

    /**
     * Resolves the package `MjHtmlAttributes` matches its selectors with.
     * @returns The package.
     * @throws When it is not installed, naming what to install.
     */
    static resolveCheerio(): typeof Cheerio {
        try {
            // require knows no types: the package's are the ones imported above
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const cheerio: typeof Cheerio = this.cheerio ?? peerRequire('cheerio');
            this.cheerio = cheerio;
            return cheerio;
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
                throw new Error('An email with MjHtmlAttributes needs the package \'cheerio\'. Install it with:\nnpm i cheerio');
            }
            throw error;
        }
    }
}