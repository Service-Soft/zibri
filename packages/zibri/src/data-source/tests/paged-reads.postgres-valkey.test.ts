import { afterAll, beforeAll } from '@jest/globals';

import { describePagedReads, PagedCustomer, PagedLine, PagedOrder, pagedReadEntities, PagedReadRepositories } from './paged-reads.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ...pagedReadEntities],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, ...pagedReadEntities]
});

let server: StartedTestServer | undefined;
let postgres: PagedReadRepositories;
let valKey: PagedReadRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = {
        customers: inject(postgresDataSourceClass).getRepository(PagedCustomer),
        orders: inject(postgresDataSourceClass).getRepository(PagedOrder),
        lines: inject(postgresDataSourceClass).getRepository(PagedLine)
    };
    valKey = {
        customers: inject(valKeyDataSourceClass).getRepository(PagedCustomer),
        orders: inject(valKeyDataSourceClass).getRepository(PagedOrder),
        lines: inject(valKeyDataSourceClass).getRepository(PagedLine)
    };
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describePagedReads('postgres', () => postgres);

describePagedReads('valkey', () => valKey);