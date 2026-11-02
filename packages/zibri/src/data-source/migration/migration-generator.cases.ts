import { describe, expect, it } from '@jest/globals';
import ts from 'typescript';

import { EntitySnapshot } from './entity-snapshot.model';
import { EntitySnapshotUtilities } from './entity-snapshot.utilities';
import { GeneratedMigration, MigrationGenerationInput, MigrationGeneratorUtilities } from './migration-generator.utilities';
import { Migration } from './migration.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import * as zibri from '../../index';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';

/**
 * Where a generated migration imports the data source from, which loading it hands the class under.
 */
export const DATA_SOURCE_IMPORT: string = '../generated.data-source';

/**
 * The title of the task the cases write in the first version and read back in both.
 */
const TASK_TITLE: string = 'Write the migration';

/**
 * A note, which the second version no longer has.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'gen_note' })
export class GenNote extends BaseEntity {
    /**
     * What it says.
     */
    @Property.string()
    text!: string;
}

/**
 * What a label holds in either version.
 */
export type GenLabelShape = BaseEntity & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    name: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    tasks: GenTaskShape[]
};

/**
 * What a task holds in either version, as far as its labels see it.
 */
type GenTaskShape = BaseEntity & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    labels: GenLabelShape[]
};

/**
 * Builds the label of either version, which the second one stores under another table name.
 * @param tableName - The table it is stored in.
 * @param task - The task of the version.
 * @returns The class, named the same in both versions.
 */
function defineGenLabel(tableName: string, task: () => Newable<GenTaskShape>): Newable<GenLabelShape> {
    /**
     * A label of the tasks.
     */
    @Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName })
    class GenLabel extends BaseEntity {
        /**
         * Its name.
         */
        @Property.string()
        name!: string;

        /**
         * The tasks it is on.
         */
        @Property.manyToMany({ target: task, inverseSide: 'labels', joinTable: false })
        tasks!: GenTaskShape[];
    }
    return GenLabel;
}

/**
 * The label of the first version.
 */
export const GenLabelV1: Newable<GenLabelShape> = defineGenLabel('gen_label', () => GenTaskV1);

/**
 * The label of the second version, stored under another table name.
 */
export const GenLabelV2: Newable<GenLabelShape> = defineGenLabel('gen_tag', () => GenTaskV2);

/**
 * A task of the first version.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'gen_task' })
export class GenTaskV1 extends BaseEntity {
    /**
     * Its title.
     */
    @Property.string({ maxLength: 50 })
    title!: string;

    /**
     * Whether it is done, which the second version no longer stores.
     */
    @Property.boolean()
    done!: boolean;

    /**
     * Its labels, a relation the task owns.
     */
    @Property.manyToMany({ target: () => GenLabelV1, inverseSide: 'tasks', joinTable: true })
    labels!: GenLabelShape[];
}

/**
 * A task of the second version.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'gen_task' })
export class GenTaskV2 extends BaseEntity {
    /**
     * Its title, which may be longer.
     */
    @Property.string({ maxLength: 100 })
    title!: string;

    /**
     * How urgent it is, which the tasks of the first version have none of.
     */
    @Property.number({ format: 'integer', required: false })
    priority?: number | null;

    /**
     * Its labels, a relation the task owns.
     */
    @Property.manyToMany({ target: () => GenLabelV2, inverseSide: 'tasks', joinTable: true })
    labels!: GenLabelShape[];
}

/**
 * A project, which the second version adds.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'gen_project' })
export class GenProject extends BaseEntity {
    /**
     * Its name.
     */
    @Property.string()
    name!: string;
}

/**
 * The entities of the first version.
 */
export const firstVersionEntities: Newable<BaseEntity>[] = [GenTaskV1, GenLabelV1, GenNote];

/**
 * The entities of the second version.
 */
export const secondVersionEntities: Newable<BaseEntity>[] = [GenTaskV2, GenLabelV2, GenProject];

/**
 * The migrations generated from the two versions.
 */
export type GeneratedMigrations = {
    /**
     * The one creating the first version.
     */
    first: GeneratedMigration,
    /**
     * The one bringing the first version to the second.
     */
    second: GeneratedMigration
};

/**
 * Generates the migrations of both versions, as `zi migrate create` does on each.
 * @param dataSourceName - The name of the data source's class.
 * @returns The migrations.
 * @throws When either of them changes nothing.
 */
export function generateMigrations(dataSourceName: string): GeneratedMigrations {
    const firstSnapshot: EntitySnapshot = EntitySnapshotUtilities.resolveSnapshot(dataSourceName, firstVersionEntities);
    const secondSnapshot: EntitySnapshot = EntitySnapshotUtilities.resolveSnapshot(dataSourceName, secondVersionEntities);
    const base: Pick<MigrationGenerationInput, 'dataSourceImport' | 'version' | 'empty'>
        = { dataSourceImport: DATA_SOURCE_IMPORT, version: '0.0.1', empty: false };
    const first: GeneratedMigration | undefined = MigrationGeneratorUtilities.generate({
        ...base,
        previous: undefined,
        current: firstSnapshot,
        name: 'CreateGenTables',
        takenNames: []
    });
    const second: GeneratedMigration | undefined = MigrationGeneratorUtilities.generate({
        ...base,
        // the snapshot as it is committed, and read back
        previous: readBack(firstSnapshot),
        current: secondSnapshot,
        name: undefined,
        takenNames: first == undefined ? [] : [first.className]
    });
    if (first == undefined || second == undefined) {
        throw new Error('A version changed nothing.');
    }
    return { first, second };
}

/**
 * A snapshot written into its file and read back.
 * @param snapshot - The snapshot.
 * @returns What reading it back gives.
 * @throws When what is read back is no snapshot.
 */
function readBack(snapshot: EntitySnapshot): EntitySnapshot {
    const parsed: unknown = JSON.parse(JSON.stringify(snapshot));
    if (!EntitySnapshotUtilities.isSnapshot(parsed)) {
        throw new Error('A snapshot read back is no snapshot.');
    }
    return parsed;
}

/**
 * Loads a generated migration the way the build of an application does, with its imports resolved to
 * this package and the given data source.
 * @param migration - The migration.
 * @param dataSourceClass - The data source it imports.
 * @returns Its class.
 * @throws When the code exports no migration under its name.
 */
export function loadGeneratedMigration(migration: GeneratedMigration, dataSourceClass: Newable<DataSourceInterface>): Newable<Migration> {
    const output: string = ts.transpileModule(migration.code, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            experimentalDecorators: true,
            emitDecoratorMetadata: true
        }
    }).outputText;
    const exported: Record<string, unknown> = {};
    const resolveImport: (id: string) => unknown = id => {
        if (id === 'zibri') {
            return zibri;
        }
        if (id === DATA_SOURCE_IMPORT) {
            return { [dataSourceClass.name]: dataSourceClass };
        }
        throw new Error(`A generated migration imports "${id}".`);
    };
    // a function of this module's context rather than one compiled into another: jest runs every test
    // file in a context of its own, and the decorators read the metadata api of the one they run in
    // eslint-disable-next-line typescript/no-implied-eval
    const load: Function = new Function('require', 'exports', output);
    Reflect.apply(load, undefined, [resolveImport, exported]);
    const res: unknown = exported[migration.className];
    if (!isMigrationClass(res)) {
        throw new Error(`The generated code exports no migration "${migration.className}".`);
    }
    return res;
}

/**
 * Whether a value is the class of a migration.
 * @param value - The value.
 * @returns True for a class extending Migration.
 */
function isMigrationClass(value: unknown): value is Newable<Migration> {
    return typeof value === 'function' && value.prototype instanceof Migration;
}

/**
 * What the cases run against.
 */
type GeneratedMigrationsTarget = {
    /**
     * Reads the data source, started as the first version with the first migration.
     */
    dataSourceOf: () => DataSourceInterface,
    /**
     * Starts the application again as the second version, with both migrations.
     */
    restartAsSecondVersion: () => Promise<void>,
    /**
     * Starts the application again as the first version, with its migration only.
     */
    restartAsFirstVersion: () => Promise<void>,
    /**
     * The migrations, loaded.
     */
    migrations: () => GeneratedMigrations
};

/**
 * Runs every case against generated migrations on one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param target - The data source, and how to start it as either version.
 */
export function describeGeneratedMigrations(dataSourceName: string, target: GeneratedMigrationsTarget): void {
    // a migration was written by hand for every change of an entity,
    // with nothing comparing what it says to what the entities declare
    describe(`migrations generated from two versions of the entities, on ${dataSourceName}`, () => {
        it('create the first version, whose relations hold', async () => {
            const dataSource: DataSourceInterface = target.dataSourceOf();
            const labels: GenLabelShape[] = await dataSource.getRepository(GenLabelV1)
                .createAll([{ name: 'urgent', tasks: [] }, { name: 'home', tasks: [] }]);
            await dataSource.getRepository(GenTaskV1).create({ title: TASK_TITLE, done: false, labels });
            await dataSource.getRepository(GenNote).create({ text: 'remember the milk' });

            const task: GenTaskV1 = await dataSource.getRepository(GenTaskV1)
                .findOne({ where: { title: TASK_TITLE }, relations: ['labels'] });
            expect(task.labels.map(l => l.name).sort()).toStrictEqual(['home', 'urgent']);
        });

        it('bring it to the second version, keeping what both versions store', async () => {
            await target.restartAsSecondVersion();
            const dataSource: DataSourceInterface = target.dataSourceOf();

            const task: GenTaskV2 = await dataSource.getRepository(GenTaskV2)
                .findOne({ where: { title: TASK_TITLE }, relations: ['labels'] });
            expect([task.priority ?? undefined, task.labels.map(l => l.name).sort()]).toStrictEqual([undefined, ['home', 'urgent']]);
            await dataSource.getRepository(GenProject).create({ name: 'Migrations' });
            expect((await dataSource.getRepository(GenProject).findAll({ limit: 'all' })).map(p => p.name)).toStrictEqual(['Migrations']);
        });

        // last, since it ends on the first version
        it('go back to the first version by the name of its migration, keeping what both versions store', async () => {
            await target.dataSourceOf().revertMigrationsAfter({ migrationName: target.migrations().first.className });
            await target.restartAsFirstVersion();
            const dataSource: DataSourceInterface = target.dataSourceOf();

            const task: GenTaskV1 = await dataSource.getRepository(GenTaskV1)
                .findOne({ where: { title: TASK_TITLE }, relations: ['labels'] });
            expect(task.labels.map(l => l.name).sort()).toStrictEqual(['home', 'urgent']);
            // what the second version removed comes back empty
            expect(await dataSource.getRepository(GenNote).findAll({ limit: 'all' })).toStrictEqual([]);
        });
    });
}