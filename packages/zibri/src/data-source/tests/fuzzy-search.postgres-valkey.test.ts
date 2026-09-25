import { afterAll, beforeAll } from '@jest/globals';
import { StartedTestServer } from 'zibri-testing';

import { Contact, describeFuzzySearch } from './fuzzy-search.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Contact]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Contact]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Contact>;
let valKey: Repository<Contact>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Contact);
    valKey = inject(valKeyDataSourceClass).getRepository(Contact);
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

// postgres answers these from a trigram index and valkey by comparing in process, so running the
// same cases against both is what holds the index to the answer the framework's own similarity gives
describeFuzzySearch('postgres', () => postgres);

describeFuzzySearch('valkey', () => valKey);