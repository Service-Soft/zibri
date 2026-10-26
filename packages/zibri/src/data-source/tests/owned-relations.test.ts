import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Chore, describeOwnedRelations, Doorplate, Folder, Guest, Household, Lodger, ownedRelationEntities, OwnedRelationRepositories, Pet, Resident, Stop, Ticket, Trip } from './owned-relations.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { ChangeSet } from '../change-sets/models/change-set.model';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ...ownedRelationEntities],
    repositories: defaultTestServerRepositories
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
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeOwnedRelations('the in memory data source', () => repositories);