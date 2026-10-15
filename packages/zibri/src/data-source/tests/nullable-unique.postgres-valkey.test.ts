import { afterAll, beforeAll } from '@jest/globals';

import { describeNullableUnique, OptionalCode } from './nullable-unique.cases';
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
    entities: [...defaultTestServerEntities, OptionalCode]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, OptionalCode]
});

let server: StartedTestServer | undefined;
let postgres: Repository<OptionalCode>;
let valKey: Repository<OptionalCode>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(OptionalCode);
    valKey = inject(valKeyDataSourceClass).getRepository(OptionalCode);
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeNullableUnique('postgres', () => postgres);

describeNullableUnique('valkey', () => valKey);