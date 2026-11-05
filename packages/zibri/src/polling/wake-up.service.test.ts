import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { WakeUpListener } from './wake-up-listener.model';
import { WakeUpServiceInterface } from './wake-up-service.interface';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories });

let server: StartedTestServer | undefined;
let wakeUpService: WakeUpServiceInterface;
let dataSource: DataSourceInterface;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    wakeUpService = inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE);
    dataSource = inject(dataSourceClass);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describe('WakeUpService', () => {
    it('wakes whoever listens for the topic, and nobody listening for another', async () => {
        let woken: number = 0;
        let otherWoken: number = 0;
        const listener: WakeUpListener = await wakeUpService.listen(dataSource, 'wake-up.test', () => woken++);
        const other: WakeUpListener = await wakeUpService.listen(dataSource, 'wake-up.other', () => otherWoken++);
        try {
            await wakeUpService.wake(dataSource, 'wake-up.test');

            expect(await listener.next(Ms.SECOND)).toBe(true);
            expect(woken).toBe(1);
            expect(otherWoken).toBe(0);
        }
        finally {
            listener.stop();
            other.stop();
        }
    });

    it('keeps a wake up that arrives between two waits, so a caller that reads and then waits misses none', async () => {
        const listener: WakeUpListener = await wakeUpService.listen(dataSource, 'wake-up.between');
        try {
            await wakeUpService.wake(dataSource, 'wake-up.between');
            // delivered while nobody waits
            await new Promise(resolve => setImmediate(resolve));

            const startedAt: number = Date.now();
            expect(await listener.next(Ms.SECOND * 5)).toBe(true);
            expect(Date.now() - startedAt).toBeLessThan(100);
            // and only once
            expect(await listener.next(50)).toBe(false);
        }
        finally {
            listener.stop();
        }
    });

    it('ends a wait at a wake up, at its timeout, or when its signal fires', async () => {
        const listener: WakeUpListener = await wakeUpService.listen(dataSource, 'wake-up.wait');
        try {
            const waking: Promise<boolean> = listener.next(Ms.SECOND * 5);
            await wakeUpService.wake(dataSource, 'wake-up.wait');
            expect(await waking).toBe(true);

            expect(await listener.next(50)).toBe(false);

            const controller: AbortController = new AbortController();
            const aborted: Promise<boolean> = listener.next(Ms.SECOND * 5, controller.signal);
            controller.abort();
            expect(await aborted).toBe(false);
        }
        finally {
            listener.stop();
        }
    });

    it('wakes this instance at the earliest of the times asked for', async () => {
        const listener: WakeUpListener = await wakeUpService.listen(dataSource, 'wake-up.later');
        try {
            const startedAt: number = Date.now();
            wakeUpService.wakeAt('wake-up.later', new Date(startedAt + (Ms.SECOND * 10)));
            wakeUpService.wakeAt('wake-up.later', new Date(startedAt + 200));
            wakeUpService.wakeAt('wake-up.later', new Date(startedAt + (Ms.SECOND * 5)));

            expect(await listener.next(Ms.SECOND * 2)).toBe(true);
            expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
            expect(Date.now() - startedAt).toBeLessThan(Ms.SECOND);
        }
        finally {
            listener.stop();
        }
    });

    it('stops waking a listener that stopped', async () => {
        let woken: number = 0;
        const listener: WakeUpListener = await wakeUpService.listen(dataSource, 'wake-up.stopped', () => woken++);
        listener.stop();

        await wakeUpService.wake(dataSource, 'wake-up.stopped');
        await new Promise(resolve => setImmediate(resolve));

        expect(woken).toBe(0);
    });

    it('reaches the other instances through a data source that carries messages', () => {
        expect(wakeUpService.reachesOtherInstances(dataSource)).toBe(true);
    });
});