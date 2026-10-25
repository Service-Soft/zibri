import { afterAll, beforeAll } from '@jest/globals';

import { MigrationEntity } from './migration-entity.model';
import { Badge, describeMigrationHelpers, Gadget } from './migration-helpers.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Gadget, Badge],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Gadget, Badge]
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeMigrationHelpers('postgres', () => {
    const dataSource: PostgresDataSource = inject(postgresDataSourceClass);
    return { dataSource, gadgets: dataSource.getRepository(Gadget), badges: dataSource.getRepository(Badge) };
});

describeMigrationHelpers('valkey', () => {
    const dataSource: ValKeyDataSource = inject(valKeyDataSourceClass);
    return { dataSource, gadgets: dataSource.getRepository(Gadget), badges: dataSource.getRepository(Badge) };
});