import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { Repository } from '../repository/repository';

/**
 * What happens to the connection of a transaction that is started and then never finished.
 *
 * Starting a transaction takes a connection out of the pool and holds it until the transaction
 * commits or rolls back. A caller that writes the happy path and leaves out the catch reaches
 * neither, so the connection is held by a transaction nothing will ever come back to.
 *
 * The cost of that is not one slow request. The pool is a fixed number of connections for the whole
 * process, so every abandoned transaction takes one out of circulation for good, and the last one
 * takes the process with it: no query anywhere can be served after that.
 */

const POOL_SIZE: number = 5;

@Entity({ tenant: 'shared' })
class Item {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;
}

let server: StartedTestServer;
let dataSource: DataSourceInterface;
let repo: Repository<Item>;

describe('a transaction that is never committed or rolled back', () => {
    beforeAll(async () => {
        const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
            entities: [...defaultTestServerEntities, Item],
            // small enough to fill, and a wait long enough to outlast the idle timeout below so that
            // what this measures is whether the connection comes back rather than which clock won
            poolSize: POOL_SIZE,
            connectionTimeoutInMs: 8000
        });
        server = await startTestServer({ dataSources: [dataSourceClass] });
        dataSource = inject(dataSourceClass);
        repo = inject(repositoryTokenFor(Item));
    }, 30000);

    it('gives its connection back rather than holding it for the life of the process', async () => {
        // as many as the pool will hand out, each one the mistake this is about: started, used for
        // nothing, and left without a commit or a rollback
        let abandoned: number = 0;
        for (let i: number = 0; i < POOL_SIZE; i++) {
            try {
                // shorter than the default only so the test does not have to sit through it. What
                // is being measured is the same either way: whether being given up on is enough to
                // put the connection back
                await dataSource.startTransaction({ idleTimeoutInMs: 1000 });
                abandoned++;
            }
            catch {
                // the pool has nothing left to give, which is the state this test wants to reach -
                // how many it took to get there depends on what the running application holds
                break;
            }
        }
        expect(abandoned).toBeGreaterThan(0);

        // an ordinary query, on an application that is otherwise idle and healthy. It needs one
        // connection, and whether it gets one is the whole question
        await expect(repo.findAll()).resolves.toBeDefined();
    }, 60000);

    afterAll(async () => {
        await server.shutdown();
    }, 15000);
});