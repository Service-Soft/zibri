import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { LeaseServiceInterface } from './lease-service.interface';
import { Lease } from './lease.model';
import { LeaseService } from './lease.service';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';

describe('LeaseService — starting', () => {
    it('refuses to start without Lease, and names it', async () => {
        await expect(startAndStopTestServerWithout([Lease])).rejects.toThrow(/Error initializing LeaseService[\S\s]*Lease/);
    }, 30000);
});

describe('LeaseService — shutting down', () => {
    it('hands a grant back once the drain gives up on its work', async () => {
        @DataSource({ allowOrphan: true })
        class DrainDataSource extends InMemoryDataSource {
            override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
        }
        const server: StartedTestServer = await startTestServer({
            dataSources: [DrainDataSource],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.LEASE_DRAIN_TIMEOUT_IN_MS, useFactory: () => 100 })
            ]
        });
        try {
            const leaseService: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
            const leaseRepository: Repository<Lease> = inject(repositoryTokenFor(Lease));

            // work that outlasts the drain, the shape a replica being stopped mid task is in
            const work: Promise<void> = leaseService.withLease({ key: 'drain-test', leaseInMs: 60000 }, async () => await sleep(1000));
            await sleep(50);
            expect(await leaseRepository.findAll({ where: { key: 'drain-test' } })).toHaveLength(1);

            // the class rather than the token, which types it without the hook. One instance either way
            const drainingService: LeaseService = inject(LeaseService);
            expect(drainingService).toBe(leaseService);
            await drainingService.onAppShutdown();

            expect(await leaseRepository.findAll({ where: { key: 'drain-test' } })).toEqual([]);
            // let the work end while the server is still up, so its own release has somewhere to run
            await work;
        }
        finally {
            await server.shutdown();
        }
    }, 30000);
});