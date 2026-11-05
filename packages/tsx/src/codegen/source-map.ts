import * as ts from 'typescript';

/**
 * A source map of a compiled template, in the v3 format every tool reads.
 */
export type SourceMap = {
    /**
     * The format version.
     */
    version: 3,
    /**
     * The template the map leads to.
     */
    sources: string[],
    /**
     * The template's source, so a tool shows it without reading the file.
     */
    sourcesContent: string[],
    /**
     * The original names, none here.
     */
    names: string[],
    /**
     * The mappings, VLQ encoded.
     */
    mappings: string
};

/**
 * Where one line of an assembled module comes from in the template.
 */
export type LineOrigin = {
    /**
     * The line of the template, 0-based.
     */
    line: number,
    /**
     * The column of the template, 0-based. For an exact line, what the line's own columns are offset
     * by; otherwise where every column of the line maps to.
     */
    column: number,
    /**
     * Whether the line is the template's own text, so a column on it is a column of the template.
     */
    exact: boolean
};

/**
 * Lines of an assembled module, each with where it comes from.
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
 * One mapping of a source map: a generated column, and the source position it comes from.
 */
export type MappingSegment = {
    /**
     * The column of the generated line.
     */
    generatedColumn: number,
    /**
     * The source line, 0-based.
     */
    sourceLine: number,
    /**
     * The source column, 0-based.
     */
    sourceColumn: number
};

const BASE64: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Lines of text that all come from one place of the template.
 * @param text - The text.
 * @param origin - Where it comes from.
 * @returns The lines, each with that origin.
 */
export function emitLines(text: string, origin: LineOrigin): EmittedLines {
    const lines: string[] = text.split('\n');
    return { lines, origins: lines.map(() => origin) };
}

/**
 * The text of a node as written in the template, line for line: a column on any of its lines is a
 * column of the template.
 * @param node - The node.
 * @param file - The template.
 * @returns The lines of the node's text, with exact origins.
 */
export function emitVerbatim(node: ts.Node, file: ts.SourceFile): EmittedLines {
    const start: number = node.getStart(file);
    const { line, character } = file.getLineAndCharacterOfPosition(start);
    const lines: string[] = file.text.slice(start, node.getEnd()).split('\n');
    return {
        lines,
        // the first line starts mid-line in the template, every other one at its start
        origins: lines.map((_, index) => ({ line: line + index, column: index === 0 ? character : 0, exact: true }))
    };
}

/**
 * Where a node starts in the template, as the origin of lines generated from it.
 * @param node - The node.
 * @param file - The template.
 * @returns The origin.
 */
export function resolveOrigin(node: ts.Node, file: ts.SourceFile): LineOrigin {
    return resolveOriginAt(node.getStart(file), file);
}

/**
 * Where an offset of the template is, as the origin of lines generated from it.
 * @param offset - The offset into the template.
 * @param file - The template.
 * @returns The origin.
 */
export function resolveOriginAt(offset: number, file: ts.SourceFile): LineOrigin {
    const { line, character } = file.getLineAndCharacterOfPosition(offset);
    return { line, column: character, exact: false };
}

/**
 * Joins emitted lines.
 * @param parts - The parts, in order.
 * @returns One sequence of lines.
 */
export function concatLines(parts: EmittedLines[]): EmittedLines {
    return {
        lines: parts.flatMap(part => part.lines),
        origins: parts.flatMap(part => part.origins)
    };
}

/**
 * The source map of a compiled template: TypeScript's map of the final module back to the assembled
 * module, followed through to where each assembled line came from in the template.
 * @param transpiledMappings - The mappings TypeScript wrote for the assembled module.
 * @param origins - Where each line of the assembled module comes from.
 * @param fileName - The template's path.
 * @param source - The template's source.
 * @returns The map from the final module to the template.
 */
export function resolveTemplateSourceMap(transpiledMappings: string, origins: LineOrigin[], fileName: string, source: string): SourceMap {
    const lines: MappingSegment[][] = decodeMappings(transpiledMappings).map(segments => segments.flatMap(segment => {
        const origin: LineOrigin | undefined = origins[segment.sourceLine];
        if (origin === undefined) {
            return [];
        }
        return [
            {
                generatedColumn: segment.generatedColumn,
                sourceLine: origin.line,
                sourceColumn: origin.exact ? origin.column + segment.sourceColumn : origin.column
            }
        ];
    }));
    return { version: 3, sources: [fileName], sourcesContent: [source], names: [], mappings: encodeMappings(lines) };
}

/**
 * Reads the mappings of a source map with one source.
 * @param mappings - The mappings, VLQ encoded.
 * @returns The segments of each generated line, the ones without a source left out.
 */
export function decodeMappings(mappings: string): MappingSegment[][] {
    let sourceLine: number = 0;
    let sourceColumn: number = 0;
    return mappings.split(';').map(line => {
        let generatedColumn: number = 0;
        const segments: MappingSegment[] = [];
        for (const segment of line === '' ? [] : line.split(',')) {
            const fields: number[] = decodeVlq(segment);
            generatedColumn += fields[0] ?? 0;
            if (fields.length < 4) {
                continue;
            }
            // fields[1] is the source index, always 0 for a map with one source
            sourceLine += fields[2] ?? 0;
            sourceColumn += fields[3] ?? 0;
            segments.push({ generatedColumn, sourceLine, sourceColumn });
        }
        return segments;
    });
}

/**
 * Writes the mappings of a source map with one source.
 * @param lines - The segments of each generated line.
 * @returns The mappings, VLQ encoded.
 */
export function encodeMappings(lines: MappingSegment[][]): string {
    let sourceLine: number = 0;
    let sourceColumn: number = 0;
    return lines.map(segments => {
        let generatedColumn: number = 0;
        return segments.map(segment => {
            const encoded: string = encodeVlq([
                segment.generatedColumn - generatedColumn,
                0,
                segment.sourceLine - sourceLine,
                segment.sourceColumn - sourceColumn
            ]);
            generatedColumn = segment.generatedColumn;
            sourceLine = segment.sourceLine;
            sourceColumn = segment.sourceColumn;
            return encoded;
        }).join(',');
    }).join(';');
}

/**
 * Reads one VLQ encoded segment.
 * @param segment - The segment.
 * @returns Its fields.
 */
function decodeVlq(segment: string): number[] {
    const fields: number[] = [];
    let value: number = 0;
    let shift: number = 0;
    for (const char of segment) {
        const digit: number = BASE64.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) {
            shift += 5;
            continue;
        }
        fields.push(value & 1 ? -(value >> 1) : value >> 1);
        value = 0;
        shift = 0;
    }
    return fields;
}

/**
 * Writes one VLQ encoded segment.
 * @param fields - Its fields.
 * @returns The segment.
 */
function encodeVlq(fields: number[]): string {
    return fields.map(field => {
        let value: number = field < 0 ? (-field << 1) | 1 : field << 1;
        let encoded: string = '';
        do {
            let digit: number = value & 31;
            value >>>= 5;
            if (value > 0) {
                digit |= 32;
            }
            encoded += BASE64[digit];
        } while (value > 0);
        return encoded;
    }).join('');
}