import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import ts from 'typescript';
import { InMemoryDataSource } from 'zibri-testing';

import { EntitySnapshot } from './entity-snapshot.model';
import { EntitySnapshotUtilities } from './entity-snapshot.utilities';
import { DATA_SOURCE_IMPORT, describeGeneratedMigrations, firstVersionEntities, GeneratedMigrations, generateMigrations, GenNote, loadGeneratedMigration, secondVersionEntities } from './migration-generator.cases';
import { GeneratedMigration, MigrationGeneratorUtilities } from './migration-generator.utilities';
import { Migration } from './migration.model';
import { testFileFolder, TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { DataSource } from '../decorators/data-source.decorator';
import { RepositoryClass } from '../repository/repository-class.type';

/**
 * The note of the first version, with a text no two notes share.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'gen_note' })
class GenNoteWithUniqueText extends BaseEntity {
    /**
     * What it says.
     */
    @Property.string({ unique: true })
    text!: string;
}

/**
 * The entities of a version, with the note whose text is unique.
 * @param versionEntities - The entities of the version.
 * @returns The entities, with that note in place of the other.
 */
function withUniqueNoteText(versionEntities: Newable<BaseEntity>[]): Newable<BaseEntity>[] {
    return versionEntities.map(e => e === GenNote ? GenNoteWithUniqueText : e);
}

// changed in place by the restarts below, so that each version starts on the same data source class -
// and so on the same store, which belongs to the class
const entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ...firstVersionEntities];
const migrations: Newable<Migration>[] = [];

/**
 * The data source of both versions.
 */
@DataSource()
class GeneratedDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = entities;
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    override readonly migrations: Newable<Migration>[] = migrations;
}

const generated: GeneratedMigrations = generateMigrations(GeneratedDataSource.name);
const first: Newable<Migration> = loadGeneratedMigration(generated.first, GeneratedDataSource);
const second: Newable<Migration> = loadGeneratedMigration(generated.second, GeneratedDataSource);

let server: StartedTestServer | undefined;

beforeAll(async () => {
    migrations.push(first);
    server = await startTestServer({ dataSources: [GeneratedDataSource] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describe('the code of generated migrations', () => {
    let workDir: string;

    beforeAll(() => {
        workDir = path.join(testFileFolder, `generated-migrations-${UUIDUtilities.generate()}`);
        mkdirSync(workDir, { recursive: true });
    });

    afterAll(() => {
        rmSync(workDir, { recursive: true, force: true });
    });

    it('compiles in a project, against the helpers this version of the package has', () => {
        mkdirSync(path.join(workDir, 'migrations'));
        writeFileSync(
            path.join(workDir, 'generated.data-source.ts'),
            `import { DataSourceInterface, Newable } from 'zibri';\n\nexport declare const ${GeneratedDataSource.name}: Newable<DataSourceInterface>;\n`
        );
        const files: string[] = [generated.first, generated.second].map(m => {
            const filePath: string = path.join(workDir, 'migrations', m.fileName);
            writeFileSync(filePath, m.code);
            return filePath;
        });
        const program: ts.Program = ts.createProgram(files, {
            // what `zi new` scaffolds, the project a generated migration is written into
            strict: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            esModuleInterop: true,
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ES2022,
            skipLibCheck: true,
            noEmit: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            baseUrl: __dirname,
            paths: { zibri: [path.join(__dirname, '..', '..', 'index.ts')] }
        });

        const errors: string[] = ts.getPreEmitDiagnostics(program)
            .filter(d => d.file != undefined && files.includes(path.normalize(d.file.fileName)))
            .map(d => `${path.basename(d.file?.fileName ?? '')}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
        expect(errors).toStrictEqual([]);
    }, 120_000);

    it('names a migration by the one change it makes, or by the entities it changes', () => {
        expect(generated.first.className).toBe('CreateGenTablesMigration');
        expect(generated.first.fileName).toBe('create-gen-tables.migration.ts');
        expect(generated.second.className).toBe('UpdateGenLabelAndGenProjectAndMoreMigration');
    });

    it('writes a call that does not fit one line over several, indented as a method body is', () => {
        expect(generated.second.code).toContain([
            '        await this.dataSource.changePropertyOfEntity({',
            '            entity: { tableName: \'gen_task\' },'
        ].join('\n'));
        expect(generated.second.code).toContain('\n        });\n');
    });
});

describe('generating a migration', () => {
    /**
     * A snapshot of one entity, stored in "shelf" with the given properties.
     * @param properties - The properties.
     * @returns The snapshot.
     */
    function shelfWith(properties: EntitySnapshot['entities'][string]['properties']): EntitySnapshot {
        return { dataSource: 'ShelfDataSource', entities: { shelf: { className: 'Shelf', properties } } };
    }

    /**
     * Generates the migration from one snapshot to another.
     * @param previous - The snapshot before.
     * @param current - The snapshot now.
     * @param empty - Whether one is written when nothing changed.
     * @returns The migration, if one is written.
     */
    function generateBetween(previous: EntitySnapshot, current: EntitySnapshot, empty: boolean = false): GeneratedMigration | undefined {
        return MigrationGeneratorUtilities.generate({
            previous,
            current,
            name: undefined,
            takenNames: ['AddLabelToShelfMigration'],
            dataSourceImport: '../shelf.data-source',
            version: '1.0.0',
            empty
        });
    }

    it('adds a required property empty, and makes it required where the developer fills it in', () => {
        const migration: GeneratedMigration | undefined = generateBetween(shelfWith({}), shelfWith({ label: { type: 'string' } }));

        expect(migration?.code).toContain('property: { name: \'label\', type: \'string\', required: false }');
        expect(migration?.code).toContain('fill it in here, before it is required');
        expect(migration?.code).toContain('property: { name: \'label\', type: \'string\' }');
        // the name a migration of the data source has already
        expect(migration?.className).toBe('AddLabelToShelf2Migration');
    });

    it('leaves a change of type without a cast failing until the developer lists what each value becomes', () => {
        const migration: GeneratedMigration | undefined = generateBetween(
            shelfWith({ open: { type: 'boolean' } }),
            shelfWith({ open: { type: 'date' } })
        );

        expect(migration?.code).toContain('boolean has no cast into date');
        expect(migration?.code).toContain('convert: { values: [], default: ValueConversion.NONE }');
        expect(migration?.code).toContain('import { Injectable, Migration, SemVerVersion, Transaction, ValueConversion } from \'zibri\';');
    });

    // the indexes, uniques and checks are kept as the entities declare them once the migrations have
    // run, and without a migration an earlier commit of the same release had nothing to be refused by
    it('writes a migration for a change of the indexes, uniques or checks alone', () => {
        const migration: GeneratedMigration | undefined = generateBetween(
            EntitySnapshotUtilities.resolveSnapshot('ShelfDataSource', [GenNote]),
            EntitySnapshotUtilities.resolveSnapshot('ShelfDataSource', [GenNoteWithUniqueText])
        );

        expect(migration?.className).toBe('ChangeKeysOfGenNoteWithUniqueTextMigration');
        expect(migration?.code).toContain('the rows "gen_note" stores already have to hold to them');
    });

    it('writes nothing when nothing changed, and an empty migration only when asked for one', () => {
        const unchanged: EntitySnapshot = shelfWith({ label: { type: 'string' } });

        expect(generateBetween(unchanged, unchanged)).toBeUndefined();
        const empty: GeneratedMigration | undefined = generateBetween(unchanged, unchanged, true);
        expect(empty?.className).toBe('EmptyMigration');
        expect(empty?.code).toContain('override async up(): Promise<void> {');
    });
});

describeGeneratedMigrations('the in memory data source', {
    dataSourceOf: () => inject(GeneratedDataSource),
    restartAsSecondVersion: async () => {
        entities.splice(defaultTestServerEntities.length, firstVersionEntities.length, ...secondVersionEntities);
        migrations.push(second);
        await server?.reInit();
    },
    restartAsFirstVersion: async () => {
        entities.splice(defaultTestServerEntities.length, secondVersionEntities.length, ...firstVersionEntities);
        migrations.splice(1);
        await server?.reInit();
    },
    migrations: () => generated
});

// after the cases, which end on the first version
describe('a change of the uniques alone', () => {
    it('makes an earlier commit of the same release refuse to start, naming what to revert', async () => {
        const keysChanged: GeneratedMigration | undefined = MigrationGeneratorUtilities.generate({
            previous: EntitySnapshotUtilities.resolveSnapshot(GeneratedDataSource.name, firstVersionEntities),
            current: EntitySnapshotUtilities.resolveSnapshot(GeneratedDataSource.name, withUniqueNoteText(firstVersionEntities)),
            name: undefined,
            takenNames: [generated.first.className],
            dataSourceImport: DATA_SOURCE_IMPORT,
            version: '0.0.1',
            empty: false
        });
        if (keysChanged == undefined) {
            throw new Error('A change of the uniques alone wrote no migration.');
        }
        entities.splice(defaultTestServerEntities.length, firstVersionEntities.length, ...withUniqueNoteText(firstVersionEntities));
        migrations.push(loadGeneratedMigration(keysChanged, GeneratedDataSource));
        await server?.reInit();

        entities.splice(defaultTestServerEntities.length, firstVersionEntities.length, ...firstVersionEntities);
        migrations.splice(1);
        await expect(server?.reInit()).rejects.toThrow(`run "migrate down ${generated.first.className}" with the newer build`);
    }, 2 * TestTimeouts.inMemory.restart);
});