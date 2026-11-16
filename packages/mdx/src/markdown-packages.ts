import { createRequire } from 'node:module';

import type { Root } from 'mdast';
import type * as FromMarkdown from 'mdast-util-from-markdown';
import type * as Frontmatter from 'mdast-util-frontmatter';
import type * as Gfm from 'mdast-util-gfm';
import type * as Mdx from 'mdast-util-mdx';
import type * as FrontmatterSyntax from 'micromark-extension-frontmatter';
import type * as GfmSyntax from 'micromark-extension-gfm';
import type * as MdxSyntax from 'micromark-extension-mdxjs';
import type * as ShikiCore from 'shiki/core';
import type * as ShikiJavaScriptEngine from 'shiki/engine/javascript';
import type * as ShikiLanguages from 'shiki/langs';
import type * as Yaml from 'yaml';

import type { MarkdownKind } from './markdown-printer.model';

/**
 * The packages a markdown template is parsed with.
 */
export type MarkdownPackages = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    fromMarkdown: typeof FromMarkdown,
    // eslint-disable-next-line jsdoc/require-jsdoc
    frontmatter: typeof Frontmatter,
    // eslint-disable-next-line jsdoc/require-jsdoc
    frontmatterSyntax: typeof FrontmatterSyntax,
    // eslint-disable-next-line jsdoc/require-jsdoc
    gfm: typeof Gfm,
    // eslint-disable-next-line jsdoc/require-jsdoc
    gfmSyntax: typeof GfmSyntax,
    // eslint-disable-next-line jsdoc/require-jsdoc
    mdx: typeof Mdx,
    // eslint-disable-next-line jsdoc/require-jsdoc
    mdxSyntax: typeof MdxSyntax,
    // eslint-disable-next-line jsdoc/require-jsdoc
    yaml: typeof Yaml
};

/**
 * The packages code is highlighted with.
 */
export type HighlightPackages = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    core: typeof ShikiCore,
    // eslint-disable-next-line jsdoc/require-jsdoc
    engine: typeof ShikiJavaScriptEngine,
    // eslint-disable-next-line jsdoc/require-jsdoc
    languages: typeof ShikiLanguages,
    /**
     * VS Code's theme Dark+, whose rules decide the kind of each token.
     */
    darkPlus: ShikiCore.ThemeRegistration,
    /**
     * Loads the grammar of a language, by its id.
     */
    loadLanguage: (id: string) => ShikiCore.LanguageRegistration[]
};

const packageRequire: NodeJS.Require = createRequire(__filename);

/**
 * Loads the packages markdown templates are parsed and highlighted with, once the first is printed.
 */
// They ship as es modules only, which `require` loads as long as they hold no top-level await: node's own does, and
// jest's when it runs with --experimental-vm-modules, as the tests of zibri-tsx do.
export abstract class MarkdownPackageUtilities {
    private static markdown: MarkdownPackages | undefined;
    private static highlight: HighlightPackages | undefined;

    /**
     * Resolves the packages a markdown template is parsed with.
     * @returns The packages.
     */
    static resolveMarkdownPackages(): MarkdownPackages {
        this.markdown ??= {
            fromMarkdown: this.load('mdast-util-from-markdown'),
            frontmatter: this.load('mdast-util-frontmatter'),
            frontmatterSyntax: this.load('micromark-extension-frontmatter'),
            gfm: this.load('mdast-util-gfm'),
            gfmSyntax: this.load('micromark-extension-gfm'),
            mdx: this.load('mdast-util-mdx'),
            mdxSyntax: this.load('micromark-extension-mdxjs'),
            yaml: this.load('yaml')
        };
        return this.markdown;
    }

    /**
     * Parses markdown as GitHub writes it, with its frontmatter, and with JSX, expressions and imports for mdx.
     * @param packages - The packages it is parsed with.
     * @param source - The markdown.
     * @param kind - Whether it is plain markdown or mdx.
     * @returns The parsed markdown.
     * @throws The syntax error of an mdx file that cannot be read, at its place.
     */
    static parseMarkdown(packages: MarkdownPackages, source: string, kind: MarkdownKind): Root {
        return packages.fromMarkdown.fromMarkdown(source, {
            extensions: [
                packages.gfmSyntax.gfm(),
                packages.frontmatterSyntax.frontmatter(['yaml']),
                ...kind === 'mdx' ? [packages.mdxSyntax.mdxjs()] : []
            ],
            mdastExtensions: [
                packages.gfm.gfmFromMarkdown(),
                packages.frontmatter.frontmatterFromMarkdown(['yaml']),
                ...kind === 'mdx' ? [packages.mdx.mdxFromMarkdown()] : []
            ]
        });
    }

    /**
     * Resolves the packages code is highlighted with.
     * @returns The packages.
     */
    static resolveHighlightPackages(): HighlightPackages {
        this.highlight ??= {
            core: this.load('shiki/core'),
            engine: this.load('shiki/engine/javascript'),
            languages: this.load('shiki/langs'),
            darkPlus: this.load<{
                /**
                 * The theme.
                 */
                default: ShikiCore.ThemeRegistration
            }>('shiki/themes/dark-plus.mjs').default,
            loadLanguage: id => {
                const grammar: {
                    /**
                     * The grammar of the language.
                     */
                    default: ShikiCore.LanguageRegistration[]
                } = this.load(`shiki/langs/${id}.mjs`);
                return grammar.default;
            }
        };
        return this.highlight;
    }

    private static load<T>(name: string): T {
        // require knows no types: the package's are the ones imported above
        // eslint-disable-next-line typescript/no-unsafe-return
        return packageRequire(name);
    }
}