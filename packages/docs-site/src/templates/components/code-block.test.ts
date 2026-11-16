import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { BundledLanguage, bundledLanguages, BundledTheme, createHighlighter, Highlighter, LanguageRegistration, ThemedToken,
    ThemeRegistration } from 'shiki';
import { DocsUtilities } from 'zibri';
import { CODE_TOKEN_KIND_COLORS } from 'zibri-mdx';
import { StartedTestServer } from 'zibri-testing';

import { startDocsSite } from '../../__testing__/start-docs-site.function';
import { HtmlUtilities } from '../../html/html.utilities';
import { DOCS_SITE } from '../../navigation/docs-site';

/**
 * A code block of a page, as the site renders it.
 */
type RenderedCodeBlock = {
    language: string,
    // each piece of the code, with the classes of its span
    pieces: RenderedPiece[]
};

type RenderedPiece = {
    text: string,
    classNames: string[]
};

/**
 * A rule of the stylesheet coloring code of a kind.
 */
type CodeColorRule = {
    className: string,
    color: string
};

// the theme of VS Code that Dark Modern takes the colors of code from
const VS_CODE_THEME: BundledTheme = 'dark-plus';

const STYLESHEET: string = readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'public', 'style.css'), 'utf8');

/**
 * A color the stylesheet names, as six lowercase hex digits.
 * @param value - The value of a `color`, a hex color or a variable of the theme.
 * @returns The color.
 * @throws When the stylesheet defines no such variable.
 */
function resolveColor(value: string): string {
    const variable: string | undefined = /^var\(--([\w-]+)\)$/.exec(value)?.[1];
    if (variable === undefined) {
        return value.toLowerCase();
    }
    const themeValue: string | undefined = new RegExp(`--${variable}:\\s*([^;]+);`).exec(STYLESHEET)?.[1];
    if (themeValue === undefined) {
        throw new Error(`The stylesheet defines no --${variable}.`);
    }
    return resolveColor(themeValue.trim());
}

// the color of code of no kind
const PLAIN_COLOR: string = resolveColor('var(--color-code)');

/**
 * The rules coloring code, in the order of the stylesheet, so that of two matching the later wins.
 * @returns The rules, one per class.
 */
function resolveCodeColorRules(): CodeColorRule[] {
    return [...STYLESHEET.matchAll(/^([^\n{}@]*\.shiki-token-[^\n{]*)\{\s*color:\s*([^;]+);/gm)].flatMap(match => {
        const color: string = resolveColor((match[2] ?? '').trim());
        return (match[1] ?? '').split(',').map(selector => ({ className: selector.trim().slice(1), color }));
    });
}

/**
 * Whether shiki bundles a grammar for a language.
 * @param language - The language, by its name or an alias of it.
 * @returns Whether it does.
 */
function isBundledLanguage(language: string): language is BundledLanguage {
    return language in bundledLanguages;
}

/**
 * Loads the grammar of a language with those of the languages it embeds, as VS Code has every grammar at hand.
 * @param highlighter - The highlighter.
 * @param language - The language.
 */
async function loadLanguage(highlighter: Highlighter, language: BundledLanguage): Promise<void> {
    if (highlighter.getLoadedLanguages().includes(language)) {
        return;
    }
    const grammars: LanguageRegistration[] = (await bundledLanguages[language]()).default;
    await highlighter.loadLanguage(...grammars);
    for (const embedded of grammars.flatMap(grammar => grammar.embeddedLangsLazy ?? []).filter(isBundledLanguage)) {
        await loadLanguage(highlighter, embedded);
    }
}

/**
 * The code blocks of a page.
 * @param html - The page.
 * @returns Its code blocks with a language.
 */
function findCodeBlocks(html: string): RenderedCodeBlock[] {
    return [...html.matchAll(/<code class="language-([\w-]+)">([\s\S]*?)<\/code>/g)].map(match => ({
        language: match[1] ?? '',
        pieces: [...(match[2] ?? '').matchAll(/<span class="([^"]*)">([^<]*)<\/span>|([^<]+)/g)].map(piece => ({
            text: HtmlUtilities.decode(piece[2] ?? piece[3] ?? ''),
            classNames: piece[1]?.split(' ') ?? []
        }))
    }));
}

/**
 * The color of each character of a code block on the site: that of the last rule naming a class of its span.
 * @param block - The code block.
 * @param rules - The rules coloring code.
 * @returns The colors, one per character of the code.
 */
function resolveSiteColors(block: RenderedCodeBlock, rules: CodeColorRule[]): string[] {
    return block.pieces.flatMap(piece => {
        const color: string = rules.filter(rule => piece.classNames.includes(rule.className)).at(-1)?.color ?? PLAIN_COLOR;
        return [...piece.text].map(() => color);
    });
}

/**
 * Where the site colors a code block other than VS Code does.
 * @param block - The code block.
 * @param tokens - Its tokens, as VS Code colors them.
 * @param siteColors - The color of each of its characters on the site.
 * @returns Each token colored otherwise, with both colors.
 */
function findDifferences(block: RenderedCodeBlock, tokens: ThemedToken[], siteColors: string[]): string[] {
    return tokens.flatMap(token => {
        const vsCodeColor: string = token.color?.toLowerCase().slice(0, 7) ?? PLAIN_COLOR;
        // the color of blank space shows nowhere
        const shownColors: Set<string> = new Set([...token.content]
            .map((character, index) => /\s/.test(character) ? vsCodeColor : siteColors[token.offset + index] ?? PLAIN_COLOR));
        return [...shownColors]
            .filter(shown => shown !== vsCodeColor)
            .map(shown => `${block.language} ${JSON.stringify(token.content.trim())}: VS Code ${vsCodeColor}, the site ${shown}`);
    });
}

describe('the colors of code', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let highlighter: Highlighter;

    beforeAll(async () => {
        server = await startDocsSite();
        baseUrl = await server.start();
        highlighter = await createHighlighter({ themes: [VS_CODE_THEME], langs: [] });
    }, 60_000);

    afterAll(async () => {
        highlighter.dispose();
        await server.shutdown();
    }, 30_000);

    it('names a kind for every color VS Code gives code, and colors each kind so', async () => {
        const theme: ThemeRegistration = (await import('shiki/themes/dark-plus.mjs')).default;
        const vsCodeColors: Set<string> = new Set((theme.tokenColors ?? [])
            .map(rule => rule.settings.foreground?.toLowerCase() ?? PLAIN_COLOR)
            .filter(color => color !== PLAIN_COLOR));
        const rules: CodeColorRule[] = resolveCodeColorRules();

        expect([...vsCodeColors].sort()).toEqual(Object.values(CODE_TOKEN_KIND_COLORS).sort());
        for (const [kind, color] of Object.entries(CODE_TOKEN_KIND_COLORS)) {
            const className: string = `shiki-token-${kind}`;

            expect(`${className} ${rules.find(rule => rule.className === className)?.color}`).toBe(`${className} ${color}`);
        }
    });

    it('colors every token of the code of every page as VS Code does', async () => {
        const rules: CodeColorRule[] = resolveCodeColorRules();
        const differences: Set<string> = new Set();

        for (const page of DocsUtilities.resolvePages(DOCS_SITE)) {
            const html: string = await (await fetch(`${baseUrl}${DocsUtilities.resolveAddress(DOCS_SITE, page.file)}`)).text();
            for (const block of findCodeBlocks(html)) {
                const language: string = block.language;
                // a language VS Code knows no more of than the site, such as txt, shows as plain text in both
                if (!isBundledLanguage(language)) {
                    continue;
                }
                await loadLanguage(highlighter, language);
                const code: string = block.pieces.map(piece => piece.text).join('');
                const tokens: ThemedToken[] = highlighter.codeToTokensBase(code, { lang: language, theme: VS_CODE_THEME }).flat();
                for (const difference of findDifferences(block, tokens, resolveSiteColors(block, rules))) {
                    differences.add(difference);
                }
            }
        }

        expect([...differences].sort()).toEqual([]);
    }, 120_000);
});