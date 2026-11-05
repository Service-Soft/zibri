import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { OperationLimitUtilities } from '../../../context/operation-limit.utilities';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { GatewayTimeoutError } from '../../../error-handling/errors/gateway-timeout.error';
import { HttpStatus } from '../../../http/http-status.enum';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Newable } from '../../../types/newable.type';
import { SemVerVersion } from '../../../utilities/sem-ver.utilities';
import { DataSource } from '../../decorators/data-source.decorator';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Migration } from '../../migration/migration.model';
import { SchemaManagement } from '../../models/schema-management.model';
import { Repository } from '../../repository/repository';
import { RepositoryClass } from '../../repository/repository-class.type';
import { Transaction } from '../../transaction/transaction.model';

/**
 * What postgres says when it stops a statement for having run out of time.
 */
const STATEMENT_TIMEOUT: string = 'canceling statement due to statement timeout';

@Entity({ tenant: 'shared', allowOrphan: true })
class TimedRow extends BaseEntity {
    @Property.string()
    value!: string;
}

/**
 * Sleeps for longer than the data source gives a statement, inside the migration's transaction.
 * @param transaction - The transaction of the migration.
 */
async function sleepPastTheStatementTimeout(transaction: Transaction): Promise<void> {
    await queryPostgres(inject(TimedDataSource), 'SELECT pg_sleep(0.5)', [], transaction);
}

/**
 * Takes longer than a statement may, which the migration timeout - no limit, by default - allows.
 */
@Injectable()
class SleepingMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(TimedDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await sleepPastTheStatementTimeout(transaction);
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not needed here.');
    }
}

/**
 * The same, under a timeout of its own that it runs past.
 */
@Injectable()
class CappedSleepingMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    override readonly timeoutInMs: number = 100;

    constructor() {
        super(TimedDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await sleepPastTheStatementTimeout(transaction);
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not needed here.');
    }
}

/**
 * Gives a statement a fifth of a second.
 */
@DataSource()
class TimedDataSource extends PostgresDataSource {
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, TimedRow];

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    override migrations: Newable<Migration>[] = [SleepingMigration];

    schemaManagement: SchemaManagement = 'synchronize';

    readonly pooler: PostgresPooler = 'none';

    protected override readonly statementTimeoutInMs: number = 200;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class WaitingRow extends BaseEntity {
    @Property.string()
    value!: string;
}

/**
 * How a call waiting for a connection ended, or that it had not ended yet.
 */
type WaitOutcome = 'answered' | 'gave up' | 'still waiting';

/**
 * Holds a single connection, which the schema setup and every later statement have to share, and
 * which a transaction left open takes from everyone.
 */
@DataSource()
class SingleConnectionDataSource extends PostgresDataSource {
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false,
        poolSize: 1,
        connectTimeoutInMs: 1000
    };

    entities: Newable<BaseEntity>[] = [MigrationEntity, WaitingRow];

    readonly repositories: RepositoryClass[] = [];

    schemaManagement: SchemaManagement = 'synchronize';

    readonly pooler: PostgresPooler = 'none';
}

/**
 * The statement of the last request to the controller below, once it came back.
 */
let sleeping: Promise<unknown> | undefined;

@Controller('/timed')
class TimedController {
    // well inside the statement timeout of the data source, so what stops the statement is the request
    @Get('/sleep', { timeoutInMs: 50 })
    async sleep(): Promise<{ ok: boolean }> {
        sleeping = queryPostgres(inject(TimedDataSource), 'SELECT pg_sleep(0.15)');
        await sleeping;
        return { ok: true };
    }
}

let server: StartedTestServer | undefined;
let baseUrl: string;
let rows: Repository<TimedRow>;

/**
 * Runs a statement on a connection of the pool, outside any transaction.
 * @param dataSourceClass - The data source to run it on.
 * @param sql - The statement.
 * @returns The rows it returned.
 */
async function runStatement(dataSourceClass: Newable<PostgresDataSource>, sql: string): Promise<Record<string, unknown>[]> {
    return await queryPostgres(inject(dataSourceClass), sql);
}

/**
 * Starts a transaction that holds the lock on the given row until it is committed.
 * @param id - The row to lock.
 * @returns The transaction.
 */
async function lockRow(id: string): Promise<Transaction> {
    const holder: Transaction = await inject(TimedDataSource).startTransaction();
    await rows.updateById(id, { value: 'held' }, { transaction: holder });
    return holder;
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [TimedDataSource, SingleConnectionDataSource], controllers: [TimedController] });
    baseUrl = await server.start();
    rows = inject(repositoryTokenFor(TimedRow));
}, 90000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describe('the time a statement may take', () => {
    it('stops a statement that runs past the data source\'s statement timeout', async () => {
        await expect(runStatement(TimedDataSource, 'SELECT pg_sleep(0.5)')).rejects.toThrow(STATEMENT_TIMEOUT);
    });

    it('lets a call wait longer when it names a timeout of its own', async () => {
        const row: TimedRow = await rows.create({ value: 'free' });
        const holder: Transaction = await lockRow(row.id);

        // waits on the row's lock for longer than a statement may take, and is let through once the
        // holder lets go
        const waiting: Promise<TimedRow> = rows.updateById(row.id, { value: 'waited' }, { timeoutInMs: 5000 });
        await sleep(500);
        await holder.commit();

        expect((await waiting).value).toBe('waited');
    });

    it('stops the same wait without one', async () => {
        const row: TimedRow = await rows.create({ value: 'free' });
        const holder: Transaction = await lockRow(row.id);
        try {
            await expect(rows.updateById(row.id, { value: 'waited' })).rejects.toThrow(STATEMENT_TIMEOUT);
        }
        finally {
            await holder.rollback();
        }
    });

    it('gives the caller\'s transaction its own timeout back once the call is done', async () => {
        const row: TimedRow = await rows.create({ value: 'free' });
        const holder: Transaction = await lockRow(row.id);
        const transaction: Transaction = await inject(TimedDataSource).startTransaction();
        try {
            const waiting: Promise<TimedRow> = rows.updateById(row.id, { value: 'waited' }, { transaction, timeoutInMs: 5000 });
            await sleep(500);
            await holder.commit();
            expect((await waiting).value).toBe('waited');

            // the call's limit was set for the transaction, and has to be gone again for the rest of it
            await expect(queryPostgres(inject(TimedDataSource), 'SELECT pg_sleep(0.5)', [], transaction))
                .rejects.toThrow(STATEMENT_TIMEOUT);
        }
        finally {
            await transaction.rollback();
        }
    });
});

describe('a request that runs out of time while its statement runs', () => {
    // found in the transaction pooler suite, 2026-11-01: the statement the deadline stopped came back
    // as postgres' own cancel, which did not read as the deadline, so every such timeout also logged
    // the handler as having failed after it was answered
    it('stops the statement, and reports the deadline alone', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        const errors: jest.Spied<LoggerInterface['error']> = jest.spyOn(logger, 'error');
        try {
            const res: Response = await fetch(`${baseUrl}/timed/sleep`);
            expect(res.status).toBe(HttpStatus.GATEWAY_TIMEOUT);

            // stopped, and failing with what every other wait the deadline ends fails with
            await expect(sleeping).rejects.toBeInstanceOf(GatewayTimeoutError);
            // the report of a failure after the deadline is written once the handler has come back
            await sleep(100);

            const messages: string[] = errors.mock.calls.map(([error]) => error instanceof Error ? error.message : String(error));
            expect(messages).not.toContain('A request handler failed after its deadline had been answered.');
        }
        finally {
            errors.mockRestore();
        }
    });
});

describe('the time a migration may take', () => {
    it('runs a migration past the statement timeout, which the migration timeout lifts', async () => {
        const migrations: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity, TimedDataSource));

        const recorded: MigrationEntity[] = await migrations.findAll({ where: { name: SleepingMigration.name } });

        expect(recorded).toHaveLength(1);
    });

    it('stops a migration that runs past a timeout of its own, and records nothing', async () => {
        const migrations: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity, TimedDataSource));

        await expect(new CappedSleepingMigration().runUp()).rejects.toThrow();

        expect(await migrations.findAll({ where: { name: CappedSleepingMigration.name } })).toEqual([]);
    });

    it('creates the table the migrations are recorded in under the migration timeout as well', async () => {
        // creating it is the first step of the schema setup, and takes longer than a statement may
        // here: an event trigger sleeps whenever it is created
        await server?.runAsSuperuser(TimedDataSource, [
            'CREATE FUNCTION sleep_on_migration_table() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN'
            + ' IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity LIKE \'%migration_entity\')'
            + ' THEN PERFORM pg_sleep(0.5); END IF; END $$',
            'CREATE EVENT TRIGGER sleep_on_migration_table ON ddl_command_end EXECUTE FUNCTION sleep_on_migration_table()',
            'DROP TABLE migration_entity'
        ]);
        try {
            await server?.reInit();

            const migrations: Repository<MigrationEntity> = inject(repositoryTokenFor(MigrationEntity, TimedDataSource));
            expect(await migrations.findAll({ where: { name: SleepingMigration.name } })).toHaveLength(1);
        }
        finally {
            await server?.runAsSuperuser(TimedDataSource, ['DROP EVENT TRIGGER sleep_on_migration_table']);
        }
    }, 60000);
});

describe('a data source with a single connection', () => {
    it('boots, and its connection keeps the lock and statement timeouts it started with', async () => {
        // booting at all is the first half: the schema lock used to hold the only connection while
        // the migrations and synchronize waited for one. The second is that what the lock sets on
        // its session never reaches the connection every later statement runs on
        const lockTimeout: Record<string, unknown>[] = await runStatement(SingleConnectionDataSource, 'SHOW lock_timeout');
        const statementTimeout: Record<string, unknown>[] = await runStatement(SingleConnectionDataSource, 'SHOW statement_timeout');

        expect(lockTimeout[0]?.['lock_timeout']).toBe('0');
        expect(statementTimeout[0]?.['statement_timeout']).toBe('30s');
    });

    // the statement timeout starts with the statement, so nothing else bounds the wait for a connection
    describe('waiting for its connection', () => {
        let waitingRows: Repository<WaitingRow>;

        beforeAll(() => {
            waitingRows = inject(repositoryTokenFor(WaitingRow));
        });

        it('gives up once the call has run out of the timeoutInMs it was given', async () => {
            const holder: Transaction = await inject(SingleConnectionDataSource).startTransaction();
            try {
                // under the pool's own wait, so only the call's limit can have ended it
                expect(await answerWithin(waitingRows.findAll({ timeoutInMs: 200 }), 900)).toBe('gave up');
            }
            finally {
                // hands the connection back, which the call still waiting takes
                await holder.rollback();
            }
            // the connection the call that gave up was handed once it came free went back to the pool
            await expect(answerWithin(waitingRows.findAll({}), 2000)).resolves.toBe('answered');
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
            await expect(answerWithin(waitingRows.findAll({}), 2000)).resolves.toBe('answered');
        });

        it('gives up a call without a limit of its own once the pool has kept it waiting for connectTimeoutInMs', async () => {
            const holder: Transaction = await inject(SingleConnectionDataSource).startTransaction();
            try {
                // eslint-disable-next-line promise/prefer-await-to-then
                const waiting: Promise<WaitOutcome> = waitingRows.findAll({}).then((): WaitOutcome => 'answered', (): WaitOutcome => 'gave up');

                expect(await answerWithin(waiting, 3000)).toBe('gave up');
            }
            finally {
                await holder.rollback();
            }
        });
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