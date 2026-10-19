import { afterAll, beforeAll } from '@jest/globals';

import { Chore, describeOwnedRelations, Doorplate, Folder, Guest, Household, Lodger, ownedRelationEntities, OwnedRelationRepositories, Pet, Resident, Stop, Ticket, Trip } from './owned-relations.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { Change } from '../../change-sets/models/change.model';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ...ownedRelationEntities]
});

// a guest keeps change sets, which are written in the data source of the entity they describe
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, ChangeSet, Change, ...ownedRelationEntities]
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

/**
 * Reads the repositories of one data source.
 * @param dataSource - The started data source.
 * @returns Its repositories of the cases' entities.
 */
function repositoriesOf(dataSource: DataSourceInterface): OwnedRelationRepositories {
    return {
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
}

describeOwnedRelations('postgres', () => repositoriesOf(inject(postgresDataSourceClass)));

describeOwnedRelations('valkey', () => repositoriesOf(inject(valKeyDataSourceClass)));