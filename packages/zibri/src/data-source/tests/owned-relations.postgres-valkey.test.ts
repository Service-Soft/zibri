import { afterAll, beforeAll } from 'vitest';

import { Chore, describeOwnedRelations, Doorplate, Folder, Guest, Household, Lodger, ownedRelationEntities, OwnedRelationRepositories, Pet, Resident, Stop, Ticket, Trip } from './owned-relations.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { ChangeSet } from '../../change-sets/models/change-set.model.ts';
import { Change } from '../../change-sets/models/change.model.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { DataSourceInterface } from '../data-sources/data-source.interface.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';

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