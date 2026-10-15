import { afterAll, beforeAll } from '@jest/globals';

import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';
import { createUpgradeGizmoMigration, describeMovedEntities, firstVersionEntities, secondVersionEntities, seedFirstVersion } from './moved-entities.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';

// changed in place by the upgrade below, so that the second version starts on the same data source
// classes - and so on the same containers, which belong to the classes
const postgresEntities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ...firstVersionEntities];
const postgresMigrations: Newable<Migration>[] = [];
const valKeyEntities: Newable<BaseEntity>[] = [MigrationEntity, ...firstVersionEntities];
const valKeyMigrations: Newable<Migration>[] = [];

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: postgresEntities,
    migrations: postgresMigrations
});
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: valKeyEntities,
    migrations: valKeyMigrations
});

const postgresMigration: Newable<Migration> = createUpgradeGizmoMigration(postgresDataSourceClass);
const valKeyMigration: Newable<Migration> = createUpgradeGizmoMigration(valKeyDataSourceClass);

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    await seedFirstVersion(inject(postgresDataSourceClass));
    await seedFirstVersion(inject(valKeyDataSourceClass));

    for (const entities of [postgresEntities, valKeyEntities]) {
        entities.splice(entities.length - firstVersionEntities.length, firstVersionEntities.length, ...secondVersionEntities);
    }
    postgresMigrations.push(postgresMigration);
    valKeyMigrations.push(valKeyMigration);
    await server.reInit();
}, 60000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeMovedEntities('postgres', () => inject(postgresDataSourceClass));

describeMovedEntities('valkey', () => inject(valKeyDataSourceClass));