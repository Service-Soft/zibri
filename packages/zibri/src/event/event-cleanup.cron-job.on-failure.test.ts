import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { EventCleanupCronJob } from './event-cleanup.cron-job';
import { Event, EventStatus } from './event.model';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { CreateCronJobEntityData, CronJobEntity } from '../cron/cron-job-entity.model';
import { CronService } from '../cron/cron.service';
import { Repository } from '../data-source/repository/repository';
import { RepositoryFor } from '../data-source/repository/repository-for.decorator';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';

/**
 * Refuses to delete any event, the way a store does whose permission to delete was revoked.
 */
@RepositoryFor(Event)
class RefusingEventRepository extends Repository<Event<unknown>> {
    protected override async beforeDelete(row: Event<unknown>): Promise<void> {
        await super.beforeDelete(row);
        throw new Error('deleting events is not permitted');
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: [...defaultTestServerRepositories, RefusingEventRepository]
});

// onTick caught every error and did nothing with it, so a cleanup failing every
// night left the table growing with nothing on the job's row to show for it
describe('An event cleanup the store refuses', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            // the real one, which runs the cleanup the event service registers
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
                defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
            ]
        });
        await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('is recorded as a failure on the job\'s row', async () => {
        await inject(repositoryTokenFor(Event)).create({
            type: 'cleanup.refused',
            data: {},
            subscriberIds: [],
            status: EventStatus.FINISHED,
            cleanupAt: new Date(Date.now() - Ms.DAY)
        });

        await inject(EventCleanupCronJob).runOnTick();

        const rows: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
        expect(await rows.findOne({ where: { name: 'Event Cleanup' } })).toMatchObject({
            consecutiveFailures: 1,
            errorMessage: expect.stringContaining('deleting events is not permitted')
        });
    });
});