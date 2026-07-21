import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { generateEntityFiles } from './generate-entity-files.function';
import { testFileFolder } from '../../__testing__/constants';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';

// A schema rich enough to exercise multiple property-type branches through the full cwd -> ts-node ->
// require() -> disk pipeline, not just the pure generateEntityFilesForProvider() logic (that deeper,
// per-property-type branch coverage — including the known "enum properties get no @Property enum
// validation" gap, see the "handle enums in entity generation" comment in
// generate-entity-file.function.ts — lives in generate-entity-files-for-provider.test.ts).
const richProviderSchema: string = `
    openapi: '3.1.0',
    info: { title: 'test', version: '1.0' },
    components: {
        schemas: {
            Thing: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    status: { type: 'string', enum: ['active', 'inactive'] },
                    createdAt: { type: 'string', format: 'date-time' },
                    tags: { type: 'array', items: { type: 'string' } }
                },
                required: ['name', 'status', 'createdAt', 'tags']
            }
        }
    },
    paths: {}
`;

describe('generateEntityFiles', () => {
    let workDir: FsPath;
    let generatedDir: FsPath;
    let originalCwd: FsPath;

    beforeEach(async () => {
        // generateEntityFiles reads from/writes to paths relative to `process.cwd()` with no path
        // parameter of its own, so — same approach as generate-source-xlf.function.test.ts — the cwd is
        // redirected into a fresh scratch directory per test. A unique dir per test also sidesteps
        // Node's require() module cache, which is keyed by absolute path and would otherwise return a
        // stale, previously-required providers.ts across tests.
        workDir = FsUtilities.getPath(testFileFolder, `generate-entity-files-${Date.now()}-${Math.random().toString(36)
            .slice(2)}`);
        generatedDir = FsUtilities.getPath(workDir, 'src/models/generated');
        await FsUtilities.mkdir(generatedDir);
        originalCwd = process.cwd() as FsPath;
        process.chdir(workDir);
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        await FsUtilities.rm(workDir);
    });

    it(
        'resolves providers.ts via ts-node, writes entity files + a per-provider index.ts + the top-level '
        // eslint-disable-next-line cspell/spellchecker
        + 'index.ts to disk, and correctly transpiles string/enum/date/array property types along the way',
        async () => {
            await FsUtilities.createFile(
                FsUtilities.getPath(generatedDir, 'providers.ts'),
                `export const providers = [{
                    prefix: 'Simple',
                    generateSchemasFromPaths: true,
                    markAsEntities: true,
                    resolveSpec: async () => ({ ${richProviderSchema} })
                }];`
            );

            await generateEntityFiles();

            const topIndex: string = await FsUtilities.readFile(FsUtilities.getPath(generatedDir, 'index.ts'));
            expect(topIndex).toContain('export * from \'./simple\';');

            const providerIndex: string = await FsUtilities.readFile(FsUtilities.getPath(generatedDir, 'simple/index.ts'));
            expect(providerIndex).toContain('export * from \'./simple.thing.model\';');

            const entityFile: string = await FsUtilities.readFile(FsUtilities.getPath(generatedDir, 'simple/simple.thing.model.ts'));
            expect(entityFile).toContain('@Entity()');
            expect(entityFile).toContain('export class SimpleThing');
            expect(entityFile).toContain('\'name\'!: string;');
            expect(entityFile).toContain('\'status\'!: \'active\' | \'inactive\';');
            expect(entityFile).toContain('\'createdAt\'!: Date;');
            expect(entityFile).toContain('\'tags\'!: string[];');
            expect(entityFile).toContain('@Property.date()');
            expect(entityFile).toContain('@Property.array({ items: { type: \'string\' } })');
        },
        15000
    );

    it('aggregates multiple providers from one providers.ts file into the top-level index.ts, in order', async () => {
        await FsUtilities.createFile(
            FsUtilities.getPath(generatedDir, 'providers.ts'),
            `export const providers = [
                {
                    prefix: 'First',
                    generateSchemasFromPaths: true,
                    markAsEntities: true,
                    resolveSpec: async () => ({ ${richProviderSchema} })
                },
                {
                    prefix: 'Second',
                    generateSchemasFromPaths: true,
                    markAsEntities: true,
                    resolveSpec: async () => ({ ${richProviderSchema} })
                }
            ];`
        );

        await generateEntityFiles();

        const topIndex: string = await FsUtilities.readFile(FsUtilities.getPath(generatedDir, 'index.ts'));
        const lines: string[] = topIndex.split('\n').filter(l => l.trim().length > 0);
        expect(lines).toEqual(['export * from \'./first\';', 'export * from \'./second\';']);

        expect(await FsUtilities.exists(FsUtilities.getPath(generatedDir, 'first/first.thing.model.ts'))).toBe(true);
        expect(await FsUtilities.exists(FsUtilities.getPath(generatedDir, 'second/second.thing.model.ts'))).toBe(true);
    }, 15000);

    it('resolves providers from a default export when no named "providers" export exists', async () => {
        await FsUtilities.createFile(
            FsUtilities.getPath(generatedDir, 'providers.ts'),
            `export default [{
                prefix: 'Defaulted',
                generateSchemasFromPaths: true,
                markAsEntities: true,
                resolveSpec: async () => ({ ${richProviderSchema} })
            }];`
        );

        await generateEntityFiles();

        const topIndex: string = await FsUtilities.readFile(FsUtilities.getPath(generatedDir, 'index.ts'));
        expect(topIndex).toContain('export * from \'./defaulted\';');
    }, 15000);

    it('throws when the resolved export is not an array', async () => {
        await FsUtilities.createFile(
            FsUtilities.getPath(generatedDir, 'providers.ts'),
            'export const providers = { notAnArray: true };'
        );

        await expect(generateEntityFiles()).rejects.toThrow('Expected \'providers\' (or default export) to be an array');
    }, 15000);

    it('does nothing when the resolved providers file is not a .ts file', async () => {
        await FsUtilities.createFile(FsUtilities.getPath(generatedDir, 'providers.js'), '');

        await expect(generateEntityFiles()).resolves.toBeUndefined();
        expect(await FsUtilities.exists(FsUtilities.getPath(generatedDir, 'index.ts'))).toBe(false);
    }, 15000);

    it('rejects when no providers file can be found', async () => {
        await expect(generateEntityFiles()).rejects.toThrow();
    }, 15000);
});