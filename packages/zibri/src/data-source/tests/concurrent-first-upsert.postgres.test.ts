import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
import { queryPostgres } from '../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { Repository } from '../repository/repository';
import { TransactionUpsertConflictError } from '../transaction/transaction-upsert-conflict.error';
import { Transaction } from '../transaction/transaction.model';
import { uniqueConstraintName } from '../unique-constraint-name.function';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';

/**
 * Two upserts of a row nobody holds yet, at the same moment, on an entity with a unique key besides
 * the identity: one of them inserts the row, and the other has to update it rather than be refused for
 * the other key, which the very row it updates holds.
 *
 * Both deciding to insert is a window of microseconds, which the first invoice numbers of a new
 * recipient fell into now and then. An index whose expression sleeps holds the first insert inside
 * it: postgres writes the keys of a row in the order their indexes were created, so the identity's
 * key, made again after the sleeping index, is written after the sleep and the other key before it.
 * The second upsert finds nothing under its identity yet, and waits on the other key.
 */

@Entity({ tenant: 'shared', allowOrphan: true })
class ClaimedName extends BaseEntity {
    /**
     * Who claimed the name, which identifies the row.
     */
    @Property.string({ unique: true })
    holder!: string;

    /**
     * The name, which only one holder may claim.
     */
    @Property.string({ unique: true })
    name!: string;
}

const TABLE: string = 'claimed_name';

/**
 * How long the first insert is held between deciding to insert and writing its identity's key.
 */
const HELD_IN_SECONDS: number = 1;

/**
 * A case waits for up to two held inserts, besides the statements around them.
 */
const CASE_TIMEOUT_IN_MS: number = 15000;

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ClaimedName],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let claims: Repository<ClaimedName>;

/**
 * Runs a statement written by hand.
 * @param sql - The statement.
 * @param values - What it binds.
 * @returns The rows it returned.
 */
async function run(sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
    return await queryPostgres(inject(dataSourceClass), sql, values);
}

/**
 * Claims a name for a holder, the way the invoice numbers claim an abbreviation for a recipient.
 * @param holder - The holder.
 * @param name - The name.
 * @param transaction - The transaction to claim it in.
 * @returns The row holding the claim.
 */
async function claim(holder: string, name: string, transaction?: Transaction): Promise<ClaimedName> {
    return await claims.upsert({ holder }, { holder, name }, { name: { set: name } }, { transaction });
}

/**
 * Waits until an insert is held inside the window.
 */
async function untilAnInsertIsHeld(): Promise<void> {
    await waitUntil(async () => (await run(
        'SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = $1',
        ['PgSleep']
    )).length > 0);
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    claims = inject(dataSourceClass).getRepository(ClaimedName);

    await run(`CREATE FUNCTION zi_held_key(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS 'BEGIN PERFORM pg_sleep(${HELD_IN_SECONDS}); RETURN value; END'`);
    await run(`CREATE INDEX "zi_held" ON "${TABLE}" (zi_held_key("holder"))`);
    // under the name the upsert refers to it by
    const identityKey: string = uniqueConstraintName(TABLE, ['holder']);
    await run(`ALTER TABLE "${TABLE}" DROP CONSTRAINT "${identityKey}"`);
    await run(`ALTER TABLE "${TABLE}" ADD CONSTRAINT "${identityKey}" UNIQUE ("holder")`);
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

describe('two upserts of a row nobody holds yet, at the same moment', () => {
    it('updates the row the other one inserted', async () => {
        const first: Promise<ClaimedName> = claim('first-holder', 'first-name');
        await untilAnInsertIsHeld();

        const second: ClaimedName = await claim('first-holder', 'first-name');

        expect(second.id).toBe((await first).id);
        expect(await claims.count({ where: { holder: 'first-holder' } })).toBe(1);
    }, CASE_TIMEOUT_IN_MS);

    it('ends a transaction of the caller as a conflict, which running it again resolves', async () => {
        const first: Promise<ClaimedName> = claim('second-holder', 'second-name');
        await untilAnInsertIsHeld();
        const transaction: Transaction = await claims.dataSource.startTransaction();

        await expect(claim('second-holder', 'second-name', transaction)).rejects.toThrow(TransactionUpsertConflictError);
        await transaction.rollback();
        await first;

        const third: Promise<ClaimedName> = claim('third-holder', 'third-name');
        await untilAnInsertIsHeld();
        const claimed: ClaimedName = await claims.dataSource.runInTransaction(
            async again => await claim('third-holder', 'third-name', again),
            { maxAttempts: 2 }
        );
        expect(claimed.id).toBe((await third).id);
    }, CASE_TIMEOUT_IN_MS);

    it('still refuses a name another holder claimed, with or without a transaction', async () => {
        await claim('fourth-holder', 'fourth-name');

        await expect(claim('other-holder', 'fourth-name')).rejects.toThrow(UniqueConstraintViolationError);
        const transaction: Transaction = await claims.dataSource.startTransaction();
        await expect(claim('other-holder', 'fourth-name', transaction)).rejects.toThrow(UniqueConstraintViolationError);
        await transaction.rollback();
    }, CASE_TIMEOUT_IN_MS);
});