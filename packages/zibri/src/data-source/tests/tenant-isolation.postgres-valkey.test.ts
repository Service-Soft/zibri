import { afterAll, beforeAll } from '@jest/globals';

import { describeTenantIsolation, TenantIsolationRepositories, TenantNote, TenantNotice, TenantProject, TenantTask } from './tenant-isolation.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, TenantNote, TenantNotice, TenantProject, TenantTask]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, TenantNote, TenantNotice, TenantProject, TenantTask]
});

let server: StartedTestServer | undefined;
let postgres: TenantIsolationRepositories;
let valKey: TenantIsolationRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    const postgresDataSource: PostgresDataSource = inject(postgresDataSourceClass);
    const valKeyDataSource: ValKeyDataSource = inject(valKeyDataSourceClass);
    postgres = {
        notes: postgresDataSource.getRepository(TenantNote),
        notices: postgresDataSource.getRepository(TenantNotice),
        projects: postgresDataSource.getRepository(TenantProject),
        tasks: postgresDataSource.getRepository(TenantTask)
    };
    valKey = {
        notes: valKeyDataSource.getRepository(TenantNote),
        notices: valKeyDataSource.getRepository(TenantNotice),
        projects: valKeyDataSource.getRepository(TenantProject),
        tasks: valKeyDataSource.getRepository(TenantTask)
    };
}, 45000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeTenantIsolation('postgres', () => postgres);

describeTenantIsolation('valkey', () => valKey);