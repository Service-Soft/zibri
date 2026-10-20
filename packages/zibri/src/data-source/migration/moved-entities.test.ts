import { afterAll, beforeAll } from 'vitest';
import { InMemoryDataSource } from 'zibri-testing';

import { Migration } from './migration.model.ts';
import { createUpgradeGizmoMigration, describeMovedEntities, firstVersionEntities, secondVersionEntities, seedFirstVersion } from './moved-entities.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { DataSource } from '../decorators/data-source.decorator.ts';

// changed in place by the upgrade below, so that the second version starts on the same data source
// class - and so on the same store, which belongs to the class
const entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ...firstVersionEntities];
const migrations: Newable<Migration>[] = [];

/**
 * The data source of both versions.
 */
@DataSource()
class GizmoDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = entities;
    override readonly migrations: Newable<Migration>[] = migrations;
}

const upgradeGizmoMigration: Newable<Migration> = createUpgradeGizmoMigration(GizmoDataSource);

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [GizmoDataSource] });
    await seedFirstVersion(inject(GizmoDataSource));

    entities.splice(defaultTestServerEntities.length, firstVersionEntities.length, ...secondVersionEntities);
    migrations.push(upgradeGizmoMigration);
    await server.reInit();
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeMovedEntities('the in memory data source', () => inject(GizmoDataSource));