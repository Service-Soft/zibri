import { afterAll, beforeAll } from 'vitest';

import { MigrationEntity } from './migration-entity.model.ts';
import { Migration } from './migration.model.ts';
import { createUpgradeGizmoMigration, describeMovedEntities, firstVersionEntities, secondVersionEntities, seedFirstVersion } from './moved-entities.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';

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