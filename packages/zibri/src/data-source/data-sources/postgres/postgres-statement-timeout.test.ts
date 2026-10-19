import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from './postgres-typeorm-data-source.model';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { TypeOrmUtilities } from '../../../utilities/typeorm.utilities';
import { SemVerVersion } from '../../../versioning/sem-ver.utilities';
import { DataSource } from '../../decorators/data-source.decorator';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { Migration } from '../../migration/migration.model';
import { SchemaManagement } from '../../models/schema-management.model';
import { Repository } from '../../repository/repository';
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
    await TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner.query('SELECT pg_sleep(0.5)');
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
    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, TimedRow];

    override migrations: Newable<Migration>[] = [SleepingMigration];

    schemaManagement: SchemaManagement = 'synchronize';

    protected override readonly statementTimeoutInMs: number = 200;
}

/**
 * Holds a single connection, which the schema setup and every later statement have to share.
 */
@DataSource()
class SingleConnectionDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false,
        poolSize: 1
    };

    entities: Newable<BaseEntity>[] = [MigrationEntity];

    schemaManagement: SchemaManagement = 'synchronize';
}

let server: StartedTestServer | undefined;
let rows: Repository<TimedRow>;

/**
 * Runs a statement on a connection of the pool, outside any transaction.
 * @param dataSourceClass - The data source to run it on.
 * @param sql - The statement.
 * @returns The rows it returned.
 */
async function runStatement(dataSourceClass: Newable<PostgresDataSource>, sql: string): Promise<Record<string, string>[]> {
    return await inject(dataSourceClass).query(MigrationEntity).connection.query<Record<string, string>[]>(sql);
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
    server = await startTestServer({ dataSources: [TimedDataSource, SingleConnectionDataSource] });
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
            await expect(TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner.query('SELECT pg_sleep(0.5)'))
                .rejects.toThrow(STATEMENT_TIMEOUT);
        }
        finally {
            await transaction.rollback();
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
});

describe('a data source with a single connection', () => {
    it('boots, and its connection keeps the lock and statement timeouts it started with', async () => {
        // booting at all is the first half: the schema lock used to hold the only connection while
        // the migrations and synchronize waited for one. The second is that what the lock sets on
        // its session never reaches the connection every later statement runs on
        const lockTimeout: Record<string, string>[] = await runStatement(SingleConnectionDataSource, 'SHOW lock_timeout');
        const statementTimeout: Record<string, string>[] = await runStatement(SingleConnectionDataSource, 'SHOW statement_timeout');

        expect(lockTimeout[0]?.['lock_timeout']).toBe('0');
        expect(statementTimeout[0]?.['statement_timeout']).toBe('30s');
    });
});