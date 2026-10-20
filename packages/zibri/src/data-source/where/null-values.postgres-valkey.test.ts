import { afterAll, beforeAll } from 'vitest';

import { describeNullValues, Tag } from './null-values.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';
import { Repository } from '../repository/repository.ts';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Tag]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Tag]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Tag>;
let valKey: Repository<Tag>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Tag);
    valKey = inject(valKeyDataSourceClass).getRepository(Tag);
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeNullValues('postgres', () => postgres);

describeNullValues('valkey', () => valKey);