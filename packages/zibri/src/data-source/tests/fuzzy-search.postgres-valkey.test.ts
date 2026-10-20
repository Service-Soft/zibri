import { afterAll, beforeAll } from 'vitest';
import { StartedTestServer } from 'zibri-testing';

import { Contact, describeFuzzySearch } from './fuzzy-search.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';
import { Repository } from '../repository/repository.ts';

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
}, 45000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

// postgres answers these from a trigram index and valkey by comparing in process, so running the
// same cases against both is what holds the index to the answer the framework's own similarity gives
describeFuzzySearch('postgres', () => postgres);

describeFuzzySearch('valkey', () => valKey);