import { afterAll, beforeAll } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { Migration } from './migration.model';
import { createUpgradeGizmoMigration, describeMovedEntities, firstVersionEntities, secondVersionEntities, seedFirstVersion } from './moved-entities.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { DataSource } from '../decorators/data-source.decorator';
import { RepositoryClass } from '../repository/repository-class.type';

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
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
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
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeMovedEntities('the in memory data source', () => inject(GizmoDataSource));