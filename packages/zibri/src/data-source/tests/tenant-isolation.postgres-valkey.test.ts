import { afterAll, beforeAll } from 'vitest';

import { describeTenantIsolation, TenantIsolationRepositories, TenantNote, TenantNotice, TenantProject, TenantTask } from './tenant-isolation.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';

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
        dataSource: postgresDataSource,
        notes: postgresDataSource.getRepository(TenantNote),
        notices: postgresDataSource.getRepository(TenantNotice),
        projects: postgresDataSource.getRepository(TenantProject),
        tasks: postgresDataSource.getRepository(TenantTask)
    };
    valKey = {
        dataSource: valKeyDataSource,
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