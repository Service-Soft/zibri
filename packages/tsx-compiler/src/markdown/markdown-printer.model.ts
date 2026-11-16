import { Diagnostic } from 'zibri-tsx';

import { EmittedLines } from '../codegen/source-map';

/**
 * Which markdown a template is written in: plain markdown, or markdown with JSX, expressions and imports.
 */
export type MarkdownKind = 'md' | 'mdx';

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
 * What prints markdown templates as tsx templates, which the package `zibri-mdx` provides.
 */
export type MarkdownPrinter = {
    /**
     * Prints a markdown template as a tsx template.
     * @param source - The markdown.
     * @param kind - Whether it is plain markdown or mdx.
     * @returns The tsx template, and what printing it found.
     */
    printMarkdown: (source: string, kind: MarkdownKind) => PrintedMarkdown
};

/**
 * What the package `zibri-mdx` exports, of what compiling a markdown template reads.
 */
export type MarkdownPrinterModule = {
    /**
     * The printer.
     */
    MarkdownPrinterUtilities: MarkdownPrinter
};