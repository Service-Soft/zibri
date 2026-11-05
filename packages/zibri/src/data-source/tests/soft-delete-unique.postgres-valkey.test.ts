import { afterAll, beforeAll } from '@jest/globals';

import { describeSoftDeleteUnique, LiveAccount, LiveMember, softDeleteUniqueEntities, SoftDeleteUniqueRepositories } from './soft-delete-unique.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { ChangeSet } from '../change-sets/models/change-set.model';
import { Change } from '../change-sets/models/change.model';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ...softDeleteUniqueEntities],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, ChangeSet, Change, ...softDeleteUniqueEntities]
});

let server: StartedTestServer | undefined;

/**
 * Reads the repositories of one data source.
 * @param dataSource - The data source.
 * @returns Its repositories.
 */
function repositoriesOf(dataSource: DataSourceInterface): SoftDeleteUniqueRepositories {
    return {
        accounts: dataSource.getRepository(LiveAccount),
        members: dataSource.getRepository(LiveMember)
    };
}

let postgres: SoftDeleteUniqueRepositories;
let valKey: SoftDeleteUniqueRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = repositoriesOf(inject(postgresDataSourceClass));
    valKey = repositoriesOf(inject(valKeyDataSourceClass));
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeSoftDeleteUnique('postgres', () => postgres);

describeSoftDeleteUnique('valkey', () => valKey);