import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { EntryPointUtilities, TESTING_ENTRY_POINT } from '../__testing__/entry-point.utilities';
import { GlobalRegistry } from '../global/global-registry';
// the barrel, for the entities it declares on GlobalRegistry as it loads
// eslint-disable-next-line eslintImport/no-unassigned-import
import '../index';

/**
 * Whether every page in `docs/` follows the rules of `DOCS_STYLE.md` that a word gives away.
 *
 * The voice itself - short sentences that say what is - takes a reader. What a single word gives
 * away does not: a "still" is history, a `MULTI` is a store's internals, an em dash in prose is the
 * punctuation the style replaced. Each rule reports what it finds as `page:line "match"`, so a
 * failure reads as the list of places to fix.
 */

const DOCS_DIR: string = path.join(__dirname, '..', '..', 'docs');

/**
 * A single line named import from one of the zibri packages, which is the form every page uses.
 */
const ZIBRI_IMPORT: RegExp = /^import\s+(?:type\s+)?{([^}]*)}\s+from\s+'zibri(?:-testing|-tsx)?';$/;

/**
 * The header of the table of packages under `## Requirements`.
 */
const REQUIREMENT_PACKAGE_HEADER: string = '| Package | Used for |';

/**
 * The header of the table of entities under `## Requirements`.
 */
const REQUIREMENT_ENTITY_HEADER: string = '| Entity | Needed when |';

/**
 * The page that says of every framework table how large it grows and what deletes its rows.
 */
const FRAMEWORK_TABLES_PAGE: string = 'framework-tables.md';

/**
 * The header of the table on that page.
 */
const FRAMEWORK_TABLES_HEADER: string = '| Entity | Grows with | Rows end |';

/**
 * Entities the framework declares for the reader to extend, whose own subclass is what goes into a
 * data source.
 */
const ENTITIES_EXTENDED_BY_THE_READER: string[] = ['BaseRoleEntity'];

/**
 * The page that defines the terms the other pages share, one `##` heading per term.
 */
const GLOSSARY_PAGE: string = 'glossary.md';

/**
 * Terms the glossary defines that the pages also use in their everyday sense, such as a DI provider
 * beside an identity provider, a JWT claim beside the claim on a slot, or the credentials of a mail
 * server beside the credential of a request. A link on their first use would as often point at the
 * wrong meaning as the right one.
 */
const UNCHECKED_TERMS: string[] = ['Login', 'Session', 'Provider', 'Claim', 'Grant', 'Identity', 'Credential', 'Scope'];

/**
 * What the Requirements test reads of `package.json`.
 */
type PackageManifest = {
    /**
     * The packages installed with zibri.
     */
    dependencies: Record<string, string>,
    /**
     * The packages zibri expects next to it.
     */
    peerDependencies: Record<string, string>,
    /**
     * Which of the peers are optional, so the reader installs them for the feature that needs them.
     */
    peerDependenciesMeta: Record<string, { optional: boolean }>
};

/**
 * One rule of the style, as the words that break it.
 */
type StyleRule = {
    /**
     * What the rule asks for, as the test names it.
     */
    name: string,
    /**
     * The words that break it. Global, so every match on a line is reported.
     */
    pattern: RegExp,
    /**
     * Whether the rule reads the code blocks too, and not only the prose.
     */
    readsCode: boolean,
    /**
     * The pages DOCS_STYLE names as the exception to the rule.
     */
    exceptFor: string[]
};

/**
 * One line of a page, as the rules read it.
 */
type PageLine = {
    /**
     * The line number in the page, from 1.
     */
    line: number,
    /**
     * The line as written.
     */
    raw: string,
    /**
     * The line without inline code and link targets, which is the prose a reader reads. Empty
     * inside a code block.
     */
    prose: string,
    /**
     * Whether the line is inside a fenced code block.
     */
    inCode: boolean
};

/**
 * One fenced code block of a page.
 */
type CodeBlock = {
    /**
     * The line number of the opening fence, from 1.
     */
    line: number,
    /**
     * The language the fence names, empty when it names none.
     */
    language: string,
    /**
     * The block's lines, without the fences.
     */
    code: string[]
};

/**
 * One page, as the rules read it.
 */
type Page = {
    /**
     * The page's file name.
     */
    name: string,
    /**
     * The page's lines.
     */
    lines: PageLine[],
    /**
     * The anchors of the page's headings, as a link names them.
     */
    anchors: Set<string>,
    /**
     * The page's `##` headings, in order, without the `## `.
     */
    sections: string[],
    /**
     * The page's code blocks, in order.
     */
    blocks: CodeBlock[],
    /**
     * The first cell of each row of the page's `## Key exports` table, by line number.
     */
    keyExports: Map<number, string>
};

const RULES: StyleRule[] = [
    {
        // DOCS_STYLE, "What stays out of a page": history. "still" and "now" are left to the reader:
        // most of them are about time inside one run ("while still running"), not about versions
        name: 'says what is, with no history',
        pattern: /\b(any ?more|no longer|used to be|today|nowadays|2\.x)\b|\(yet\)/gi,
        readsCode: false,
        exceptFor: ['upgrading-to-3.md']
    },
    {
        // DOCS_STYLE, "What stays out of a page": references into the repository. Case sensitive, so
        // an example's `eslint-disable jsdoc/...` is not mistaken for pointing at a JSDoc. No
        // `__testing__`: `zi new` writes the reader's own tests there
        name: 'names no evaluation, JSDoc or source module',
        pattern: /\b[Ee]valuation\b|\bJSDoc\b|\bin the \w+ module\b/g,
        readsCode: true,
        exceptFor: []
    },
    {
        // DOCS_STYLE, "What stays out of a page": how it works underneath. costs.md is the one page
        // that names stores
        name: 'says nothing about how it works underneath',
        pattern: /\b(MULTI|EXEC|WATCH|Lua|redis\.call|pg_\w+|advisory lock|RxJS|node-cron|ICU|under the hood|socket\.io adapter)\b/g,
        readsCode: true,
        exceptFor: ['costs.md']
    },
    {
        // DOCS_STYLE, "The voice": write it plainly
        name: 'writes it plainly, without framing or judging',
        pattern: /\b(simple|simply|easy|easily|worth knowing|worth a note|on purpose|deliberate|deliberately|textbook|is what makes|(two|three|four) things|stumble|let's|this page (explains|describes|shows))\b/gi,
        readsCode: false,
        exceptFor: []
    },
    {
        // DOCS_STYLE, "The voice": second person for the developer, third person for their users
        name: 'calls the developer "you" and a user "they"',
        pattern: /\b(he|she|him|his|her|hers|himself|herself|we|our|us)\b/gi,
        readsCode: false,
        exceptFor: []
    },
    {
        // DOCS_STYLE, "Sections": headings name the task. The FAQ is the one page where why is the
        // content
        name: 'names a task in every heading, never a reason',
        pattern: /^#+ (why|the problem|caveats)\b/gi,
        readsCode: false,
        exceptFor: ['faq.md']
    },
    {
        // DOCS_STYLE, "Words and punctuation". The See also separator is taken off before the rules
        // read the line
        name: 'uses no em dash in prose',
        pattern: /—/g,
        readsCode: false,
        exceptFor: []
    },
    {
        // DOCS_STYLE, "Words and punctuation"
        name: 'starts a paragraph with a blank line, not <br>',
        pattern: /<br\s*\/?>/gi,
        readsCode: false,
        exceptFor: []
    },
    {
        // DOCS_STYLE, "Code examples": names are realistic, domains are example.com. Case sensitive,
        // so a sentence starting with "Test" is not taken for a class. `TestBrowser` is an export of
        // zibri-testing
        name: 'uses realistic names and example.com',
        pattern: /\b(Foo\w*|Bar|Baz|My[A-Z]\w*|(?!TestBrowser\b)Test(?:[A-Z]\w*)?)\b|@(?!example\.com\b)[\w-]+\.(com|org|net|de|io)\b/g,
        readsCode: true,
        exceptFor: []
    },
    {
        // DOCS_STYLE, "Words and punctuation"
        name: 'writes "such as" or "for example", not "eg."',
        pattern: /\be\.?g\./gi,
        readsCode: false,
        exceptFor: []
    },
    {
        // DOCS_STYLE, "Words and punctuation"
        name: 'spells American',
        pattern: /\b(enrol|enrols|enrolment|honour\w*|behaviour\w*|organis\w*|colour\w*|favour\w*|licence|initialis\w*|serialis\w*|recognis\w*|normalis\w*|analys(e|ed|es|ing)|catalogue)\b/gi,
        readsCode: false,
        exceptFor: []
    }
];

/**
 * The anchor a heading gets, the way GitHub and typedoc derive it.
 * @param heading - The heading's text, without the leading `#`s.
 * @returns The anchor, without the `#`.
 */
function resolveAnchor(heading: string): string {
    return heading
        .replaceAll(/\[([^\]]*)]\([^)]*\)/g, '$1')
        .toLowerCase()
        .trim()
        .replaceAll(/[^\p{L}\p{N} _-]/gu, '')
        .replaceAll(' ', '-');
}

/**
 * The words a page uses a glossary term with: the term and its plural, as a whole word. An acronym
 * (`SAML`, `DPoP`) is matched in its casing, anything else in any.
 * @param term - The term, as its glossary heading names it.
 * @returns The pattern.
 */
function resolveTermPattern(term: string): RegExp {
    const escaped: string = term.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
    const plural: string = escaped.endsWith('y') ? `${escaped.slice(0, -1)}(?:y|ies)` : `${escaped}(?:s|es)?`;
    const isAcronym: boolean = /[A-Z]/.test(term.slice(1));
    return new RegExp(String.raw`\b${plural}\b`, isAcronym ? '' : 'i');
}

/**
 * Reads one page into the lines the rules read and the anchors its headings give.
 * @param name - The page's file name.
 * @returns The page.
 */
// eslint-disable-next-line sonar/cognitive-complexity
function resolvePage(name: string): Page {
    const lines: PageLine[] = [];
    const anchors: Set<string> = new Set();
    const sections: string[] = [];
    const blocks: CodeBlock[] = [];
    const keyExports: Map<number, string> = new Map();

    let block: CodeBlock | undefined = undefined;
    let inSeeAlso: boolean = false;
    let inKeyExports: boolean = false;
    const fileContent: string[] = readFileSync(path.join(DOCS_DIR, name), 'utf8').split('\n');
    for (const [index, raw] of fileContent.entries()) {
        const fence: RegExpExecArray | null = /^\s*```(\w*)/.exec(raw);
        if (fence) {
            if (block == undefined) {
                block = { line: index + 1, language: fence[1] ?? '', code: [] };
                blocks.push(block);
            }
            else {
                block = undefined;
            }
            lines.push({ line: index + 1, raw, prose: '', inCode: true });
            continue;
        }
        if (block != undefined) {
            block.code.push(raw);
            lines.push({ line: index + 1, raw, prose: '', inCode: true });
            continue;
        }

        const heading: RegExpExecArray | null = /^(#+) (.*)$/.exec(raw);
        if (heading) {
            const anchor: string = resolveAnchor(heading[2] ?? '');
            let unique: string = anchor;
            for (let suffix: number = 1; anchors.has(unique); suffix++) {
                unique = `${anchor}-${suffix}`;
            }
            anchors.add(unique);
            if (heading[1] === '##') {
                sections.push(heading[2] ?? '');
            }
            inSeeAlso = raw === '## See also';
            inKeyExports = raw === '## Key exports';
        }
        const row: RegExpExecArray | null = /^\| ([^|]*) \|/.exec(raw);
        if (inKeyExports && row && !raw.startsWith('| Export |') && !raw.startsWith('|---')) {
            keyExports.set(index + 1, row[1] ?? '');
        }

        let prose: string = raw
            .replaceAll(/`[^`]*`/g, '')
            .replaceAll(/]\([^)]*\)/g, ']');
        if (inSeeAlso) {
            // the one em dash the style keeps: between a link and what the reader finds there
            prose = prose.replace(/^- \[[^\]]*] — /, '- ');
        }
        lines.push({ line: index + 1, raw, prose, inCode: false });
    }

    return { name, lines, anchors, sections, blocks, keyExports };
}

/**
 * One row of a table under `## Requirements`.
 */
type RequirementRow = {
    /**
     * The line number in the page, from 1.
     */
    line: number,
    /**
     * The row's cells, trimmed.
     */
    cells: string[]
};

/**
 * Reads the rows of every table the given header opens, wherever on the page it stands.
 * @param lines - The lines of the page.
 * @param header - The header row of the table.
 * @returns The rows below the header, without the separator.
 */
function findTableRows(lines: PageLine[], header: string): RequirementRow[] {
    const rows: RequirementRow[] = [];
    let inTable: boolean = false;
    for (const line of lines.filter(entry => !entry.inCode)) {
        if (!line.raw.startsWith('|')) {
            inTable = false;
        }
        else if (line.raw === header) {
            inTable = true;
        }
        else if (inTable && !line.raw.startsWith('|---')) {
            rows.push({ line: line.line, cells: line.raw.split(' | ').map(cell => cell.replaceAll(/^\| ?| ?\|$/g, '').trim()) });
        }
    }
    return rows;
}

/**
 * Reads the rows of the table under `## Requirements` that the given header opens.
 * @param page - The page.
 * @param header - The header row of the table.
 * @returns The rows below the header, without the separator.
 */
function findRequirementRows(page: Page, header: string): RequirementRow[] {
    const rows: RequirementRow[] = [];
    let inRequirements: boolean = false;
    let inTable: boolean = false;
    for (const line of page.lines.filter(entry => !entry.inCode)) {
        if (/^#+ /.test(line.raw)) {
            inRequirements = line.raw === '## Requirements';
            continue;
        }
        if (!line.raw.startsWith('|')) {
            inTable = false;
            continue;
        }
        if (line.raw === header) {
            inTable = true;
            continue;
        }
        if (inRequirements && inTable && !line.raw.startsWith('|---')) {
            rows.push({ line: line.line, cells: line.raw.split(' | ').map(cell => cell.replaceAll(/^\| ?| ?\|$/g, '').trim()) });
        }
    }
    return rows;
}

/**
 * The names one cell of a `## Key exports` table lists, each as the identifier its code span opens
 * with, so that `` `CronExpression.every()` `` lists `CronExpression`.
 * @param cell - The first cell of a row.
 * @returns The listed names.
 */
function resolveCellNames(cell: string): string[] {
    return [...cell.matchAll(/`([$A-Z_a-z][\w$]*)/g)].map(match => match[1] ?? '');
}

/**
 * The names the `## Key exports` tables list.
 * @param pages - The pages.
 * @returns The listed names.
 */
function resolveKeyExportNames(pages: Page[]): Set<string> {
    return new Set(pages.flatMap(page => [...page.keyExports.values()]).flatMap(cell => resolveCellNames(cell)));
}

/**
 * Finds every place on a page that breaks a rule.
 * @param page - The page.
 * @param rule - The rule.
 * @returns Each place as `page:line "match"`.
 */
function findViolations(page: Page, rule: StyleRule): string[] {
    if (rule.exceptFor.includes(page.name)) {
        return [];
    }
    const violations: string[] = [];
    for (const line of page.lines) {
        const text: string = line.inCode ? rule.readsCode ? line.raw : '' : line.prose;
        for (const match of text.matchAll(rule.pattern)) {
            violations.push(`${page.name}:${line.line} "${match[0]}"`);
        }
    }
    return violations;
}

const pages: Page[] = [];

describe('the pages in docs/', () => {

    beforeAll(() => {
        for (const name of readdirSync(DOCS_DIR).filter(entry => entry.endsWith('.md'))) {
            pages.push(resolvePage(name));
        }
    });

    it('finds pages to read', () => {
        // a guard on the reading rather than on the docs: a page this stops finding would make every
        // rule below pass by having nothing left to say
        expect(pages.length).toBeGreaterThan(40);
    });

    it.each(RULES)('$name', rule => {
        const violations: string[] = pages.flatMap(page => findViolations(page, rule));
        expect(violations).toEqual([]);
    });

    it('links only to pages and headings that exist', () => {
        const byName: Map<string, Page> = new Map(pages.map(page => [page.name, page]));
        const broken: string[] = [];
        for (const page of pages) {
            for (const line of page.lines.filter(entry => !entry.inCode)) {
                for (const link of line.raw.replaceAll(/`[^`]*`/g, '').matchAll(/]\((\.\/)?([\w-]+\.md)?(?:#([^\s)]+))?\)/g)) {
                    const target: Page | undefined = link[2] == undefined ? page : byName.get(link[2]);
                    if (target == undefined || (link[3] != undefined && !target.anchors.has(link[3]))) {
                        broken.push(`${page.name}:${line.line} "${link[0]}"`);
                    }
                }
            }
        }
        expect(broken).toEqual([]);
    });

    it('has its parts in the order of every page', () => {
        const misplaced: string[] = [];
        for (const page of pages) {
            const { name, sections } = page;
            if (sections.includes('Usage')) {
                misplaced.push(`${name}: a "Usage" section around the tasks`);
            }
            if (sections.includes('Key exports') && sections[0] !== 'Key exports') {
                misplaced.push(`${name}: "Key exports" is not the first section`);
            }
            if (!['upgrading-to-3.md'].includes(name) && sections.at(-1) !== 'See also') {
                misplaced.push(`${name}: "See also" is not the last section`);
            }
            if (sections.includes('Requirements') && sections.at(-2) !== 'Requirements') {
                misplaced.push(`${name}: "Requirements" is not right before "See also"`);
            }
        }
        expect(misplaced).toEqual([]);
    });

    // eslint-disable-next-line sonar/cognitive-complexity
    it('lists every name an example imports from zibri in the Key exports of some page', () => {
        // one page is enough: the owner lists it, and a page using `inject` in passing does not
        // repeat it. What this catches is a name no table has, typically one added without a row
        const listed: Set<string> = resolveKeyExportNames(pages);
        const missing: Set<string> = new Set();
        for (const page of pages) {
            for (const block of page.blocks) {
                for (const line of block.code) {
                    const imported: RegExpExecArray | null = ZIBRI_IMPORT.exec(line.trim());
                    for (const entry of (imported?.[1] ?? '').split(',')) {
                        // `type Ms` and `workerData as data` export `Ms` and `workerData`
                        const exported: string | undefined = entry.trim()
                            .replace(/^type\s+/, '')
                            .split(/\s+/)[0];
                        if (exported != undefined && exported !== '' && !listed.has(exported)) {
                            missing.add(`${exported}, imported on ${page.name}:${block.line}`);
                        }
                    }
                }
            }
        }
        expect([...missing]).toEqual([]);
    });

    it('lists every name the zibri entry point exports in the Key exports of some page', () => {
        // the entry point is the public api releases.md promises to keep, so a name on it without a
        // row is a promise nobody wrote down. What is there for the sibling packages or for a driver
        // goes to `zibri/internal`, which promises nothing
        const listed: Set<string> = resolveKeyExportNames(pages);

        const unlisted: string[] = EntryPointUtilities.resolveNames('index.ts')
            .filter(exported => !listed.has(exported.name))
            .map(exported => `${exported.name} (${exported.file})`);

        expect(unlisted).toEqual([]);
    }, 120_000);

    it('lists only names that zibri or zibri-testing export in the Key exports', () => {
        // the other way round: a row outliving its export sends a reader to an import that fails
        const exported: Set<string> = new Set([...EntryPointUtilities.resolveNames('index.ts'), ...EntryPointUtilities.resolveNames(TESTING_ENTRY_POINT)]
            .map(entry => entry.name));

        const stale: string[] = pages.flatMap(page => [...page.keyExports.entries()]
            .flatMap(([line, cell]) => resolveCellNames(cell)
                .filter(name => !exported.has(name))
                .map(name => `${name}, listed on ${page.name}:${line}`)));

        expect(stale).toEqual([]);
    }, 120_000);

    it('names its file on the first line of every code example', () => {
        const unnamed: string[] = [];
        for (const page of pages) {
            for (const block of page.blocks.filter(entry => ['ts', 'tsx', 'typescript'].includes(entry.language))) {
                if (!/^\/\/ \S+\.tsx?\b/.test(block.code[0] ?? '')) {
                    unnamed.push(`${page.name}:${block.line} "${block.code[0] ?? ''}"`);
                }
            }
        }
        expect(unnamed).toEqual([]);
    });

    it('lists every package zibri stands on under Requirements, and only those', () => {
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const manifest: PackageManifest = JSON.parse(readFileSync(path.join(DOCS_DIR, '..', 'package.json'), 'utf8'));
        const optional: Set<string> = new Set(Object.entries(manifest.peerDependenciesMeta)
            .filter(([, meta]) => meta.optional)
            .map(([name]) => name));
        const dependencies: Set<string> = new Set([
            ...Object.keys(manifest.dependencies),
            ...Object.keys(manifest.peerDependencies)
        ]);

        const wrong: string[] = [];
        const listed: Set<string> = new Set();
        for (const page of pages) {
            for (const { line, cells } of findRequirementRows(page, REQUIREMENT_PACKAGE_HEADER)) {
                const name: string | undefined = /^`([^`]+)`$/.exec(cells[0] ?? '')?.[1];
                if (name == undefined) {
                    wrong.push(`${page.name}:${line} names no single package`);
                    continue;
                }
                listed.add(name);
                if (!dependencies.has(name)) {
                    wrong.push(`${page.name}:${line} ${name} is no dependency`);
                }
                // a peer npm installs on its own needs nothing from the reader
                if ((cells[1] ?? '').includes('You install it') !== optional.has(name)) {
                    wrong.push(`${page.name}:${line} ${name} says "You install it" only when it is an optional peer`);
                }
            }
        }
        for (const name of dependencies) {
            if (!listed.has(name)) {
                wrong.push(`no page lists ${name}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it('lists every entity the framework stores rows in under Requirements, and only those', () => {
        // every entity the barrel declares, which is every one a feature of the framework may need in
        // the reader's data source. Each page says which of them its feature needs, and when
        const entities: Set<string> = new Set(GlobalRegistry.entityClasses
            .map(entity => entity.name)
            .filter(name => !ENTITIES_EXTENDED_BY_THE_READER.includes(name)));

        const wrong: string[] = [];
        const listed: Set<string> = new Set();
        for (const page of pages) {
            for (const { line, cells } of findRequirementRows(page, REQUIREMENT_ENTITY_HEADER)) {
                for (const name of [...(cells[0] ?? '').matchAll(/`([^`]+)`/g)].map(match => match[1] ?? '')) {
                    listed.add(name);
                    if (!entities.has(name)) {
                        wrong.push(`${page.name}:${line} ${name} is no entity of the framework`);
                    }
                }
            }
        }
        for (const name of entities) {
            if (!listed.has(name)) {
                wrong.push(`no page lists ${name}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    // whoever approves the schema asks of each table how large it grows and what deletes its
    // rows, which the feature pages answered for some tables and not for others
    it('says of every entity the framework stores rows in how its table grows and what ends its rows', () => {
        const entities: Set<string> = new Set(GlobalRegistry.entityClasses
            .map(entity => entity.name)
            .filter(name => !ENTITIES_EXTENDED_BY_THE_READER.includes(name)));
        const page: Page | undefined = pages.find(entry => entry.name === FRAMEWORK_TABLES_PAGE);
        expect(page).toBeDefined();

        const wrong: string[] = [];
        const listed: Map<string, number> = new Map();
        for (const { line, cells } of findTableRows(page?.lines ?? [], FRAMEWORK_TABLES_HEADER)) {
            if (cells.slice(1).some(cell => cell === '')) {
                wrong.push(`${FRAMEWORK_TABLES_PAGE}:${line} leaves a cell empty`);
            }
            for (const name of [...(cells[0] ?? '').matchAll(/`([^`]+)`/g)].map(match => match[1] ?? '')) {
                listed.set(name, (listed.get(name) ?? 0) + 1);
                if (!entities.has(name)) {
                    wrong.push(`${FRAMEWORK_TABLES_PAGE}:${line} ${name} is no entity of the framework`);
                }
            }
        }
        for (const name of entities) {
            if (listed.get(name) !== 1) {
                wrong.push(`${name} is listed ${listed.get(name) ?? 0} times`);
            }
        }
        expect(wrong).toEqual([]);
    });

    // a reader entering on any one page meets the terms of the others, so DOCS_STYLE has a
    // page link a term to the glossary where it first uses it
    it('links each term of the glossary the first time a page uses it', () => {
        const glossary: Page | undefined = pages.find(page => page.name === GLOSSARY_PAGE);
        expect(glossary).toBeDefined();
        const terms: string[] = (glossary?.sections ?? []).filter(section => section !== 'See also' && !UNCHECKED_TERMS.includes(section));
        // not vacuous: the auth, data and coordination pages share well over a dozen terms
        expect(terms.length).toBeGreaterThan(15);

        // the pages each entry sends its reader on to, which define the term in full
        const owners: Map<string, Set<string>> = new Map();
        let entry: string | undefined = undefined;
        for (const line of glossary?.lines ?? []) {
            entry = /^## (.*)$/.exec(line.raw)?.[1] ?? entry;
            for (const link of line.raw.matchAll(/]\(\.\/([\w-]+\.md)/g)) {
                owners.set(entry ?? '', (owners.get(entry ?? '') ?? new Set()).add(link[1] ?? ''));
            }
        }

        const unlinked: string[] = [];
        for (const page of pages.filter(other => other.name !== GLOSSARY_PAGE)) {
            const seeAlso: number = page.lines.find(line => line.raw === '## See also')?.line ?? Number.POSITIVE_INFINITY;
            for (const term of terms) {
                const pattern: RegExp = resolveTermPattern(term);
                // a heading keeps its anchor free of links, and See also names pages rather than terms
                const first: PageLine | undefined = page.lines.find(line => !line.inCode
                    && line.line < seeAlso
                    && !/^#+ /.test(line.raw)
                    && pattern.test(line.prose));
                if (first == undefined) {
                    continue;
                }
                const target: string = `${GLOSSARY_PAGE}#${resolveAnchor(term)})`;
                const toGlossary: boolean = page.lines.some(line => line.line <= first.line && line.raw.includes(target));
                // a first use that already links to the page the entry sends its reader to keeps that link
                const toOwner: boolean = [...first.raw.matchAll(/\[([^\]]*)]\(\.\/([\w-]+\.md)[^)]*\)/g)]
                    .some(link => pattern.test(link[1] ?? '') && owners.get(term)?.has(link[2] ?? '') === true);
                if (!toGlossary && !toOwner) {
                    unlinked.push(`${page.name}:${first.line} "${term}"`);
                }
            }
        }
        expect(unlinked).toEqual([]);
    });
});