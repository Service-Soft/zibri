import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Chore, describeOwnedRelations, Doorplate, Folder, Guest, Household, Lodger, ownedRelationEntities, OwnedRelationRepositories, Pet, Resident, Stop, Ticket, Trip } from './owned-relations.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ...ownedRelationEntities]
});

let server: StartedTestServer | undefined;
let repositories: OwnedRelationRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    repositories = {
        households: dataSource.getRepository(Household),
        residents: dataSource.getRepository(Resident),
        chores: dataSource.getRepository(Chore),
        pets: dataSource.getRepository(Pet),
        doorplates: dataSource.getRepository(Doorplate),
        guests: dataSource.getRepository(Guest),
        changeSets: dataSource.getRepository(ChangeSet),
        trips: dataSource.getRepository(Trip),
        stops: dataSource.getRepository(Stop),
        tickets: dataSource.getRepository(Ticket),
        lodgers: dataSource.getRepository(Lodger),
        folders: dataSource.getRepository(Folder)
    };
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeOwnedRelations('the in memory data source', () => repositories);