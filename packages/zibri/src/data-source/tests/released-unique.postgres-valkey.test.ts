import { afterAll, beforeAll } from '@jest/globals';

import { describeReleasedUnique, Handle } from './released-unique.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Handle]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Handle]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Handle>;
let valKey: Repository<Handle>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Handle);
    valKey = inject(valKeyDataSourceClass).getRepository(Handle);
}, 60000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeReleasedUnique('postgres', () => postgres);

describeReleasedUnique('valkey', () => valKey);