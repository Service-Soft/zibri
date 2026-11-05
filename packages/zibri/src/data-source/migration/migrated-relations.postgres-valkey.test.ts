import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { createRelatedTablesMigration, createRemoveGenresMigration, describeMigratedRelations, relatedEntities } from './migrated-relations.cases';
import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';
import { TestServerTimeouts, TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';

const timeouts: TestServerTimeouts = TestTimeouts.resolveCombined('inMemory', 'postgres', 'valKey');

// the framework's own entities, in a data source of their own that needs no container
const frameworkDataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

// added to by the restarts below, which run the next migration on the same containers
const postgresMigrations: Newable<Migration>[] = [];
const valKeyMigrations: Newable<Migration>[] = [];

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [MigrationEntity, ...relatedEntities],
    schemaManagement: 'migrations',
    migrations: postgresMigrations,
    allowOrphan: true
});
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, ...relatedEntities],
    migrations: valKeyMigrations,
    allowOrphan: true
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    postgresMigrations.push(createRelatedTablesMigration(postgresDataSourceClass));
    valKeyMigrations.push(createRelatedTablesMigration(valKeyDataSourceClass));
    server = await startTestServer({ dataSources: [frameworkDataSourceClass, postgresDataSourceClass, valKeyDataSourceClass] });
}, timeouts.start);

afterAll(async () => {
    await server?.shutdown();
}, timeouts.shutdown);

describeMigratedRelations('postgres', {
    dataSourceOf: () => inject(postgresDataSourceClass),
    restartRemovingGenres: async () => {
        postgresMigrations.push(createRemoveGenresMigration(postgresDataSourceClass));
        await server?.reInit();
    }
});

describeMigratedRelations('valkey', {
    dataSourceOf: () => inject(valKeyDataSourceClass),
    restartRemovingGenres: async () => {
        valKeyMigrations.push(createRemoveGenresMigration(valKeyDataSourceClass));
        await server?.reInit();
    }
});