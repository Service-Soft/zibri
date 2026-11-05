import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { SourceImportUtilities } from '../__testing__/source-import.utilities';
import { JsonUtilities } from '../utilities/json.utilities';

/**
 * What the data layer stands on.
 *
 * Typeorm supplied the pool, a second copy of the metadata model and the simple half of the where
 * language, and every store guarantee was written beside it: upserts, keys, timeouts, error
 * classification, backups. The postgres side talks to `pg` itself.
 */

// the line counts against the typeorm side were dropped once the replacement had paid for itself:
// what the data layer gained since (the migration generator, relation reconciliation) is new
// functionality, and comparing it to what typeorm weighed said nothing about it

const packagesDir: string = path.resolve(__dirname, '..', '..', '..');

/**
 * Finds the TypeScript files under a directory of the repository, tests included.
 * @param dir - The directory, relative to `packages`.
 * @returns The files, relative to `packages`.
 */
function findTypeScriptFiles(dir: string): string[] {
    return SourceImportUtilities.findFiles(packagesDir, dir, file => /\.tsx?$/.test(file));
}

describe('the data layer', () => {
    // typeorm described every property a second time and was bypassed for every guarantee a
    // store gives
    it('imports no ORM, in any package', () => {
        const importing: string[] = ['zibri/src', 'testing/src', 'sandbox/src', 'cli/src']
            .flatMap(dir => findTypeScriptFiles(dir))
            // this file, whose pattern below names what it looks for. A group in the pattern kept it from
            // matching itself, until the linter removed the group as useless
            .filter(file => path.join(packagesDir, file) !== __filename)
            .filter(file => /from 'typeorm|require\('typeorm/.test(readFileSync(path.join(packagesDir, file), 'utf8')));

        expect(importing).toEqual([]);
    });

    it('lists no ORM in any manifest', () => {
        const listing: string[] = ['zibri', 'testing', 'sandbox', 'cli', 'tsx']
            .filter(name => {
                const manifest: Record<string, Record<string, string> | undefined> = JsonUtilities.parse(
                    readFileSync(path.join(packagesDir, name, 'package.json'), 'utf8')
                );
                return ['dependencies', 'devDependencies', 'peerDependencies']
                    .some(field => manifest[field]?.['typeorm'] != undefined);
            });

        expect(listing).toEqual([]);
    });

    // every data source built its repositories and declared its stream batch and idle timeout
    // itself, and the in-memory driver's batch had drifted from the others' once already
    it('builds the repositories of every data source, and declares their defaults, in one place', () => {
        const sources: [string, string][] = ['zibri/src', 'testing/src']
            .flatMap(dir => findTypeScriptFiles(dir))
            .filter(file => !/\.(test|cases)\.ts$/.test(file))
            .map(file => [file, readFileSync(path.join(packagesDir, file), 'utf8')]);
        const declaring: (pattern: RegExp) => string[] = pattern => sources
            .filter(([, text]) => pattern.test(text))
            .map(([file]) => file);

        expect({
            building: declaring(/new SoftDeleteRepository\(/),
            streamBatchSize: declaring(/\bSTREAM_BATCH_SIZE: number =/),
            idleTimeout: declaring(/\bDEFAULT_TRANSACTION_IDLE_TIMEOUT_IN_MS: number =/)
        }).toEqual({
            building: ['zibri/src/data-source/repository/repository-for.utilities.ts'],
            streamBatchSize: ['zibri/src/data-source/driver/repository-driver.interface.ts'],
            idleTimeout: ['zibri/src/data-source/data-sources/data-source.interface.ts']
        });
    });
});