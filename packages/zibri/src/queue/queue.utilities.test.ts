import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { QueueDefinition } from './queue-definition.model';
import { QueueUtilities } from './queue.utilities';
import { QueuedWorkEntity } from './queued-work-entity.model';
import { QueuedWorkOutcome } from './queued-work-outcome.model';
import { QueuedWorkRun } from './queued-work-run.model';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { Transaction } from '../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Ms } from '../utilities/ms';

/**
 * Where a row of the test queue stands.
 */
enum TestWorkStatus {
    QUEUED = 'QUEUED',
    DONE = 'DONE',
    FAILED = 'FAILED'
}

/**
 * A row of the test queue.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class TestWork extends QueuedWorkEntity {
    @Property.string({ enum: TestWorkStatus })
    status!: TestWorkStatus;

    @Property.string()
    label!: string;
}

/**
 * What a run of the test queue writes, to see whether it was kept.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class TestWorkEffect extends BaseEntity {
    @Property.string()
    label!: string;
}

const STATUS_OF: Record<QueuedWorkOutcome['kind'], TestWorkStatus> = {
    succeeded: TestWorkStatus.DONE,
    retrying: TestWorkStatus.QUEUED,
    failed: TestWorkStatus.FAILED
};

let server: StartedTestServer | undefined;
let works: Repository<TestWork>;
let effects: Repository<TestWorkEffect>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, TestWork, TestWorkEffect],
                repositories: defaultTestServerRepositories
            })
        ]
    });
    works = inject(repositoryTokenFor(TestWork));
    effects = inject(repositoryTokenFor(TestWorkEffect));
}, TestTimeouts.inMemory.start);

beforeEach(async () => {
    await works.deleteAll({ status: { oneOf: Object.values(TestWorkStatus) } });
});

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

/**
 * Defines the test queue around a run.
 * @param run - What an attempt does.
 * @param overrides - What the queue does otherwise than by default.
 * @returns The queue.
 */
function defineQueue(
    run: (item: TestWork, queuedRun: QueuedWorkRun) => Promise<void>,
    overrides: Partial<QueueDefinition<TestWork>> = {}
): QueueDefinition<TestWork> {
    return {
        name: 'test-work',
        wakeUpTopic: 'test-work',
        dataSource: works.dataSource,
        leaseInMs: Ms.MINUTE,
        onCompletion: 'release',
        claimedPer: 'item',
        firstRetryDelayInMs: Ms.SECOND,
        findDue: async () => (await works.findAll({ where: { status: TestWorkStatus.QUEUED } }))
            .filter(work => work.nextAttemptAt == undefined || work.nextAttemptAt.getTime() <= Date.now()),
        findRunId: work => work.id,
        findMaxAttempts: () => 2,
        run,
        record: async (item: TestWork, outcome: QueuedWorkOutcome, transaction: Transaction | undefined) => {
            await works.updateById(item.id, { ...outcome, status: STATUS_OF[outcome.kind] }, { transaction });
        },
        ...overrides
    };
}

/**
 * Queues a row.
 * @param label - What sets it apart.
 * @returns The row.
 */
async function queueWork(label: string): Promise<TestWork> {
    return await works.create({ status: TestWorkStatus.QUEUED, label, attempts: 0 });
}

// 09 §Q5: mail, thread jobs and event runs each claimed, counted, backed off and gave up on their
// own, the same way three times
describe('QueueUtilities', () => {
    it('runs a due row once and records it done', async () => {
        const work: TestWork = await queueWork('once');
        const runs: QueuedWorkRun[] = [];

        // eslint-disable-next-line typescript/require-await
        expect(await QueueUtilities.poll(defineQueue(async (_, run) => {
            runs.push(run);
        }))).toBe(true);

        expect(runs.map(run => [run.runId, run.attempt, run.transaction])).toEqual([[work.id, 1, undefined]]);
        // eslint-disable-next-line unicorn/no-null
        expect(await works.findById(work.id)).toMatchObject({ status: TestWorkStatus.DONE, attempts: 1, error: null, nextAttemptAt: null });
    });

    it('answers that it found nothing when nothing is due', async () => {
        expect(await QueueUtilities.poll(defineQueue(async () => {}))).toBe(false);
    });

    it('retries a row that failed after the first delay, doubling it, and gives up after its attempts', async () => {
        const work: TestWork = await queueWork('flaky');
        const runIds: string[] = [];
        const queue: QueueDefinition<TestWork> = defineQueue((_, run) => {
            runIds.push(run.runId);
            throw new Error('the mail server is down');
        });

        await QueueUtilities.poll(queue);
        const retried: TestWork = await works.findById(work.id);
        expect(retried).toMatchObject({ status: TestWorkStatus.QUEUED, attempts: 1 });
        expect(retried.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now() + (Ms.SECOND * 0.5));
        expect(retried.error?.paragraphs.join('\n')).toContain('the mail server is down');

        // not due yet
        expect(await QueueUtilities.poll(queue)).toBe(false);

        await works.updateById(work.id, { nextAttemptAt: new Date(Date.now() - 1) });
        await QueueUtilities.poll(queue);
        // eslint-disable-next-line unicorn/no-null
        expect(await works.findById(work.id)).toMatchObject({ status: TestWorkStatus.FAILED, attempts: 2, nextAttemptAt: null });
        expect(runIds).toEqual([work.id, work.id]);
    });

    it('runs a row once while two polls reach it together', async () => {
        await queueWork('raced');
        let runs: number = 0;
        const queue: QueueDefinition<TestWork> = defineQueue(async () => {
            runs++;
            await new Promise(resolve => setTimeout(resolve, 100));
        });

        await Promise.all([QueueUtilities.poll(queue), QueueUtilities.poll(queue)]);

        expect(runs).toBe(1);
    });

    describe('delivered at most once', () => {
        it('records a row failed before it runs, and done once it ran', async () => {
            const work: TestWork = await queueWork('at-most-once');
            const whileRunning: TestWork[] = [];

            await QueueUtilities.poll(defineQueue(async () => {
                whileRunning.push(await works.findById(work.id));
            }, { findDelivery: () => 'atMostOnce' }));

            expect(whileRunning[0]).toMatchObject({ status: TestWorkStatus.FAILED, attempts: 1 });
            expect(whileRunning[0]?.error?.paragraphs.join('\n')).toContain('stopped before it finished');
            // eslint-disable-next-line unicorn/no-null
            expect(await works.findById(work.id)).toMatchObject({ status: TestWorkStatus.DONE, attempts: 1, error: null });
        });

        it('does not retry a row that failed', async () => {
            const work: TestWork = await queueWork('at-most-once-failing');

            await QueueUtilities.poll(defineQueue(() => {
                throw new Error('the push service refused it');
            }, { findDelivery: () => 'atMostOnce' }));

            // eslint-disable-next-line unicorn/no-null
            expect(await works.findById(work.id)).toMatchObject({ status: TestWorkStatus.FAILED, attempts: 1, nextAttemptAt: null });
        });
    });

    describe('delivered in a transaction', () => {
        it('keeps what an attempt wrote together with recording it', async () => {
            const work: TestWork = await queueWork('transactional');

            await QueueUtilities.poll(defineQueue(async (item, run) => {
                expect(run.transaction).toBeDefined();
                await effects.create({ label: item.label }, { transaction: run.transaction });
            }, { findDelivery: () => 'transactional' }));

            expect(await effects.findAll({ where: { label: 'transactional' } })).toHaveLength(1);
            expect(await works.findById(work.id)).toMatchObject({ status: TestWorkStatus.DONE, attempts: 1 });
        });

        it('rolls back what an attempt that failed wrote, and records the attempt', async () => {
            const work: TestWork = await queueWork('transactional-failing');

            await QueueUtilities.poll(defineQueue(async (item, run) => {
                await effects.create({ label: item.label }, { transaction: run.transaction });
                throw new Error('the invoice could not be numbered');
            }, { findDelivery: () => 'transactional' }));

            expect(await effects.findAll({ where: { label: 'transactional-failing' } })).toEqual([]);
            expect(await works.findById(work.id)).toMatchObject({ status: TestWorkStatus.QUEUED, attempts: 1 });
        });
    });

    describe('claimed as a batch', () => {
        it('runs the rows of a poll together, and leaves them due when the batch cannot run now', async () => {
            await queueWork('batched-1');
            await queueWork('batched-2');
            const batches: string[][] = [];
            let canRun: boolean = false;
            const queue: QueueDefinition<TestWork> = defineQueue(async () => {}, {
                claimedPer: 'batch',
                runBatch: async (items, runEach) => {
                    if (!canRun) {
                        return false;
                    }
                    batches.push(items.map(item => item.label).sort());
                    await Promise.all(items.map(runEach));
                    return true;
                }
            });

            expect(await QueueUtilities.poll(queue)).toBe(false);
            canRun = true;
            expect(await QueueUtilities.poll(queue)).toBe(true);

            expect(batches).toEqual([['batched-1', 'batched-2']]);
            expect((await works.findAll({ where: { status: TestWorkStatus.DONE } })).map(work => work.label).sort()).toEqual(['batched-1', 'batched-2']);
        });
    });
});