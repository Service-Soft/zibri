import { describe, expect, it } from '@jest/globals';

import { addImportStatement } from './add-import-statement.function';

describe('addImportStatement', () => {
    it('adds a new named import at the top when no import for that path exists yet', () => {
        const lines: string[] = ['const x = 1;'];
        addImportStatement(lines, { element: 'Foo', path: './foo', defaultImport: false });

        expect(lines[0]).toBe('import { Foo } from \'./foo\';');
        expect(lines[1]).toBe('const x = 1;');
    });

    it('adds a new default import at the top when no import for that path exists yet', () => {
        const lines: string[] = ['const x = 1;'];
        addImportStatement(lines, { element: 'Foo', path: './foo', defaultImport: true });

        expect(lines[0]).toBe('import Foo from \'./foo\';');
    });

    it('does not duplicate an import that is already present for the same element and path', () => {
        const lines: string[] = ['import { Foo } from \'./foo\';', 'const x = 1;'];
        addImportStatement(lines, { element: 'Foo', path: './foo', defaultImport: false });

        expect(lines).toEqual(['import { Foo } from \'./foo\';', 'const x = 1;']);
    });

    it('merges a new named import into an existing named-import statement for the same path', () => {
        const lines: string[] = ['import { Foo } from \'./foo\';'];
        addImportStatement(lines, { element: 'Bar', path: './foo', defaultImport: false });

        expect(lines[0]).toBe('import { Bar, Foo } from \'./foo\';');
    });

    it('adds a default import to an existing named-import statement for the same path', () => {
        const lines: string[] = ['import { Foo } from \'./foo\';'];
        addImportStatement(lines, { element: 'Default', path: './foo', defaultImport: true });

        expect(lines[0]).toBe('import Default, { Foo } from \'./foo\';');
    });

    it('throws when adding a default import to a path that already has a default import', () => {
        const lines: string[] = ['import Foo from \'./foo\';'];

        expect(() => addImportStatement(lines, { element: 'Bar', path: './foo', defaultImport: true }))
            .toThrow(/already a default import/);
    });

    it('adds a named import to an existing default-only import, producing valid combined import syntax', () => {
        const lines: string[] = ['import Foo from \'./foo\';'];
        addImportStatement(lines, { element: 'Named', path: './foo', defaultImport: false });

        expect(lines[0]).toBe('import Foo, { Named } from \'./foo\';');
    });

    it('only touches the matching import line, leaving unrelated lines untouched', () => {
        const lines: string[] = ['import { Other } from \'./other\';', 'import { Foo } from \'./foo\';', 'const x = 1;'];
        addImportStatement(lines, { element: 'Bar', path: './foo', defaultImport: false });

        expect(lines).toEqual([
            'import { Other } from \'./other\';',
            'import { Bar, Foo } from \'./foo\';',
            'const x = 1;'
        ]);
    });
});