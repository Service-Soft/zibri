import { afterAll, beforeAll } from '@jest/globals';

import { Account, describeScopedRelations, Invoice, Project, ScopedRelationRepositories, scopedRelationEntities, Tag, Task } from './scoped-relations.cases';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { TestTimeouts } from '../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { Change } from '../../change-sets/models/change.model';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ...scopedRelationEntities],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, ChangeSet, Change, ...scopedRelationEntities]
});

let server: StartedTestServer | undefined;
let postgres: ScopedRelationRepositories;
let valKey: ScopedRelationRepositories;

/**
 * Reads the repositories the cases run against off one data source.
 * @param dataSource - The started data source.
 * @returns Its repositories.
 */
function repositoriesOf(dataSource: DataSourceInterface): ScopedRelationRepositories {
    return {
        accounts: dataSource.getRepository(Account),
        invoices: dataSource.getRepository(Invoice),
        tags: dataSource.getRepository(Tag),
        projects: dataSource.getRepository(Project),
        tasks: dataSource.getRepository(Task)
    };
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = repositoriesOf(inject(postgresDataSourceClass));
    valKey = repositoriesOf(inject(valKeyDataSourceClass));
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeScopedRelations('postgres', () => postgres);

describeScopedRelations('valkey', () => valKey);