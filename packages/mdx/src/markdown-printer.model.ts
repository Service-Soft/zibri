import type { Diagnostic } from 'zibri-tsx';

// The contract zibri-tsx-compiler loads this package by, declared here rather than imported from the compiler: a
// package naming the compiler, even as a peer, keeps it and TypeScript in every deployment that carries this one, as
// one rendering markdown at runtime does. The compiler checks that the two agree, in a type test of its own.

/**
 * Which markdown a template is written in: plain markdown, or markdown with JSX, expressions and imports.
 */
export type MarkdownKind = 'md' | 'mdx';

/**
 * Where a line of a printed template comes from.
 */
export type LineOrigin = {
    /**
     * The line of the markdown, 0-based.
     */
    line: number,
    /**
     * The column of the markdown, 0-based, that every column of the line maps to.
     */
    column: number,
    /**
     * Whether the line is the markdown's own text, so a column on it is a column of the markdown. Never, for a
     * printed template.
     */
    exact: boolean
};

/**
 * The lines of a printed template, each with where it comes from.
 */
export type EmittedLines = {
    /**
     * The lines.
     */
    lines: string[],
    /**
     * The origin of each line.
     */
    origins: LineOrigin[]
};

/**
 * A markdown template, printed as a tsx template.
 */
export type PrintedMarkdown = {
    /**
     * The tsx template, each line with the line of the markdown it comes from, or undefined when the markdown cannot
     * be printed.
     */
    template: EmittedLines | undefined,
    /**
     * What printing it found, each at its place in the markdown.
     */
    diagnostics: Diagnostic[]
};

/**
 * The codes of what printing a markdown template finds, as zibri-tsx-compiler reports them.
 */
export const MarkdownDiagnosticCode: {
    /**
     * A markdown template holds what cannot be printed as a page: a syntax error, raw html in a `.md` file, or
     * frontmatter that is no yaml mapping.
     */
    readonly MARKDOWN_INVALID: 'ZTSX018',
    /**
     * A code block of a markdown template names a language the highlighter does not know, so its code is not
     * highlighted.
     */
    readonly CODE_LANGUAGE_UNKNOWN: 'ZTSX019'
} = {
    MARKDOWN_INVALID: 'ZTSX018',
    CODE_LANGUAGE_UNKNOWN: 'ZTSX019'
};