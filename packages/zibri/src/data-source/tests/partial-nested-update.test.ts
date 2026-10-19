import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describePartialNestedUpdate, Label, Organizer, PartialNestedUpdateRepositories, Venue } from './partial-nested-update.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Venue, Organizer, Label]
});

let server: StartedTestServer | undefined;
let repositories: PartialNestedUpdateRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    repositories = {
        venues: dataSource.getRepository(Venue),
        organizers: dataSource.getRepository(Organizer),
        labels: dataSource.getRepository(Label)
    };
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describePartialNestedUpdate('the in memory data source', () => repositories);