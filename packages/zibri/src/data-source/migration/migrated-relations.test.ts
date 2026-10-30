import { afterAll, beforeAll } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { createRelatedTablesMigration, createRemoveGenresMigration, describeMigratedRelations, relatedEntities } from './migrated-relations.cases';
import { Migration } from './migration.model';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { DataSource } from '../decorators/data-source.decorator';
import { RepositoryClass } from '../repository/repository-class.type';

// added to by the restart below, which runs the next migration on the same store
const migrations: Newable<Migration>[] = [];

/**
 * The data source of the relations.
 */
@DataSource()
class RelatedDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, ...relatedEntities];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    override readonly migrations: Newable<Migration>[] = migrations;
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    migrations.push(createRelatedTablesMigration(RelatedDataSource));
    server = await startTestServer({ dataSources: [RelatedDataSource] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeMigratedRelations('the in memory data source', {
    dataSourceOf: () => inject(RelatedDataSource),
    restartRemovingGenres: async () => {
        migrations.push(createRemoveGenresMigration(RelatedDataSource));
        await server?.reInit();
    }
});