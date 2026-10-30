import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { OperationLimitUtilities } from '../../../context/operation-limit.utilities';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { HttpStatus } from '../../../http/http-status.enum';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Newable } from '../../../types/newable.type';
import { Ms } from '../../../utilities/ms';
import { DataSource } from '../../decorators/data-source.decorator';
import { SchemaManagement } from '../../models/schema-management.model';
import { Repository } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';
import { Transaction } from '../../transaction/transaction.model';
import { DataSourceSubscription } from '../pub-sub-data-source.interface';

/**
 * A data source behind PgBouncer in transaction mode, where each transaction may run on another
 * server connection, which the harness starts in front of its server.
 *
 * Pointed at the pooler through `options`, and at the server through `direct`: the harness applies
 * the ports of both once its containers run.
 */

/**
 * What postgres says when it stops a statement, for having run out of time or because it was asked to.
 */
const STATEMENT_STOPPED: RegExp = /canceling statement due to (statement timeout|user request)/;

/**
 * How long the pooler's container takes on top of the server's: it installs PgBouncer as it starts.
 */
const POOLER_START_IN_MS: number = 60 * Ms.SECOND;

@Entity({ tenant: 'shared', allowOrphan: true })
class PooledRow extends BaseEntity {
    @Property.string()
    value!: string;
}

@DataSource()
class PooledDataSource extends PostgresDataSource {
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, PooledRow];

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    schemaManagement: SchemaManagement = 'synchronize';

    readonly pooler: PostgresPooler = { mode: 'transaction', direct: { host: 'localhost' } };
}

/**
 * How long the statement of the last request took, until it came back one way or the other.
 */
let statementTookMs: number | undefined;

/**
 * Reads what the handler recorded, through a function so the narrowing of the module level `let`
 * does not make it look like it can only be what this file last wrote.
 * @returns How long the statement took, or undefined while it is still running.
 */
function readStatementTookMs(): number | undefined {
    return statementTookMs;
}

@Controller('/pooled')
class PooledController {
    @Get('/sleep', { timeoutInMs: 300 })
    async sleep(): Promise<{ ok: boolean }> {
        const startedAt: number = Date.now();
        try {
            await inject(PooledDataSource).query(PooledRow)
                .select('pg_sleep(3)', 'slept')
                .limit(1)
                .getRawOne();
            return { ok: true };
        }
        finally {
            statementTookMs = Date.now() - startedAt;
        }
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string = '';
let rows: Repository<PooledRow>;

/**
 * Reads the statement timeout a connection of the pool has, outside any transaction.
 * @returns The setting, as postgres writes it.
 */
async function showStatementTimeout(): Promise<string | undefined> {
    const shown: Record<string, unknown>[] = await queryPostgres(inject(PooledDataSource), 'SHOW statement_timeout');
    const timeout: unknown = shown[0]?.['statement_timeout'];
    return typeof timeout === 'string' ? timeout : undefined;
}

/**
 * Has the server end the connection a channel is listened on, as a restart or an administrator would.
 * @param channel - The channel.
 * @returns One row per connection ended.
 */
async function terminateListening(channel: string): Promise<Record<string, unknown>[]> {
    return await queryPostgres(
        inject(PooledDataSource),
        'SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE query LIKE $1 AND pid <> pg_backend_pid()',
        [`LISTEN %${channel}%`]
    );
}

/**
 * Starts a transaction that holds the lock on the given row until it is committed.
 * @param id - The row to lock.
 * @returns The transaction.
 */
async function lockRow(id: string): Promise<Transaction> {
    const holder: Transaction = await inject(PooledDataSource).startTransaction();
    await rows.updateById(id, { value: 'held' }, { transaction: holder });
    return holder;
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [PooledDataSource], controllers: [PooledController] });
    baseUrl = await server.start();
    rows = inject(repositoryTokenFor(PooledRow));
}, TestTimeouts.postgres.start + POOLER_START_IN_MS);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

// 02 §S3: the data source took a session to be its own. Behind a transaction pooler the startup
// settings were refused, a limit set on the session reached somebody else's statement, a cancel named
// a backend the pooler made up, and a subscription listened on a connection nobody kept
describe('a data source behind a transaction pooler', () => {
    it('connects, and its connections carry the statement timeout of its role', async () => {
        expect(await showStatementTimeout()).toBe('30s');
    });

    it('gives a call the time it names for its own statement', async () => {
        const shown: string | undefined = await OperationLimitUtilities.runWithin(12345, 'showing the timeout', showStatementTimeout);

        expect(shown).toBe('12345ms');
    });

    it('stops a call\'s statement once the time it names is up', async () => {
        const row: PooledRow = await rows.create({ value: 'free' });
        const holder: Transaction = await lockRow(row.id);
        try {
            const startedAt: number = Date.now();
            // by the statement timeout or by the cancel the call's own clock sends, whichever comes first:
            // the two are the same length, and the clock started before the statement did
            await expect(rows.updateById(row.id, { value: 'waited' }, { timeoutInMs: 200 })).rejects.toThrow(STATEMENT_STOPPED);
            // the call's own limit, not the thirty seconds of the role
            expect(Date.now() - startedAt).toBeLessThan(5000);
        }
        finally {
            await holder.rollback();
        }
    });

    it('never hands the time a call names to another caller\'s statement', async () => {
        // many at once, so the pooler hands the server connections around between them: a limit left
        // on one of them is what the plain statements below would report
        const shown: (string | undefined)[] = await Promise.all(Array.from({ length: 60 }, async (_, i) => {
            if (i % 2 === 0) {
                await rows.findAll({ where: { value: 'nothing' }, timeoutInMs: 12345 });
                return '30s';
            }
            return await showStatementTimeout();
        }));

        expect(new Set(shown)).toEqual(new Set(['30s']));
    });

    it('stops the statement of a request that runs out of time', async () => {
        statementTookMs = undefined;

        const res: Response = await fetch(`${baseUrl}/pooled/sleep`);
        expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);

        // well inside the three seconds the statement sleeps
        await sleep(1500);
        const tookMs: number | undefined = readStatementTookMs();
        if (tookMs == undefined) {
            throw new Error('the statement has not come back, so nothing stopped it');
        }
        expect(tookMs).toBeLessThan(3000);
    });

    it('delivers what it publishes to its subscribers', async () => {
        const received: string[] = [];
        const subscription: DataSourceSubscription = await inject(PooledDataSource).subscribe('pooled.messages', m => received.push(m));
        try {
            await inject(PooledDataSource).publish('pooled.messages', 'hello');
            for (let waited: number = 0; received.length === 0 && waited < 3000; waited += 100) {
                await sleep(100);
            }

            expect(received).toEqual(['hello']);
        }
        finally {
            await subscription.unsubscribe();
        }
    });

    // found while the suite ran, 2026-10-28: the session listened on was kept for good, so listening again
    // after it failed took the same ended session, and once nobody listened its failure crashed the process
    it('listens again once the server ended the session it listened on', async () => {
        const received: string[] = [];
        const subscription: DataSourceSubscription = await inject(PooledDataSource).subscribe('pooled.dropped', m => received.push(m));
        try {
            expect(await terminateListening('pooled.dropped')).toEqual([{ terminated: true }]);
            // what is published while nothing listens is gone, so until one arrives
            for (let waited: number = 0; received.length === 0 && waited < 5000; waited += 250) {
                await inject(PooledDataSource).publish('pooled.dropped', 'still there');
                await sleep(250);
            }

            expect(received[0]).toBe('still there');
        }
        finally {
            await subscription.unsubscribe();
        }
    });

    it('refuses to start while its role does not carry the settings it asks for, and names them', async () => {
        const roleSettings: string[] = inject(PooledDataSource).resolveRoleSettingsSql();
        await server?.runAsSuperuser(PooledDataSource, [
            'ALTER ROLE "postgres" RESET statement_timeout',
            // the pooler keeps the server connections it opened, and a role's settings reach only new ones
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = \'postgres\' AND pid <> pg_backend_pid()'
        ]);
        try {
            await expect(server?.reInit()).rejects.toThrow(roleSettings[0]);
        }
        finally {
            await server?.runAsSuperuser(PooledDataSource, [
                ...roleSettings,
                'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = \'postgres\' AND pid <> pg_backend_pid()'
            ]);
            await server?.reInit();
        }
    }, TestTimeouts.postgres.restart * 2);
});