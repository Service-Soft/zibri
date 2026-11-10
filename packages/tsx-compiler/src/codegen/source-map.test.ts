import assert from 'node:assert';

import { describe, expect, it } from '@jest/globals';

import { compile, CompileResult } from './compile';
import { decodeMappings, encodeMappings, MappingSegment } from './source-map';

/**
 * The 0-based line of a text that holds the given snippet.
 * @param text - The text.
 * @param snippet - What the line holds.
 * @returns The line.
 */
function lineOf(text: string, snippet: string): number {
    const line: number = text.split('\n').findIndex(candidate => candidate.includes(snippet));
    assert(line >= 0, `no line holds "${snippet}"`);
    return line;
}

const FILE: string = '/app/src/templates/home.tsx';

const TEMPLATE: string = [
    'import { TsxComponent } from \'zibri\';',
    '',
    'function fail(title: string): string {',
    '    if (title === \'boom\') {',
    '        throw new Error(\'boom\');',
    '    }',
    '    return title;',
    '}',
    '',
    'export const Home: TsxComponent<{ title: string }> = ({ title }) => {',
    '    const label: string = fail(title);',
    '    return <h1>{label}</h1>;',
    '};'
].join('\n');

describe('the mappings of a source map', () => {
    it('survive a round trip through the encoding', () => {
        const lines: MappingSegment[][] = [
            [],
            [{ generatedColumn: 0, sourceLine: 3, sourceColumn: 4 }, { generatedColumn: 12, sourceLine: 3, sourceColumn: 20 }],
            [{ generatedColumn: 4, sourceLine: 1, sourceColumn: 0 }],
            [{ generatedColumn: 0, sourceLine: 40, sourceColumn: 1000 }]
        ];

        expect(decodeMappings(encodeMappings(lines))).toEqual(lines);
    });

    it('read what TypeScript writes', () => {
        // "AAAA" is a segment of four zero fields, ";" an empty generated line, "A" a segment with
        // no source
        // eslint-disable-next-line cspell/spellchecker
        expect(decodeMappings('AAAA,IACE;;A')).toEqual([
            [{ generatedColumn: 0, sourceLine: 0, sourceColumn: 0 }, { generatedColumn: 4, sourceLine: 1, sourceColumn: 2 }],
            [],
            []
        ]);
    });
});

// the loader and the transformer handed over code without a map, so a stack frame of a
// template pointed at a generated line of a file nobody has seen
describe.each(['esm', 'cjs'] as const)('the source map of a template compiled as %s', format => {
    function compiled(): { code: string, lines: MappingSegment[][], sources: string[], sourcesContent: string[] } {
        const result: CompileResult = compile(TEMPLATE, { module: format, fileName: FILE });
        assert(result.code !== undefined, result.diagnostics.map(diagnostic => diagnostic.message).join('\n'));
        assert(result.map !== undefined, 'no map');
        return { code: result.code, lines: decodeMappings(result.map.mappings), sources: result.map.sources, sourcesContent: result.map.sourcesContent };
    }

    it('names the template and carries its source', () => {
        const { sources, sourcesContent } = compiled();

        expect(sources).toEqual([FILE]);
        expect(sourcesContent).toEqual([TEMPLATE]);
    });

    it('maps a statement outside the components to its own line and column', () => {
        const { code, lines } = compiled();
        const generatedLine: number = lineOf(code, 'throw new Error(');
        const generatedColumn: number = code.split('\n')[generatedLine].indexOf('throw');

        const segment: MappingSegment | undefined = lines[generatedLine].find(candidate => candidate.generatedColumn === generatedColumn);

        expect(segment).toEqual({ generatedColumn, sourceLine: lineOf(TEMPLATE, 'throw new Error'), sourceColumn: 8 });
    });

    it('maps a statement of the component body to the line it is written on', () => {
        const { code, lines } = compiled();
        const generatedLine: number = lineOf(code, '= fail(title);');

        expect(lines[generatedLine].map(segment => segment.sourceLine)).toContain(lineOf(TEMPLATE, 'const label'));
        expect(lines[generatedLine].every(segment => segment.sourceColumn === 4)).toBe(true);
    });

    it('maps the render function to the component', () => {
        const { code, lines } = compiled();
        const generatedLine: number = lineOf(code, 'function __render$Home(');

        expect(lines[generatedLine].map(segment => segment.sourceLine)).toContain(lineOf(TEMPLATE, 'export const Home'));
    });
});