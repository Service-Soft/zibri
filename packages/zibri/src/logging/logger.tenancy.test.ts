import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { LogCleanupCronJob } from './log-cleanup.cron-job';
import { LogLevel } from './log-level.enum';
import { Log } from './log.model';
import { Logger } from './logger';
import { LoggerTransport } from './transport/logger-transport.model';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { CronJobEntity, CreateCronJobEntityData } from '../cron/cron-job-entity.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

// in memory, so that what a log entry does across tenants can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

describe('Logger across tenants', () => {
    const tenantA: string = UUIDUtilities.generate();

    let server: StartedTestServer;
    let tenants: TenantServiceInterface;
    let logs: Repository<Log>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        logs = inject(repositoryTokenFor(Log));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('stores each entry with the tenant it was logged in', async () => {
        const cleanupAfterMs: Record<LogLevel, number> = {
            [LogLevel.DEBUG]: Ms.DAY,
            [LogLevel.INFO]: Ms.DAY,
            [LogLevel.WARN]: Ms.DAY,
            [LogLevel.ERROR]: Ms.DAY,
            [LogLevel.CRITICAL]: Ms.DAY
        };
        // the buffer writes later, outside the tenant each entry was logged in
        const logger: Logger = new Logger([LoggerTransport.db(LogLevel.INFO)], cleanupAfterMs, 100, Ms.SECOND);
        const marker: string = UUIDUtilities.generate();

        await tenants.runAs(tenantA, async () => {
            logger.info(`${marker} in a`);
            await Promise.resolve();
        });
        logger.info(`${marker} outside`);
        await logger.flush();

        const stored: Log[] = await logs.findAll({ where: { message: { like: `${marker}%` } }, acrossTenants: true });
        expect(stored.map(l => [l.message, l.tenantId ?? undefined])).toEqual(expect.arrayContaining([
            [`${marker} in a`, tenantA],
            [`${marker} outside`, undefined]
        ]));

        // a tenant reads its own entries and those of no tenant
        await tenants.runAs(UUIDUtilities.generate(), async () => {
            expect((await logs.findAll({ where: { message: { like: `${marker}%` } } })).map(l => l.message)).toEqual([`${marker} outside`]);
        });
    });

    it('cleans up the expired entries of every tenant', async () => {
        const expired: Log = await tenants.runAs(tenantA, async () => await logs.create({
            level: LogLevel.INFO,
            message: 'expired',
            context: { origin: 'logger.tenancy.test.ts' },
            cleanupAt: new Date(Date.now() - Ms.SECOND)
        }));

        // built by hand, because the test server runs no cron jobs
        const cleanup: LogCleanupCronJob = new LogCleanupCronJob(logs);
        const cronJobRepo: Repository<CronJobEntity, CreateCronJobEntityData> = inject(repositoryTokenFor(CronJobEntity));
        await cleanup.init(inject(ZIBRI_DI_TOKENS.LOGGER), cronJobRepo, async () => await Promise.resolve(true));
        await cleanup.onTick();

        expect(await logs.count({ where: { id: expired.id }, acrossTenants: true })).toBe(0);
    });
});