import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { defaultTestProviders } from 'zibri-testing';

import { ZIBRI_DI_TOKENS } from './zibri-di-tokens.default';
import { DOCS_DIR, DocsPagesUtilities } from '../../__testing__/docs-pages.utilities';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../plugin/invoicing/invoicing.tokens';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from '../../plugin/mailing-list/mailing-list.tokens';
import { ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from '../../plugin/payment/payment.tokens';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { TokenRecord, tokenName } from '../models/di-token.model';

/**
 * A page that lists the tokens of one token object, in tables headed `| Token | Type | What it is |`.
 */
type TokenPage = {
    /**
     * The page's path below `docs/`.
     */
    page: string,
    /**
     * The token object the page lists, whose keys its rows name without the object's name.
     */
    record: TokenRecord
};

const TOKEN_PAGES: TokenPage[] = [
    { page: 'application/configuration.md', record: ZIBRI_DI_TOKENS },
    { page: 'plugins/invoicing-plugin.md', record: ZIBRI_INVOICING_PLUGIN_DI_TOKENS },
    { page: 'plugins/mailing-list-plugin.md', record: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS },
    { page: 'plugins/payment-plugin.md', record: ZIBRI_PAYMENT_PLUGIN_DI_TOKENS }
];

/**
 * One row of a token table.
 */
type TokenRow = {
    /**
     * The key of the token in its object, as `HTTP_DRAIN_TIMEOUT_IN_MS`.
     */
    key: string,
    /**
     * The page the token links to, when it links to one: another page, or the page itself for a link
     * to one of its own headings.
     */
    page: string | undefined,
    /**
     * The line number in the page, from 1.
     */
    line: number
};

/**
 * Reads the rows of every token table of a page.
 * @param page - The page's path below `docs/`.
 * @returns The rows, in the order of the page.
 */
function findTokenRows(page: string): TokenRow[] {
    const rows: TokenRow[] = [];
    let inTokenTable: boolean = false;
    const fileContent: string[] = readFileSync(path.join(DOCS_DIR, page), 'utf8').split('\n');
    for (const [index, raw] of fileContent.entries()) {
        if (raw === '| Token | Type | What it is |') {
            inTokenTable = true;
            continue;
        }
        if (!raw.startsWith('|')) {
            inTokenTable = false;
        }
        const row: RegExpExecArray | null = /^\| (?:\[`(\w+)`]\(((?:\.{1,2}\/)*[\w/-]+\.md)?(?:#[\w-]+)?\)|`(\w+)`) \|/.exec(raw);
        if (!inTokenTable || row == undefined) {
            continue;
        }
        const linked: boolean = row[1] != undefined;
        rows.push({
            key: row[1] ?? row[3] ?? '',
            page: linked ? row[2] == undefined ? page : DocsPagesUtilities.resolveLinkedPage(page, row[2]) : undefined,
            line: index + 1
        });
    }
    return rows;
}

describe.each(TOKEN_PAGES)('$page', ({ page, record }) => {
    const rows: TokenRow[] = findTokenRows(page);

    it('lists every token of its token object once, and nothing else', () => {
        expect(rows.map(row => row.key).sort()).toEqual(ObjectUtilities.keys(record).sort());
    });

    it('links a token only to a page that names it', () => {
        const unnamed: string[] = [];
        for (const row of rows) {
            if (row.page == undefined) {
                continue;
            }
            if (!new RegExp(`\\b${row.key}\\b`).test(readFileSync(path.join(DOCS_DIR, row.page), 'utf8'))) {
                unnamed.push(`${page}:${row.line} ${row.key} -> ${row.page}`);
            }
        }
        expect(unnamed).toEqual([]);
    });
});

describe('testing.md', () => {
    it('lists the tokens a test server provides, and only those', () => {
        // the first cell of each row of the table, which names one token or several separated by commas
        const page: string = readFileSync(path.join(DOCS_DIR, 'testing.md'), 'utf8');
        const table: string = page.split('| Token | What a test server uses instead |')[1]?.split('\n\n')[0] ?? '';
        const documented: string[] = [...table.matchAll(/^\| ([^|]*) \|/gm)]
            .flatMap(row => [...(row[1] ?? '').matchAll(/`([\dA-Z_]+)`/g)].map(name => name[1] ?? ''));

        const keysByName: Map<string, string> = new Map(
            ObjectUtilities.entries(ZIBRI_DI_TOKENS).map(([key, token]) => [tokenName(token), key])
        );
        const provided: string[] = defaultTestProviders.map(provider => keysByName.get(tokenName(provider.token)) ?? tokenName(provider.token));

        expect(documented.sort()).toEqual(provided.sort());
    });
});