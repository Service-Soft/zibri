import { describe, expect, it } from '@jest/globals';

import { unavailableNamesIn } from './script-names';

describe('unavailableNamesIn', () => {
    const available: ReadonlySet<string> = new Set(['document', 'console']);

    it('reports a name the script reads without declaring it', () => {
        expect(unavailableNamesIn('function setup(props) { console.log(props, SECRET_CONFIG); }', available))
            .toEqual(['SECRET_CONFIG']);
    });

    it('reports names inside syntax of any kind', () => {
        // a class body and a `for...in` loop, which the compiler's own analysis has no case for
        const code: string = 'function setup() { class Box { open() { return ADMIN_URL; } } '
            + 'for (const key in document) { console.log(key, SESSION); } }';

        expect(unavailableNamesIn(code, available)).toEqual(['ADMIN_URL', 'SESSION']);
    });

    it('reports loading a module', () => {
        expect(unavailableNamesIn('function setup() { import(\'./secrets\'); return import.meta.url; }', available))
            .toEqual(['import', 'import.meta']);
    });

    it('leaves out declarations, property names, labels and available names', () => {
        const code: string = 'function setup({ a: renamed }, runtime) { const local = { key: renamed }; '
            + 'outer: for (const item of [local]) { if (item.key) { break outer; } } '
            + 'document.title = runtime.title; }';

        expect(unavailableNamesIn(code, available)).toEqual([]);
    });
});