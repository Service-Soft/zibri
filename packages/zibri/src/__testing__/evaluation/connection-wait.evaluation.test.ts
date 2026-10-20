import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OperationLimitUtilities } from '../../context/operation-limit.utilities.ts';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { DataSource } from '../../data-source/decorators/data-source.decorator.ts';
import { SchemaManagement } from '../../data-source/models/schema-management.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/01-data-layer.md M63 - waiting for a connection has no time limit.
 *
 * A call that finds every connection of the pool taken waits for one to come back, for as long as
 * that takes: the statement timeout starts with the statement, and a call's `timeoutInMs` - which
 * bounds the call as a whole - does not reach the wait either. Nor does the limit of the work a
 * transaction is started in, and a call without a limit of its own has nothing bounding it at all.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

/**
 * How a call waiting for a connection ended, or that it had not ended yet.
 */
type WaitOutcome = 'answered' | 'gave up' | 'still waiting';

@Entity({ tenant: 'shared', allowOrphan: true })
class WaitingRow extends BaseEntity {
    @Property.string()
    value!: string;
}

/**
 * Holds a single connection, so a transaction left open takes the whole pool.
 */
@DataSource()
class SingleConnectionDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false,
        poolSize: 1,
        connectTimeoutMS: 1000
    };

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, WaitingRow];

    schemaManagement: SchemaManagement = 'synchronize';
}

let server: StartedTestServer | undefined;
let rows: Repository<WaitingRow>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [SingleConnectionDataSource] });
    rows = inject(repositoryTokenFor(WaitingRow));
}, 90000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describe('evaluation/01-data-layer M63 - waiting for a connection', () => {
    it('gives up once the call has run out of the timeoutInMs it was given', async () => {
        const holder: Transaction = await inject(SingleConnectionDataSource).startTransaction();
        try {
            // under the pool's own wait, so only the call's limit can have ended it
            expect(await answerWithin(rows.findAll({ timeoutInMs: 200 }), 900)).toBe('gave up');
        }
        finally {
            // hands the connection back, which the call still waiting takes
            await holder.rollback();
        }
        // the connection the call that gave up was handed once it came free went back to the pool
        await expect(answerWithin(rows.findAll({}), 2000)).resolves.toBe('answered');
    });

    it('starts no transaction once the work it belongs to has run out of time', async () => {
        const holder: Transaction = await inject(SingleConnectionDataSource).startTransaction();
        try {
            const waiting: Promise<WaitOutcome> = OperationLimitUtilities.runWithin(
                200,
                'start',
                async () => await inject(SingleConnectionDataSource).startTransaction()
            // eslint-disable-next-line promise/prefer-await-to-then
            ).then(async (started: Transaction): Promise<WaitOutcome> => {
                await started.rollback();
                return 'answered';
            }, (): WaitOutcome => 'gave up');

            expect(await answerWithin(waiting, 900)).toBe('gave up');
        }
        finally {
            await holder.rollback();
        }
        await expect(answerWithin(rows.findAll({}), 2000)).resolves.toBe('answered');
    });

    it('gives up a call without a limit of its own once the pool has kept it waiting for connectTimeoutMS', async () => {
        const holder: Transaction = await inject(SingleConnectionDataSource).startTransaction();
        try {
            // eslint-disable-next-line promise/prefer-await-to-then
            const waiting: Promise<WaitOutcome> = rows.findAll({}).then((): WaitOutcome => 'answered', (): WaitOutcome => 'gave up');

            expect(await answerWithin(waiting, 3000)).toBe('gave up');
        }
        finally {
            await holder.rollback();
        }
    });
});

/**
 * How a call ended within the given time, or that it had not.
 * @param waiting - The call, or how it ended.
 * @param withinMs - How long to wait for it.
 * @returns How it ended.
 */
async function answerWithin(waiting: Promise<unknown>, withinMs: number): Promise<WaitOutcome> {
    // eslint-disable-next-line promise/prefer-await-to-then
    const ended: Promise<WaitOutcome> = waiting.then(
        (outcome: unknown): WaitOutcome => outcome === 'gave up' ? 'gave up' : 'answered',
        (): WaitOutcome => 'gave up'
    );
    return await Promise.race([ended, sleep(withinMs).then((): WaitOutcome => 'still waiting')]);
}