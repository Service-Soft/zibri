import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { DataSource } from '../decorators/data-source.decorator';
import { RepositoryClass } from '../repository/repository-class.type';

@Entity({ tenant: 'shared' })
class Reminder extends BaseEntity {
    @Property.string()
    text!: string;
}

/**
 * A data source that keeps its migrations, and declares no entity to keep them in.
 */
@DataSource()
class RemindersDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [Reminder];
    override readonly repositories: RepositoryClass[] = [];
}

// a data source that runs migrations without declaring
// MigrationEntity failed to start on a missing repository provider, naming neither
describe('a data source keeping its migrations without MigrationEntity', () => {
    it('keeps the application from starting, naming the data source and the entity', async () => {
        let server: StartedTestServer | undefined;
        try {
            await expect((async () => {
                server = await startTestServer({
                    dataSources: [
                        createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories }),
                        RemindersDataSource
                    ]
                });
            })()).rejects.toThrow(/RemindersDataSource[\S\s]*MigrationEntity/);
        }
        finally {
            await server?.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});