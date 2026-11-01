import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeForeignTransaction } from './foreign-transaction.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { DataSource } from '../decorators/data-source.decorator';
import { MigrationEntity } from '../migration/migration-entity.model';
import { RepositoryClass } from '../repository/repository-class.type';

const firstDataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories });

/**
 * A second in memory data source, of the one entity both hold: the framework's entities belong to the first.
 */
@DataSource()
class SecondInMemoryDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity];
    override readonly repositories: RepositoryClass[] = [];
}

const secondDataSourceClass: Newable<InMemoryDataSource> = SecondInMemoryDataSource;

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [firstDataSourceClass, secondDataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeForeignTransaction('the in memory data source', () => ({
    first: inject(firstDataSourceClass),
    firstRepository: inject(repositoryTokenFor(MigrationEntity, firstDataSourceClass)),
    second: inject(secondDataSourceClass),
    secondRepository: inject(repositoryTokenFor(MigrationEntity, secondDataSourceClass))
}));
