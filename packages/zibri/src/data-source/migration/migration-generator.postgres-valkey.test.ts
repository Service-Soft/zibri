import { afterAll, beforeAll, describe } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { MigrationEntity } from './migration-entity.model';
import { describeGeneratedMigrations, firstVersionEntities, GeneratedMigrations, generateMigrations, loadGeneratedMigration, secondVersionEntities } from './migration-generator.cases';
import { Migration } from './migration.model';
import { TestServerTimeouts, TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';

const timeouts: TestServerTimeouts = TestTimeouts.resolveCombined('inMemory', 'postgres', 'valKey');

// the framework's own entities, in a data source of their own that needs no container
const frameworkDataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

// changed in place by the restarts below, so that each version starts on the same data source classes -
// and so on the same containers, which belong to the classes
const postgresEntities: Newable<BaseEntity>[] = [MigrationEntity, ...firstVersionEntities];
const postgresMigrations: Newable<Migration>[] = [];
const valKeyEntities: Newable<BaseEntity>[] = [MigrationEntity, ...firstVersionEntities];
const valKeyMigrations: Newable<Migration>[] = [];

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: postgresEntities,
    schemaManagement: 'migrations',
    migrations: postgresMigrations,
    allowOrphan: true
});
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: valKeyEntities,
    migrations: valKeyMigrations,
    allowOrphan: true
});

const postgresGenerated: GeneratedMigrations = generateMigrations(postgresDataSourceClass.name);
const valKeyGenerated: GeneratedMigrations = generateMigrations(valKeyDataSourceClass.name);

/**
 * The migrations of one data source, loaded.
 */
type LoadedMigrations = {
    first: Newable<Migration>,
    second: Newable<Migration>
};

const postgresLoaded: LoadedMigrations = {
    first: loadGeneratedMigration(postgresGenerated.first, postgresDataSourceClass),
    second: loadGeneratedMigration(postgresGenerated.second, postgresDataSourceClass)
};
const valKeyLoaded: LoadedMigrations = {
    first: loadGeneratedMigration(valKeyGenerated.first, valKeyDataSourceClass),
    second: loadGeneratedMigration(valKeyGenerated.second, valKeyDataSourceClass)
};

let server: StartedTestServer | undefined;

/**
 * Starts an application of its own for the cases of one data source.
 *
 * Of its own because the versions declare different classes under one name (`GenLabel`), and one
 * application refuses that: a data source moved to the second version next to one still on the first
 * would not start.
 * @param dataSourceClass - The data source.
 * @param migrations - Its migrations, which start with the first one.
 * @param first - The migration creating the first version.
 */
function startServerFor(dataSourceClass: Newable<DataSourceInterface>, migrations: Newable<Migration>[], first: Newable<Migration>): void {
    beforeAll(async () => {
        migrations.push(first);
        server = await startTestServer({ dataSources: [frameworkDataSourceClass, dataSourceClass] });
    }, timeouts.start);

    afterAll(async () => {
        await server?.shutdown();
        server = undefined;
    }, timeouts.shutdown);
}

async function restartAs(entities: Newable<BaseEntity>[], migrations: Newable<Migration>[], version: { entities: Newable<BaseEntity>[], migrations: Newable<Migration>[] }): Promise<void> {
    entities.splice(1, entities.length - 1, ...version.entities);
    migrations.splice(0, migrations.length, ...version.migrations);
    await server?.reInit();
}

describe('postgres', () => {
    startServerFor(postgresDataSourceClass, postgresMigrations, postgresLoaded.first);

    describeGeneratedMigrations('postgres', {
        dataSourceOf: () => inject(postgresDataSourceClass),
        restartAsSecondVersion: async () => await restartAs(
            postgresEntities,
            postgresMigrations,
            { entities: secondVersionEntities, migrations: [postgresLoaded.first, postgresLoaded.second] }
        ),
        restartAsFirstVersion: async () => await restartAs(postgresEntities, postgresMigrations, { entities: firstVersionEntities, migrations: [postgresLoaded.first] }),
        migrations: () => postgresGenerated
    });
});

describe('valkey', () => {
    startServerFor(valKeyDataSourceClass, valKeyMigrations, valKeyLoaded.first);

    describeGeneratedMigrations('valkey', {
        dataSourceOf: () => inject(valKeyDataSourceClass),
        restartAsSecondVersion: async () => await restartAs(
            valKeyEntities,
            valKeyMigrations,
            { entities: secondVersionEntities, migrations: [valKeyLoaded.first, valKeyLoaded.second] }
        ),
        restartAsFirstVersion: async () => await restartAs(valKeyEntities, valKeyMigrations, { entities: firstVersionEntities, migrations: [valKeyLoaded.first] }),
        migrations: () => valKeyGenerated
    });
});