import { InMemoryDataSource, StartTestServerOptions } from 'zibri-testing';

import { defaultTestServerEntities } from './create-test-data-source.function';
import { StartedTestServer, startTestServer } from './start-test-server.function';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * Starts a test server whose data source declares every default entity except the given ones, and
 * shuts it down again.
 *
 * For a test about whether an application starts at all: resolves when the boot went through, and
 * rejects with whatever refused it.
 *
 * Call it before anything in the same suite starts a server on the default data source. That data
 * source stays registered once declared, and every later boot that does not declare it is refused
 * for it - before any of what the test is about gets a chance to run.
 * @param entities - The entities the data source leaves out.
 * @param options - What else the server is started with.
 */
export async function startAndStopTestServerWithout(
    entities: Newable<BaseEntity>[],
    options: StartTestServerOptions = {}
): Promise<void> {
    // allowed to be orphaned, because every call declares a new one and a later case in the same
    // suite starts without the ones before it
    @DataSource({ allowOrphan: true })
    class WithoutEntitiesDataSource extends InMemoryDataSource {
        override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities.filter(e => !entities.includes(e));
    }

    const server: StartedTestServer = await startTestServer({ ...options, dataSources: [WithoutEntitiesDataSource] });
    // only reached when the boot did not refuse
    await server.shutdown();
}