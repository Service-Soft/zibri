import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface, IsolationLevel } from '../data-sources/data-source.interface';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { ValKeyScanUtilities } from '../data-sources/val-key/val-key-scan.utilities';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';
import { TransactionSerializationError } from './transaction-serialization.error';
import { Transaction } from './transaction.model';

/**
 * A valkey transaction started with `REPEATABLE READ`, which read every key as it was committed when it
 * read it: a backup of a tenant read through one held a row written meanwhile without the rows it points at.
 */

@Entity({ tenant: 'shared', allowOrphan: true })
class ReadItem extends BaseEntity {
    @Property.string()
    name!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['code']] })
class UniqueReadItem extends BaseEntity {
    @Property.string()
    code!: string;
}

const postgresDataSourceClass: Newable<DataSourceInterface> = createTestDataSource();

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    // MigrationEntity is duplicated across data sources on purpose, every one tracks its own migrations
    entities: [MigrationEntity, ReadItem, UniqueReadItem]
});

let server: StartedTestServer | undefined;
let dataSource: ValKeyDataSource;
let items: Repository<ReadItem>;
let uniqueItems: Repository<UniqueReadItem>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    dataSource = inject(valKeyDataSourceClass);
    items = dataSource.getRepository(ReadItem);
    uniqueItems = dataSource.getRepository(UniqueReadItem);
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

/**
 * What a transaction reading as of one moment holds on the server: the copies writes make for it.
 * @returns Their keys.
 */
async function findCopies(): Promise<string[]> {
    return await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:zibri.backup:*`);
}

describe('a valkey transaction reading as of one moment', () => {
    it('reads as of its first read, with its own writes on top', async () => {
        await items.deleteAll({});
        const before: ReadItem = await items.create({ name: 'before' });
        const transaction: Transaction = dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        // as on postgres, what the transaction reads is fixed by its first read, not by its start
        await items.create({ name: 'before the first read' });
        await items.findById(before.id, { transaction });

        await items.create({ name: 'since' });
        await items.updateById(before.id, { name: 'renamed since' });
        await items.create({ name: 'own' }, { transaction });

        expect((await items.findAll({ transaction })).map(i => i.name).sort()).toEqual(['before', 'before the first read', 'own']);
        expect((await items.findAll()).map(i => i.name).sort()).toEqual(['before the first read', 'renamed since', 'since']);
        await transaction.rollback();
        expect(await findCopies()).toEqual([]);
    }, 30000);

    it('ends one writing a row another one changed since, to run again, and applies nothing', async () => {
        await items.deleteAll({});
        const item: ReadItem = await items.create({ name: 'ada' });
        const unrelated: ReadItem = await items.create({ name: 'grace' });
        const transaction: Transaction = dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        await items.findById(item.id, { transaction });

        await items.updateById(item.id, { name: 'changed outside' });
        await items.updateById(item.id, { name: 'changed inside' }, { transaction });
        await items.updateById(unrelated.id, { name: 'grace, inside' }, { transaction });

        await expect(transaction.commit()).rejects.toThrow(TransactionSerializationError);
        expect((await items.findById(item.id)).name).toBe('changed outside');
        expect((await items.findById(unrelated.id)).name).toBe('grace');
        expect(await findCopies()).toEqual([]);
    }, 30000);

    it('commits one whose rows nobody changed since, and keeps what was written beside it', async () => {
        await items.deleteAll({});
        const item: ReadItem = await items.create({ name: 'ada' });
        const other: ReadItem = await items.create({ name: 'grace' });
        const transaction: Transaction = dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        await items.findById(item.id, { transaction });

        await items.updateById(other.id, { name: 'grace, outside' });
        await items.updateById(item.id, { name: 'ada, inside' }, { transaction });
        await transaction.commit();

        expect((await items.findAll()).map(i => i.name).sort()).toEqual(['ada, inside', 'grace, outside']);
        expect(await findCopies()).toEqual([]);
    }, 30000);

    // a scan reads every key of the server, which a commit of a transaction that wrote two rows has no reason to
    it('deletes what writes copied for it by name when it ends, without looking through every key', async () => {
        await items.deleteAll({});
        const item: ReadItem = await items.create({ name: 'ada' });
        const other: ReadItem = await items.create({ name: 'grace' });
        const transaction: Transaction = dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        await items.findById(item.id, { transaction });
        // not vacuous: a write since copies for the transaction
        await items.updateById(other.id, { name: 'grace, outside' });
        expect((await findCopies()).length).toBeGreaterThan(0);
        await items.updateById(item.id, { name: 'ada, inside' }, { transaction });

        const scans: jest.Spied<typeof ValKeyScanUtilities.findKeyPages> = jest.spyOn(ValKeyScanUtilities, 'findKeyPages');
        try {
            await transaction.commit();
            expect(scans).not.toHaveBeenCalled();
        }
        finally {
            scans.mockRestore();
        }
        expect(await findCopies()).toEqual([]);
    }, 30000);

    it('reads the ids of a table as of its first read, noting only the ids written since rather than copying them', async () => {
        await items.deleteAll({});
        const kept: ReadItem = await items.create({ name: 'ada' });
        const deleted: ReadItem = await items.create({ name: 'grace' });
        const transaction: Transaction = dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        await items.findById(kept.id, { transaction });

        await items.create({ name: 'since' });
        await items.deleteById(deleted.id);

        expect((await items.findAll({ transaction })).map(i => i.name).sort()).toEqual(['ada', 'grace']);
        const held: string[] = await findCopies();
        expect(held.some(key => key.includes(':added:'))).toBe(true);
        expect(held.some(key => key.includes(':removed:'))).toBe(true);
        expect(held.filter(key => key.includes(':value:') && key.endsWith(':ids'))).toEqual([]);
        await transaction.rollback();
        expect(await findCopies()).toEqual([]);
    }, 30000);

    // what the transaction read of a value's holders and of the list of uniques went through its view, which
    // answered a set written since with a read of a row: it failed, where read as of the view a value taken
    // since would have read free and been stored twice
    it('refuses a unique value another one took up since its first read', async () => {
        await uniqueItems.deleteAll({});
        const before: UniqueReadItem = await uniqueItems.create({ code: 'before' });
        const transaction: Transaction = dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        await uniqueItems.findById(before.id, { transaction });

        await uniqueItems.create({ code: 'taken' });

        await expect(uniqueItems.create({ code: 'taken' }, { transaction })).rejects.toThrow(UniqueConstraintViolationError);
        await transaction.rollback();
        expect((await uniqueItems.findAll()).map(i => i.code).sort()).toEqual(['before', 'taken']);
        expect(await findCopies()).toEqual([]);
    }, 30000);

    it('takes up a unique value another one gave up since its first read', async () => {
        await uniqueItems.deleteAll({});
        const holder: UniqueReadItem = await uniqueItems.create({ code: 'given up' });
        const transaction: Transaction = dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        await uniqueItems.findById(holder.id, { transaction });

        await uniqueItems.deleteById(holder.id);

        const taken: UniqueReadItem = await uniqueItems.create({ code: 'given up' }, { transaction });
        await transaction.commit();
        expect((await uniqueItems.findAll()).map(i => i.id)).toEqual([taken.id]);
        expect(await findCopies()).toEqual([]);
    }, 30000);

    // its copies swept away as left behind, a write since its first read was found by nothing, and the commit
    // wrote over it
    it('refuses to commit one whose view lapsed, and applies nothing', async () => {
        await items.deleteAll({});
        const item: ReadItem = await items.create({ name: 'ada' });
        const transaction: Transaction = dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        await items.findById(item.id, { transaction });
        await items.updateById(item.id, { name: 'changed outside' });
        await items.updateById(item.id, { name: 'changed inside' }, { transaction });

        // what a process stalled past the heartbeat's life looks like to the server: the heartbeat gone
        for (const key of await ValKeyScanUtilities.findKeys(dataSource.connection, `${dataSource.keyPrefix}:zibri.aside:run:*`)) {
            await dataSource.connection.del([key]);
        }
        // and what the next one opening a view does with it: sweeps away what it held aside
        const next: Transaction = dataSource.startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
        await items.findById(item.id, { transaction: next });
        await next.rollback();

        // as a conflict, which runInTransaction runs again with a view of its own, naming the lapse in its cause
        let refused: unknown;
        try {
            await transaction.commit();
        }
        catch (error) {
            refused = error;
        }
        expect(refused).toBeInstanceOf(TransactionSerializationError);
        expect(refused instanceof Error ? String(refused.cause) : '').toContain('lapsed');
        expect((await items.findById(item.id)).name).toBe('changed outside');
        expect(await findCopies()).toEqual([]);
    }, 30000);
});