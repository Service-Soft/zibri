import { afterAll, beforeAll } from '@jest/globals';

import { describePartialUniqueUpsert, Slot } from './partial-unique-upsert.cases';
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
    entities: [...defaultTestServerEntities, Slot]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Slot]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Slot>;
let valKey: Repository<Slot>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Slot);
    valKey = inject(valKeyDataSourceClass).getRepository(Slot);
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describePartialUniqueUpsert('postgres', () => postgres);

describePartialUniqueUpsert('valkey', () => valKey);