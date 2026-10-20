import { describe, expect, it } from 'vitest';

import { offsetToLineColumn } from './diagnostic.model.ts';

describe('offsetToLineColumn', () => {
    const source: string = 'const a = 1;\nconst b = 2;\n  const c = 3;';

    it('resolves the first character to line 1, column 1', () => {
        expect(offsetToLineColumn(source, 0)).toEqual({ line: 1, column: 1 });
    });

    it('resolves an offset on a later line', () => {
        // first char of line 2 ("const b") is right after the first '\n'
        const offset: number = source.indexOf('const b');
        expect(offsetToLineColumn(source, offset)).toEqual({ line: 2, column: 1 });
    });

    it('accounts for leading whitespace as columns', () => {
        const offset: number = source.indexOf('const c');
        expect(offsetToLineColumn(source, offset)).toEqual({ line: 3, column: 3 });
    });

    it('clamps offsets past the end of the source', () => {
        expect(offsetToLineColumn(source, source.length + 100)).toEqual(
            offsetToLineColumn(source, source.length)
        );
    });

    it('clamps negative offsets to the start', () => {
        expect(offsetToLineColumn(source, -5)).toEqual({ line: 1, column: 1 });
    });
});