import { afterAll, beforeAll } from '@jest/globals';

import { describeUpsertAll, Tally } from './upsert-all.cases';
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
    entities: [...defaultTestServerEntities, Tally]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Tally]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Tally>;
let valKey: Repository<Tally>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Tally);
    valKey = inject(valKeyDataSourceClass).getRepository(Tally);
}, 60000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeUpsertAll('postgres', () => postgres);

describeUpsertAll('valkey', () => valKey);