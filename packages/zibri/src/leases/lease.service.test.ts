import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
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
import { Transaction } from '../data-source/transaction/transaction.model';
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

describe('LeaseService — held until a transaction ends', () => {
    const leaseInMs: number = 60000;
    let server: StartedTestServer;
    let leaseService: LeaseServiceInterface;
    let leaseRepository: Repository<Lease>;

    /**
     * Whether a grant is free, asked the way another caller would.
     * @param key - The grant.
     * @returns Whether it could be taken.
     */
    async function isFree(key: string): Promise<boolean> {
        return await leaseService.withLease({ key, leaseInMs }, async () => await Promise.resolve(true)) === true;
    }

    beforeAll(async () => {
        @DataSource({ allowOrphan: true })
        class HeldUntilDataSource extends InMemoryDataSource {
            override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
        }
        server = await startTestServer({ dataSources: [HeldUntilDataSource], providers: defaultTestServerProviders });
        leaseService = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
        leaseRepository = inject(repositoryTokenFor(Lease));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('holds a grant past the work until the transaction commits', async () => {
        const transaction: Transaction = await leaseRepository.dataSource.startTransaction();

        await leaseService.withLease({ key: 'until-commit', leaseInMs, heldUntil: transaction }, async () => {});

        expect(await isFree('until-commit')).toBe(false);
        await transaction.commit();
        expect(await isFree('until-commit')).toBe(true);
    });

    it('hands a grant back on a rollback, which counts as the work having thrown', async () => {
        const released: Transaction = await leaseRepository.dataSource.startTransaction();
        const retained: Transaction = await leaseRepository.dataSource.startTransaction();

        await leaseService.withLease({ key: 'until-rollback', leaseInMs, heldUntil: released }, async () => {});
        await leaseService.withLease(
            { key: 'until-rollback-retained', leaseInMs, onCompletion: 'retainOnError', heldUntil: retained },
            async () => {}
        );
        await released.rollback();
        await retained.rollback();

        expect(await isFree('until-rollback')).toBe(true);
        expect(await isFree('until-rollback-retained')).toBe(false);
    });

    it('hands a grant back once the work returns, when the transaction ended before', async () => {
        const endedInside: Transaction = await leaseRepository.dataSource.startTransaction();
        const endedBefore: Transaction = await leaseRepository.dataSource.startTransaction();
        await endedBefore.commit();

        await leaseService.withLease({ key: 'ended-inside', leaseInMs, heldUntil: endedInside }, async () => await endedInside.commit());
        await leaseService.withLease({ key: 'ended-before', leaseInMs, heldUntil: endedBefore }, async () => {});

        expect(await isFree('ended-inside')).toBe(true);
        expect(await isFree('ended-before')).toBe(true);
    });
});