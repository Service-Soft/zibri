import { afterAll, beforeAll } from '@jest/globals';

import { Book, describeCreatedRelations, Plaque, Shelf } from './created-relations.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Shelf, Book, Plaque],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Shelf, Book, Plaque]
});

let server: StartedTestServer | undefined;
let postgres: Repository<Shelf>;
let valKey: Repository<Shelf>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(Shelf);
    valKey = inject(valKeyDataSourceClass).getRepository(Shelf);
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeCreatedRelations('postgres', () => postgres);

describeCreatedRelations('valkey', () => valKey);