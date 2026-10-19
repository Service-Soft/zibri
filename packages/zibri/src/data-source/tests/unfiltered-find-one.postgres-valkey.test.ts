import { afterAll, beforeAll } from '@jest/globals';

import { describeUnfilteredFindOne, SingleRow } from './unfiltered-find-one.cases';
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
    entities: [...defaultTestServerEntities, SingleRow]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, SingleRow]
});

let server: StartedTestServer | undefined;
let postgres: Repository<SingleRow>;
let valKey: Repository<SingleRow>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(SingleRow);
    valKey = inject(valKeyDataSourceClass).getRepository(SingleRow);
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeUnfilteredFindOne('postgres', () => postgres);

describeUnfilteredFindOne('valkey', () => valKey);