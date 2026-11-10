import type { HighlighterCore, LanguageRegistration, ThemedToken, ThemeRegistration } from 'shiki/core';

import { CODE_TOKEN_KIND_COLORS } from './code-token-kinds';
import { HighlightPackages, MarkdownPackageUtilities } from './markdown-packages';

/**
 * One token of highlighted code.
 */
export type HighlightedToken = {
    /**
     * The text of the token.
     */
    text: string,
    /**
     * The class of its kind, such as `shiki-token-keyword`, which the stylesheet of the project colors. Undefined for
     * text of no kind.
     */
    className?: string
};

/**
 * Code, highlighted.
 */
export type HighlightedCode = {
    /**
     * The tokens of each line, or undefined when the language is not one the highlighter knows.
     */
    lines: HighlightedToken[][] | undefined
};

/**
 * A rule of a theme: the scopes it colors, and how.
 */
type ThemeRule = NonNullable<ThemeRegistration['tokenColors']>[number];

/**
 * The name the theme is registered under, whose colors are the variables of the project's stylesheet.
 */
const THEME: string = 'zibri-tsx';

// the color of plain text, which a token gets no class for
const FOREGROUND: string = 'var(--shiki-foreground)';

// the kind of each color of Dark+, which the rules of the theme name instead of the color
const KINDS_BY_COLOR: ReadonlyMap<string, string> = new Map(Object.entries(CODE_TOKEN_KIND_COLORS)
    .map(([kind, color]): [string, string] => [color, kind]));

/**
 * Highlights the code of fenced code blocks.
 *
 * The colors are classes rather than styles, as a content security policy without `'unsafe-inline'` refuses a
 * `style` attribute.
 */
export abstract class HighlightUtilities {
    private static highlighter: HighlighterCore | undefined;
    private static languageIds: Map<string, string> | undefined;

    /**
     * Highlights code.
     * @param code - The code.
     * @param language - The language, by its name or an alias of it, such as `ts`.
     * @returns The highlighted code.
     */
    static resolveHighlightedCode(code: string, language: string): HighlightedCode {
        const packages: HighlightPackages = MarkdownPackageUtilities.resolveHighlightPackages();
        const id: string | undefined = this.resolveLanguageIds(packages).get(language.toLowerCase());
        if (id === undefined) {
            return { lines: undefined };
        }
        const highlighter: HighlighterCore = this.resolveHighlighter(packages);
        this.loadLanguage(highlighter, packages, id);
        const tokens: ThemedToken[][] = highlighter.codeToTokensBase(code, { lang: id, theme: THEME });
        return { lines: tokens.map(line => line.map(token => ({ text: token.content, className: this.toClassName(token.color) }))) };
    }

    /**
     * Loads the grammar of a language, with those of the languages it embeds. A grammar loads the ones it always
     * embeds itself, but those it embeds lazily, such as the yaml of the frontmatter of markdown, only color code
     * once loaded; loaded only by a block of their own, the colors of a block would depend on the blocks before it.
     * @param highlighter - The highlighter.
     * @param packages - The packages the grammars are loaded from.
     * @param id - The id of the language.
     */
    private static loadLanguage(highlighter: HighlighterCore, packages: HighlightPackages, id: string): void {
        if (highlighter.getLoadedLanguages().includes(id)) {
            return;
        }
        const grammars: LanguageRegistration[] = packages.loadLanguage(id);
        highlighter.loadLanguageSync(grammars);
        for (const embedded of grammars.flatMap(grammar => grammar.embeddedLangsLazy ?? [])) {
            this.loadLanguage(highlighter, packages, embedded);
        }
    }

    private static resolveHighlighter(packages: HighlightPackages): HighlighterCore {
        this.highlighter ??= packages.core.createHighlighterCoreSync({
            themes: [this.resolveTheme(packages.darkPlus)],
            langs: [],
            engine: packages.engine.createJavaScriptRegexEngine()
        });
        return this.highlighter;
    }

    /**
     * The theme code is highlighted with: the rules of VS Code's Dark+, each naming the variable of the kind its color
     * stands for, so a token is of the kind Dark+ colors it as.
     * @param darkPlus - The theme Dark+.
     * @returns The theme.
     */
    private static resolveTheme(darkPlus: ThemeRegistration): ThemeRegistration {
        return {
            name: THEME,
            type: 'dark',
            colors: { 'editor.foreground': FOREGROUND, 'editor.background': 'var(--shiki-background)' },
            tokenColors: (darkPlus.tokenColors ?? []).map((rule): ThemeRule => {
                const color: string | undefined = rule.settings.foreground?.toLowerCase();
                if (color === undefined) {
                    return rule;
                }
                // a color of no kind, such as that of plain text, stays plain text
                const kind: string | undefined = KINDS_BY_COLOR.get(color);
                const foreground: string = kind === undefined ? FOREGROUND : `var(--shiki-token-${kind})`;
                return { ...rule, settings: { ...rule.settings, foreground } };
            })
        };
    }

    private static resolveLanguageIds(packages: HighlightPackages): Map<string, string> {
        this.languageIds ??= new Map(packages.languages.bundledLanguagesInfo.flatMap(info => [
            [info.id, info.id],
            ...(info.aliases ?? []).map((alias): [string, string] => [alias, info.id])
        ]));
        return this.languageIds;
    }

    /**
     * The class of a token's kind.
     * @param color - The color the theme gives it, the variable of its kind, such as `var(--shiki-token-keyword)`.
     * @returns The class, such as `shiki-token-keyword`, or undefined for the color of plain text.
     */
    private static toClassName(color: string | undefined): string | undefined {
        const variable: string | undefined = color === undefined ? undefined : /^var\(--(shiki-[\w-]+)\)$/.exec(color)?.[1];
        return variable === 'shiki-foreground' ? undefined : variable;
    }
}