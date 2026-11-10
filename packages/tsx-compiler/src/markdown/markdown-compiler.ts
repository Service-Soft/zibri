import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { Diagnostic, SourceSpan } from 'zibri-tsx';
import { offsetToLineColumn } from 'zibri-tsx/internal';

import { MarkdownKind, MarkdownPrinter, MarkdownPrinterModule, PrintedMarkdown } from './markdown-printer.model';
import { compile, CompileOptions, CompileResult } from '../codegen/compile';
import { decodeMappings, encodeMappings, SourceMap } from '../codegen/source-map';

/**
 * A markdown template printed as a tsx template, with what leads from the one back to the other.
 */
export type MarkdownTemplate = {
    /**
     * The tsx template, or undefined when the markdown cannot be printed.
     */
    tsx: string | undefined,
    /**
     * What printing it found, at places of the markdown.
     */
    diagnostics: Diagnostic[],
    /**
     * Where an offset of the tsx template is in the markdown: the start of the line it comes from.
     */
    toMarkdownOffset: (offset: number) => number,
    /**
     * The line of the markdown each line of the tsx template comes from, both 0-based.
     */
    markdownLines: number[]
};

/**
 * Compiles markdown templates: `.md` and `.mdx` files, printed as tsx templates and compiled like those.
 */
export abstract class MarkdownCompilerUtilities {
    /**
     * Whether a file is a markdown template, and which kind.
     * @param fileName - The file's path.
     * @returns The kind, or undefined for any other file.
     */
    static findMarkdownKind(fileName: string): MarkdownKind | undefined {
        if (fileName.endsWith('.mdx')) {
            return 'mdx';
        }
        return fileName.endsWith('.md') ? 'md' : undefined;
    }

    /**
     * Compiles a markdown template into a module whose default export is the page, beside the export `frontmatter`.
     * The diagnostics and the source map lead to the markdown.
     * @param source - The markdown.
     * @param kind - Whether it is plain markdown or mdx.
     * @param options - The compile options.
     * @returns The emitted module and any diagnostics.
     */
    static compileMarkdown(source: string, kind: MarkdownKind, options: CompileOptions = {}): CompileResult {
        const template: MarkdownTemplate = this.resolveMarkdownTemplate(source, kind, options.fileName);
        if (template.tsx === undefined) {
            return {
                diagnostics: template.diagnostics,
                code: undefined,
                map: undefined,
                componentName: undefined,
                client: undefined,
                clientPackages: []
            };
        }
        const result: CompileResult = compile(template.tsx, options);
        return {
            ...result,
            diagnostics: [
                ...template.diagnostics,
                ...result.diagnostics.map(diagnostic => ({
                    ...diagnostic,
                    span: toMarkdownSpan(diagnostic.span, template.toMarkdownOffset)
                }))
            ],
            map: result.map === undefined ? undefined : toMarkdownSourceMap(result.map, template.markdownLines, source)
        };
    }

    /**
     * Prints a markdown template as a tsx template, such as for the type check, which checks the tsx.
     * @param source - The markdown.
     * @param kind - Whether it is plain markdown or mdx.
     * @param fileName - The path of the template, whose project `zibri-mdx` is loaded from. The working directory's
     * project when left out.
     * @returns The tsx template, and what leads from it back to the markdown.
     * @throws When the project has no `zibri-mdx` installed.
     */
    static resolveMarkdownTemplate(source: string, kind: MarkdownKind, fileName?: string): MarkdownTemplate {
        const printed: PrintedMarkdown = this.resolvePrinter(fileName).printMarkdown(source, kind);
        if (printed.template === undefined) {
            return { tsx: undefined, diagnostics: printed.diagnostics, toMarkdownOffset: offset => offset, markdownLines: [] };
        }
        const tsx: string = printed.template.lines.join('\n');
        const markdownLines: number[] = printed.template.origins.map(origin => origin.line);
        const markdownLineStarts: number[] = resolveLineStarts(source);
        return {
            tsx,
            diagnostics: printed.diagnostics,
            toMarkdownOffset: offset => markdownLineStarts[markdownLines[offsetToLineColumn(tsx, offset).line - 1] ?? 0] ?? 0,
            markdownLines
        };
    }

    /**
     * What tells the printer of a template's project apart from another: where its `zibri-mdx` is, and when it was
     * written, which installing another version or building it again changes.
     * @param fileName - The path of the template, whose project `zibri-mdx` is loaded from.
     * @returns The identity, or an empty text when the project has no `zibri-mdx`, which compiling the template reports.
     * @throws When `zibri-mdx` is there and cannot be resolved.
     */
    static resolvePrinterIdentity(fileName: string): string {
        let printerFile: string;
        try {
            printerFile = createRequire(path.resolve(fileName)).resolve('zibri-mdx');
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
                return '';
            }
            throw error;
        }
        return `${printerFile}:${statSync(printerFile).mtimeMs}`;
    }

    // From the project of the template rather than from this package, which declares no dependency on zibri-mdx, not
    // even an optional peer: npm keeps a package a production one names in a deployment, and zibri-mdx with its parser
    // and highlighter is what building one needs, never what it runs. The project installs it as a devDependency.
    private static resolvePrinter(fileName: string = 'package.json'): MarkdownPrinter {
        const projectRequire: NodeJS.Require = createRequire(path.resolve(fileName));
        let printerModule: unknown;
        try {
            printerModule = projectRequire('zibri-mdx');
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
                throw new Error('A markdown template needs the package \'zibri-mdx\'. Install it with:\nnpm i -D zibri-mdx');
            }
            throw error;
        }
        if (!isMarkdownPrinterModule(printerModule)) {
            throw new Error('The installed zibri-mdx prints no markdown. Install the zibri-mdx of the release of zibri-tsx.');
        }
        return printerModule.MarkdownPrinterUtilities;
    }
}

/**
 * Whether a module is the printer of `zibri-mdx`.
 * @param value - What loading the module returned.
 * @returns True when it exports a printer.
 */
function isMarkdownPrinterModule(value: unknown): value is MarkdownPrinterModule {
    if (typeof value !== 'object' || value === null || !('MarkdownPrinterUtilities' in value)) {
        return false;
    }
    const printer: unknown = value.MarkdownPrinterUtilities;
    return typeof printer === 'function' && 'printMarkdown' in printer && typeof printer.printMarkdown === 'function';
}

/**
 * The offsets each line of a text starts at.
 * @param text - The text.
 * @returns The offset of each line, by its 0-based number.
 */
function resolveLineStarts(text: string): number[] {
    const starts: number[] = [0];
    for (let index: number = 0; index < text.length; index++) {
        if (text[index] === '\n') {
            starts.push(index + 1);
        }
    }
    return starts;
}

/**
 * A span of the tsx template as a span of the markdown.
 * @param span - The span.
 * @param toMarkdownOffset - Where an offset of the tsx template is in the markdown.
 * @returns The span in the markdown.
 */
function toMarkdownSpan(span: SourceSpan, toMarkdownOffset: (offset: number) => number): SourceSpan {
    const start: number = toMarkdownOffset(span.start);
    return { start, end: Math.max(start, toMarkdownOffset(span.end)) };
}

/**
 * The source map of the module, leading to the markdown rather than the tsx template it was printed as.
 * @param map - The map to the tsx template.
 * @param markdownLines - The line of the markdown each line of the tsx template comes from.
 * @param source - The markdown.
 * @returns The map to the markdown.
 */
function toMarkdownSourceMap(map: SourceMap, markdownLines: number[], source: string): SourceMap {
    const mappings: string = encodeMappings(decodeMappings(map.mappings).map(segments => segments.map(segment => ({
        generatedColumn: segment.generatedColumn,
        sourceLine: markdownLines[segment.sourceLine] ?? 0,
        sourceColumn: 0
    }))));
    return { ...map, sourcesContent: [source], mappings };
}