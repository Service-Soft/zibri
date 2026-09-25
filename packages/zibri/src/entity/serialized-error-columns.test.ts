import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * What an entity may declare a failure with.
 *
 * An `Error`'s `message`, `stack` and `cause` are all non-enumerable, so a column that stores one
 * keeps `{}` of it - the row records that something failed and nothing whatever about what. Nothing
 * warns: the property is typed `Error`, the write succeeds, and every test asserting on such a
 * column checked that it was *defined*, which `{}` is.
 *
 * **The obvious guard does not work, and this is why it is a source scan instead.** The property
 * decorator could refuse an `Error` typed column if it could see the type, and
 * `emitDecoratorMetadata` looks like it offers exactly that - but `design:type` is only `Error` for
 * a bare `error?: Error`. For `Error | null` and `Error | undefined` TypeScript emits `Object`,
 * because it emits `Object` for every union. Both real defects were `Error | null`, so the
 * reflection a decorator can reach is blind to precisely the shape this occurs in. Measured, not
 * assumed.
 *
 * `LoggedError` is what the framework stores instead: a plain `{ name, paragraphs, stackTrace }`
 * that survives serialization and follows the `cause` chain.
 */

const sourceRoot: string = path.resolve(__dirname, '..');

/**
 * Every TypeScript file the framework ships, tests aside.
 * @param dir - Where to look.
 * @returns Their absolute paths.
 */
function sourceFiles(dir: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== '__testing__') {
                result.push(...sourceFiles(full));
            }
            continue;
        }
        if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
            result.push(full);
        }
    }
    return result;
}

/**
 * Every property declared on a column that is stored as json, with the type it declares.
 * @returns One entry per declaration, as `path: property: type`.
 */
function serializedProperties(): string[] {
    // the decorator call, then whatever comments sit between it and the property, then the property
    const declaration: RegExp = /@Property\.unknown\([^)]*\)\s*(?:\/\/[^\n]*\n\s*)*(\w+)[!?]?\s*:\s*([^\n;]+)/g;
    const found: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
        const content: string = readFileSync(file, 'utf8');
        for (const match of content.matchAll(declaration)) {
            // both groups are in the pattern, so a match carries both
            found.push(`${path.relative(sourceRoot, file)}: ${match[1]}: ${match[2]?.trim()}`);
        }
    }
    return found;
}

describe('a column that stores a failure', () => {

    it('finds the declarations it is meant to be reading', () => {
        // the scan is a regex over source, so it is worth knowing it still matches anything at all -
        // a rename that quietly matched nothing would make every assertion below vacuous
        expect(serializedProperties().length).toBeGreaterThan(3);
    });

    it('never declares an Error', () => {
        // `\bError\b` does not match inside `LoggedError`, which is the type these should be
        const storingAnError: string[] = serializedProperties().filter(entry => /\bError\b/.test(entry));

        expect(storingAnError).toEqual([]);
    });
});