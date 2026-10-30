import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { defaultTestServerEntities, defaultTestServerRepositories } from './create-test-data-source.function';
import { defaultTestServerProviders } from './providers';
import { StartedTestServer, startTestServer } from './start-test-server.function';
import { AuditCheckpointCronJob } from '../../audit/audit-checkpoint.cron-job';
import { ChainedAuditEntry } from '../../audit/chained-audit-entry.model';
import { CronServiceInterface } from '../../cron/cron-service.interface';
import { CronService } from '../../cron/cron.service';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { DiProvider, defineProvider } from '../../di/models/di-provider.model';
import { TestTimeouts } from '../constants';

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ChainedAuditEntry],
    repositories: defaultTestServerRepositories
});

/**
 * The test providers with the real cron service, rather than the stub that registers nothing: which
 * jobs the application registers is what is tested.
 */
const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders.filter(provider => provider.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
    defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
];

// the harness's reInit inherited the options of the running application, cron jobs the framework
// added while it started included, so a job a feature registered outlived the feature. Held by the
// password reset token's cleanup job until that job went with 05 §Q3, by the audit checkpoints now
describe('a test server, after a reInit without the feature that registered a cron job', () => {
    let server: StartedTestServer;
    let ranBefore: boolean;

    /**
     * Whether the running application runs the job of the audit checkpoints.
     * @returns True when the cron service holds it.
     */
    function runsCheckpoints(): boolean {
        return inject<CronServiceInterface>(ZIBRI_DI_TOKENS.CRON_SERVICE).cronJobs.some(job => job instanceof AuditCheckpointCronJob);
    }

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass], providers });
        ranBefore = runsCheckpoints();
        await server.reInit({
            dataSources: [dataSourceClass],
            providers: [...providers, defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_INTEGRITY, useValue: 'chain' })]
        });
    }, TestTimeouts.inMemory.start * 2);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('runs the job no more', () => {
        expect({ ranBefore, runsAfter: runsCheckpoints() }).toEqual({ ranBefore: true, runsAfter: false });
    });
});