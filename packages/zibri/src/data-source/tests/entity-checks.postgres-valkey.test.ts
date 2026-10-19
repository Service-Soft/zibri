import { afterAll, beforeAll } from '@jest/globals';

import { Chore, describeEntityChecks } from './entity-checks.cases';
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
    entities: [...defaultTestServerEntities, Chore]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Chore]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Chore>;
let valKey: Repository<Chore>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Chore);
    valKey = inject(valKeyDataSourceClass).getRepository(Chore);
}, 60000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeEntityChecks('postgres', () => postgres);

describeEntityChecks('valkey', () => valKey);