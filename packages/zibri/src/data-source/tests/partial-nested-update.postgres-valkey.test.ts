import { afterAll, beforeAll } from 'vitest';

import { describePartialNestedUpdate, Label, Organizer, PartialNestedUpdateRepositories, Venue } from './partial-nested-update.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Venue, Organizer, Label]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Venue, Organizer, Label]
});

let server: StartedTestServer | undefined;
let postgres: PartialNestedUpdateRepositories;
let valKey: PartialNestedUpdateRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    const postgresDataSource: PostgresDataSource = inject(postgresDataSourceClass);
    postgres = {
        venues: postgresDataSource.getRepository(Venue),
        organizers: postgresDataSource.getRepository(Organizer),
        labels: postgresDataSource.getRepository(Label)
    };
    const valKeyDataSource: ValKeyDataSource = inject(valKeyDataSourceClass);
    valKey = {
        venues: valKeyDataSource.getRepository(Venue),
        organizers: valKeyDataSource.getRepository(Organizer),
        labels: valKeyDataSource.getRepository(Label)
    };
}, 60000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describePartialNestedUpdate('postgres', () => postgres);

describePartialNestedUpdate('valkey', () => valKey);