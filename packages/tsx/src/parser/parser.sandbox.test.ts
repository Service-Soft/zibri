import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { parse, ParseResult } from './parser';
import { collectTsxFiles } from '../__testing__/sandbox.helper';
import { Diagnostic, LineColumn, offsetToLineColumn } from '../diagnostics/diagnostic.model';

const sandboxTemplates: string = join(__dirname, '..', '..', '..', 'sandbox', 'src', 'templates');

describe('parser against real sandbox templates', () => {
    const files: string[] = collectTsxFiles(sandboxTemplates);

    it('finds template files to test', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it.each(files.map(f => [f.slice(sandboxTemplates.length + 1), f] as const))(
        'parses %s without diagnostics',
        (_name, file) => {
            const source: string = readFileSync(file, 'utf8');
            const result: ParseResult = parse(source);
            if (result.diagnostics.length > 0) {
                const first: Diagnostic = result.diagnostics[0];
                const lc: LineColumn = offsetToLineColumn(source, first.span.start);
                const around: string = source.slice(Math.max(0, first.span.start - 60), first.span.start + 20);
                throw new Error(`[${lc.line}:${lc.column}] ${first.message}\n--- near ---\n${around}<HERE>\n------------`);
            }
            expect(result.program).toBeDefined();
        }
    );
});