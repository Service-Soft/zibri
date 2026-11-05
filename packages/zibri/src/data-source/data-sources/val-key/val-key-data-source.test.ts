import assert from 'node:assert';
import { Readable } from 'node:stream';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { DataSourceInterface } from '../data-source.interface';
import { ValKeyDataSource } from './val-key-data-source.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { createTestDataSource } from '../../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { CachedValue } from '../../../caching/store/cached-value.model';
import { ValKeyCacheStore } from '../../../caching/store/val-key.cache-store';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { RateLimitReservation } from '../../../rate-limiting/reservation/rate-limit-reservation.model';
import { RateLimitStateEntity } from '../../../rate-limiting/stores/rate-limit-state-entity.model';
import { BaseRateLimitState, RateLimiterStoreUpdateResult } from '../../../rate-limiting/stores/rate-limiter-store.interface';
import { RepositoryRateLimiterStore } from '../../../rate-limiting/stores/repository.rate-limiter-store';
import { ValKeyRateLimiterLock } from '../../../rate-limiting/stores/val-key.rate-limiter-lock';
import { Newable } from '../../../types/newable.type';
import { Bytes } from '../../../utilities/bytes';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { MigrationEntity } from '../../migration/migration-entity.model';
import { PaginationResult } from '../../models/pagination-result.model';
import { ValueConversion } from '../../models/value-conversion.enum';
import { Repository } from '../../repository/repository';
import { KeyDeclarationsChangedError } from '../../transaction/key-declarations-changed.error';
import { Transaction } from '../../transaction/transaction.model';
import { ValKeyTransaction } from '../../transaction/val-key-transaction.model';
import { UniqueConstraintViolationError } from '../../unique-constraint-violation.error';

// ---------- Test entities ----------

@Entity({ tenant: 'shared', allowOrphan: true })
class ValKeyTag extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.manyToMany({ target: () => ValKeyProduct, inverseSide: 'tags', joinTable: false })
    products!: ValKeyProduct[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
class ValKeyCategory extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => ValKeyProduct, inverseSide: 'category', cascade: ['insert'] })
    products!: ValKeyProduct[];
}

class ValKeyProductMetadata {
    @Property.string()
    color!: string;

    @Property.number()
    weight!: number;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class ValKeyProduct extends BaseEntity {
    @Property.string({ required: false })
    name: string | undefined | null;

    @Property.number({ required: false })
    price: number | undefined | null;

    @Property.boolean({ required: false })
    inStock: boolean | undefined | null;

    @Property.date({ required: false })
    createdAt: Date | undefined | null;

    @Property.array({ items: { type: 'string' }, required: false })
    labels: string[] | undefined | null;

    @Property.object({ cls: () => ValKeyProductMetadata, required: false })
    metadata: ValKeyProductMetadata | undefined | null;

    @Property.manyToOne({ target: () => ValKeyCategory, inverseSide: 'products', joinColumn: 'categoryId' })
    category!: ValKeyCategory;

    @Property.string({ format: 'uuid', required: false })
    categoryId: string | undefined | null;

    // no cascade, so a tag that has no id yet cannot be referenced here
    @Property.manyToMany({ target: () => ValKeyTag, inverseSide: 'products', joinTable: true })
    tags!: ValKeyTag[];
}

/**
 * A row addressed by something other than its id, which is what an upsert needs.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['sku']] })
class ValKeyStock extends BaseEntity {
    @Property.string()
    sku!: string;

    @Property.number()
    quantity!: number;
}

/**
 * A row looked up by something other than its id or a unique value: an index.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class ValKeyShelvedItem extends BaseEntity {
    @Property.string({ index: true })
    shelf!: string;

    @Property.string()
    name!: string;
}

/**
 * A row looked up by the leading part of an index group, and of a unique group.
 */
@Entity({ tenant: 'shared', allowOrphan: true, indexes: [['warehouse', 'shelf']], uniques: [['code', 'batch']] })
class ValKeyRoutedItem extends BaseEntity {
    @Property.string()
    warehouse!: string;

    @Property.string()
    shelf!: string;

    @Property.string()
    code!: string;

    @Property.string()
    batch!: string;

    @Property.string()
    name!: string;
}

/**
 * A row a restore and a renaming migration are interrupted on.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class ValKeyDoc extends BaseEntity {
    @Property.string({ required: false })
    title: string | undefined | null;

    @Property.string({ required: false })
    heading: string | undefined | null;
}

/**
 * The single property form of a unique declaration.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
class ValKeyAccount extends BaseEntity {
    @Property.string({ unique: true })
    email!: string;

    @Property.number({ required: false })
    logins: number | undefined | null;
}

/**
 * The multi property form, which is a different declaration rather than the same one repeated: only
 * the combination names at most one row, so either half on its own may repeat.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['tenant', 'name']] })
class ValKeyProject extends BaseEntity {
    @Property.string()
    tenant!: string;

    @Property.string()
    name!: string;
}

/**
 * A rate limit state whose algorithm specific part counts the updates it went through.
 */
type CountedRateLimitState = BaseRateLimitState & {
    /**
     * How many updates the state went through.
     */
    count?: number
};

/**
 * A stream that hands over the given lines and then fails, the way a cut connection does.
 * @param lines - The lines to produce before failing.
 * @returns The stream.
 */
function streamThatFailsAfter(lines: string[]): Readable {
    let index: number = 0;
    return new Readable({
        read(): void {
            if (index < lines.length) {
                this.push(lines[index]);
                index++;
                return;
            }
            this.destroy(new Error('the backup stream was cut'));
        }
    });
}

let server: StartedTestServer;
let dataSource: ValKeyDataSource;
let stockRepo: Repository<ValKeyStock>;
let productRepo: Repository<ValKeyProduct>;
let categoryRepo: Repository<ValKeyCategory>;
let tagRepo: Repository<ValKeyTag>;

const postgresDataSourceClass: Newable<DataSourceInterface> = createTestDataSource();

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    // MigrationEntity is duplicated across data sources on purpose, every one tracks its own migrations
    entities: [
        MigrationEntity,
        RateLimitStateEntity,
        ValKeyProduct,
        ValKeyCategory,
        ValKeyTag,
        ValKeyStock,
        ValKeyShelvedItem,
        ValKeyRoutedItem,
        ValKeyDoc,
        ValKeyAccount,
        ValKeyProject
    ]
});

beforeAll(async () => {
    server = await startTestServer({
        // the postgres data source keeps the framework entities (users, logs, ...) working,
        // the valkey data source is the one under test here
        dataSources: [postgresDataSourceClass, valKeyDataSourceClass]
    });
    dataSource = inject(valKeyDataSourceClass);
    productRepo = inject(repositoryTokenFor(ValKeyProduct));
    stockRepo = inject(repositoryTokenFor(ValKeyStock));
    categoryRepo = inject(repositoryTokenFor(ValKeyCategory));
    tagRepo = inject(repositoryTokenFor(ValKeyTag));
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

/**
 * Runs one step in a transaction of its own, the way a migration runs.
 * @param step - The step, given the transaction.
 */
async function inTransaction(step: (transaction: ValKeyTransaction) => Promise<void>): Promise<void> {
    const transaction: Transaction = await dataSource.startTransaction();
    assert(transaction instanceof ValKeyTransaction, 'a valkey data source hands out valkey transactions');
    await step(transaction);
    await transaction.commit();
}

beforeEach(async () => {
    await productRepo.deleteAll({});
    await categoryRepo.deleteAll({});
    await tagRepo.deleteAll({});
});

describe('ValKeyDataSource', () => {

    describe('repositories', () => {
        it('creates an entity and generates an id', async () => {
            const res: ValKeyProduct = await productRepo.create({ name: 'Alpha', price: 10 });

            expect(res.id).toBeDefined();
            expect(res.name).toBe('Alpha');
            expect(res.price).toBe(10);
        });

        it('finds an entity by its id', async () => {
            const created: ValKeyProduct = await productRepo.create({ name: 'Alpha', price: 10 });
            const res: ValKeyProduct = await productRepo.findById(created.id);

            expect(res.id).toBe(created.id);
            expect(res.name).toBe('Alpha');
        });

        it('throws a NotFoundError for an unknown id', async () => {
            await expect(productRepo.findById('does-not-exist')).rejects.toThrow(NotFoundError);
        });

        it('finds by id without reading every entity', async () => {
            const created: ValKeyProduct = await productRepo.create({ name: 'needle' });
            await productRepo.createAll(Array.from({ length: 50 }, (_, i) => ({ name: `haystack-${i}` })));

            // a filter that pins the id has to read that row directly, which is the whole point of a
            // key value store - going through every entity would make findById scale with the table
            const before: number = Date.now();
            const res: ValKeyProduct = await productRepo.findById(created.id);
            const durationMs: number = Date.now() - before;

            expect(res.name).toBe('needle');
            expect(durationMs).toBeLessThan(50);
        });

        it('narrows a filter that combines the id with other properties', async () => {
            const created: ValKeyProduct = await productRepo.create({ name: 'Alpha' });

            expect(await productRepo.findOne({ where: { id: created.id, name: 'Alpha' }, required: false })).toBeDefined();
            expect(await productRepo.findOne({ where: { id: created.id, name: 'Beta' }, required: false })).toBeUndefined();
        });

        it('reads only the listed rows for an oneOf filter on the id', async () => {
            const [a, b]: ValKeyProduct[] = await productRepo.createAll([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
            assert(a && b, 'the rows were not created');

            const res: ValKeyProduct[] = await productRepo.findAll({ where: { id: { oneOf: [a.id, b.id] } } });

            expect(res.map(p => p.name).sort()).toEqual(['a', 'b']);
        });

        it('creates all entities at once', async () => {
            const res: ValKeyProduct[] = await productRepo.createAll([{ name: 'a' }, { name: 'b' }]);

            expect(res).toHaveLength(2);
            expect(await productRepo.findAll()).toHaveLength(2);
        });

        it('updates an entity by its id', async () => {
            const created: ValKeyProduct = await productRepo.create({ name: 'Alpha', price: 10 });
            const res: ValKeyProduct = await productRepo.updateById(created.id, { price: 20 });

            expect(res.price).toBe(20);
            // untouched properties stay as they were
            expect(res.name).toBe('Alpha');
        });

        it('updates all entities that match a filter', async () => {
            await productRepo.createAll([{ name: 'a', price: 1 }, { name: 'b', price: 2 }]);
            const res: ValKeyProduct[] = await productRepo.updateAll({ name: 'a' }, { price: 99 }, { returnUpdated: true });

            expect(res).toHaveLength(1);
            expect(res[0]?.price).toBe(99);
        });

        it('does not let an upsert add to a value that another writer replaced while it waited', async () => {
            // the case an upsert is only correct because of the re-read it does after taking the row:
            // the value it adds to has to be the value that is stored, not the one it happened to see
            // before anyone else got there. Postgres re-checks after being granted a row lock, and
            // valkey has to do the same by hand.
            await stockRepo.create({ sku: 'widget', quantity: 0 });

            // holds the row without committing, so the upsert below reads 0 and then has to wait
            const transaction: Transaction = await dataSource.startTransaction();
            await stockRepo.updateAll({ sku: 'widget' }, { quantity: 100 }, { transaction });

            // started without a transaction of its own on purpose - it takes one out internally,
            // which is the path nothing else here covers
            const upsert: Promise<ValKeyStock> = stockRepo.upsert(
                { sku: 'widget' },
                { sku: 'widget', quantity: 1 },
                { quantity: { increment: 1 } }
            );

            // long enough for the upsert to have read the row and be queueing for it. Deterministic
            // rather than hoping two concurrent calls interleave the harmful way
            await new Promise<void>(resolve => {
                setTimeout(resolve, 200);
            });
            await transaction.commit();

            const res: ValKeyStock = await upsert;

            // 101, not 1. Adding to the 0 it first saw would silently drop the write it was waiting
            // on, which is exactly what it was waiting to avoid
            expect(res.quantity).toBe(101);
            expect((await stockRepo.findById(res.id)).quantity).toBe(101);
        }, 20000);

        it('refuses an upsert whose identity is not declared unique', async () => {
            // the identity has to name at most one row, and only the entity can say that it does.
            // Without the declaration this would pick one of the matches and look like it worked,
            // which is the failure the whole operation exists to avoid
            await expect(
                productRepo.upsert({ name: 'Alpha' }, { name: 'Alpha', price: 1 }, { price: { increment: 1 } })
            ).rejects.toThrow('declares nothing unique that covers exactly those properties');
        });

        it('does not update a row that stopped matching the filter while it waited for it', async () => {
            // the reason updateAll reads twice. The first read only says which rows to hold, because
            // nothing was holding them while it ran - the second is the one that decides, and a row
            // somebody else changed in between has to fall out of it. A database does the same
            // re-check after granting a row lock.
            const created: ValKeyStock = await stockRepo.create({ sku: 'gadget', quantity: 1 });

            // holds the row, uncommitted, and takes it out of the filter below
            const transaction: Transaction = await dataSource.startTransaction();
            await stockRepo.updateAll({ quantity: 1 }, { quantity: 5 }, { transaction });

            // matches the row as it currently reads, so this picks it up as a candidate and then has
            // to queue for it
            const update: Promise<number> = stockRepo.updateAll({ quantity: 1 }, { quantity: 100 });

            await new Promise<void>(resolve => {
                setTimeout(resolve, 200);
            });
            await transaction.commit();

            // nothing, because by the time it held the row the row was no longer a 1. Acting on the
            // first read would have written 100 over a value it never looked at
            expect(await update).toBe(0);
            expect((await stockRepo.findById(created.id)).quantity).toBe(5);
        }, 20000);

        it('deletes an entity by its id', async () => {
            const created: ValKeyProduct = await productRepo.create({ name: 'Alpha' });
            await productRepo.deleteById(created.id);

            expect(await productRepo.findAll()).toHaveLength(0);
            await expect(productRepo.findById(created.id)).rejects.toThrow(NotFoundError);
        });

        it('deletes all entities that match a filter', async () => {
            await productRepo.createAll([{ name: 'a' }, { name: 'b' }]);
            await productRepo.deleteAll({ name: 'a' });

            const res: ValKeyProduct[] = await productRepo.findAll();
            expect(res.map(p => p.name)).toEqual(['b']);
        });
    });

    describe('property types', () => {
        it('round trips dates, numbers, booleans, arrays and objects', async () => {
            const createdAt: Date = new Date('2024-01-01T12:00:00.000Z');
            const created: ValKeyProduct = await productRepo.create({
                name: 'Alpha',
                price: 42.5,
                inStock: true,
                createdAt,
                labels: ['a', 'b'],
                metadata: { color: 'red', weight: 100 }
            });

            const res: ValKeyProduct = await productRepo.findById(created.id);

            expect(res.createdAt).toBeInstanceOf(Date);
            expect(res.createdAt?.toISOString()).toBe(createdAt.toISOString());
            expect(res.price).toBe(42.5);
            expect(res.inStock).toBe(true);
            expect(res.labels).toEqual(['a', 'b']);
            expect(res.metadata).toEqual({ color: 'red', weight: 100 });
        });

        it('round trips null values', async () => {
            const created: ValKeyProduct = await productRepo.create({ name: null, price: null });
            const res: ValKeyProduct = await productRepo.findById(created.id);

            expect(res.name).toBeNull();
            expect(res.price).toBeNull();
        });
    });

    describe('where filters', () => {
        beforeEach(async () => {
            await productRepo.createAll([
                { name: 'Alpha', price: 10, labels: ['x'] },
                { name: 'Beta', price: 20, labels: ['x', 'y'] },
                { name: 'Gamma', price: 30, labels: [] }
            ]);
        });

        it('filters by an exact value', async () => {
            const res: ValKeyProduct[] = await productRepo.findAll({ where: { name: 'Alpha' } });
            expect(res.map(p => p.name)).toEqual(['Alpha']);
        });

        it('filters with operators', async () => {
            const res: ValKeyProduct[] = await productRepo.findAll({ where: { price: { greaterThan: 15 } } });
            expect(res.map(p => p.name).sort()).toEqual(['Beta', 'Gamma']);
        });

        it('filters with iLike', async () => {
            const res: ValKeyProduct[] = await productRepo.findAll({ where: { name: { iLike: 'al%' } } });
            expect(res.map(p => p.name)).toEqual(['Alpha']);
        });

        it('combines filters of an array with or', async () => {
            const res: ValKeyProduct[] = await productRepo.findAll({ where: [{ name: 'Alpha' }, { price: 30 }] });
            expect(res.map(p => p.name).sort()).toEqual(['Alpha', 'Gamma']);
        });

        it('filters by array contents', async () => {
            const res: ValKeyProduct[] = await productRepo.findAll({ where: { labels: { includes: ['y'] } } });
            expect(res.map(p => p.name)).toEqual(['Beta']);
        });

        it('counts only the matching entities', async () => {
            const res: PaginationResult<ValKeyProduct> = await productRepo.findAllPaginated(1, 10, { where: { price: { greaterThan: 15 } } });
            expect(res.totalAmount).toBe(2);
        });
    });

    describe('a migration rewriting stored values', () => {
        it('keeps a declared unique unique under the values it converted', async () => {
            await stockRepo.deleteAll({});
            await stockRepo.create({ sku: 'old', quantity: 1 });

            await inTransaction(transaction => dataSource.changePropertyOfEntity({
                entity: ValKeyStock,
                currentProperty: { name: 'sku', type: 'string' },
                property: { name: 'sku', type: 'string' },
                convert: { values: [{ from: 'old', to: 'new' }], default: ValueConversion.CAST },
                transaction
            }));

            // the rows were rewritten past the unique's index, which went on naming the old value: so
            // the old value stayed taken by a row that no longer held it, and the new one was free
            await expect(stockRepo.create({ sku: 'old', quantity: 2 })).resolves.toBeDefined();
            await expect(stockRepo.create({ sku: 'new', quantity: 3 })).rejects.toThrow(UniqueConstraintViolationError);
            expect((await stockRepo.findOne({ where: { sku: 'new' } })).quantity).toBe(1);
        });
    });

    describe('an index the entity declares', () => {
        it('answers a filter on it from the index booting built', async () => {
            const items: Repository<ValKeyShelvedItem> = inject(repositoryTokenFor(ValKeyShelvedItem));
            await items.createAll([{ shelf: 'a', name: 'first' }, { shelf: 'b', name: 'second' }, { shelf: 'a', name: 'third' }]);
            // a row whose name no read can parse, written past the repository: reading every row
            // reaches it and fails, so a read that succeeds is one that never looked at it
            const tableName: string = MetadataUtilities.getEntityMetadata(ValKeyShelvedItem)?.tableName ?? '';
            const brokenId: string = UUIDUtilities.generate();
            const brokenKey: string = `${dataSource.keyPrefix}:${tableName}:${brokenId}`;
            await inTransaction(async transaction => {
                await transaction.add({ type: 'hashSet', key: brokenKey, values: { id: `"${brokenId}"`, shelf: '"c"', name: '{not json' } });
                await transaction.add({ type: 'setAdd', key: `${dataSource.keyPrefix}:${tableName}:ids`, members: [brokenId] });
            });

            try {
                // reading every row reaches the broken one and fails
                await expect(items.findAll({ where: { name: 'first' } })).rejects.toThrow();

                expect((await items.findAll({ where: { shelf: 'a' } })).map(i => i.name).sort()).toEqual(['first', 'third']);
                expect((await items.findAll({ where: { shelf: { oneOf: ['a', 'b'] } } })).map(i => i.name).sort()).toEqual(['first', 'second', 'third']);
                expect(await items.count({ where: [{ shelf: 'b' }, { shelf: 'nowhere' }] })).toBe(1);

                // and kept true by the writes that move a row from one entry to another, or out of all of them
                const [first] = await items.findAll({ where: { name: 'first', shelf: 'a' } });
                assert(first != undefined, 'the first item was stored');
                await items.updateById(first.id, { shelf: 'b' });
                await items.deleteAll({ name: 'second', shelf: 'b' });
                expect((await items.findAll({ where: { shelf: 'b' } })).map(i => i.name)).toEqual(['first']);
                expect((await items.findAll({ where: { shelf: 'a' } })).map(i => i.name)).toEqual(['third']);
            }
            finally {
                await inTransaction(async transaction => {
                    await transaction.add({ type: 'delete', key: brokenKey });
                    await transaction.add({ type: 'setRemove', key: `${dataSource.keyPrefix}:${tableName}:ids`, members: [brokenId] });
                });
                await items.deleteAll({});
            }
        });

        it('answers a filter on the leading part of an index group or a unique group from the index', async () => {
            // an index answers a lookup by any leading part of itself, which is what lets an entity
            // declare (warehouse, shelf) and nothing on warehouse alone
            const items: Repository<ValKeyRoutedItem> = inject(repositoryTokenFor(ValKeyRoutedItem));
            await items.createAll([
                { warehouse: 'north', shelf: 'a', code: 'x', batch: '1', name: 'first' },
                { warehouse: 'north', shelf: 'b', code: 'x', batch: '2', name: 'second' },
                { warehouse: 'south', shelf: 'a', code: 'y', batch: '1', name: 'third' }
            ]);
            // a row whose name no read can parse, as above: a read that succeeds never looked at it
            const tableName: string = MetadataUtilities.getEntityMetadata(ValKeyRoutedItem)?.tableName ?? '';
            const brokenId: string = UUIDUtilities.generate();
            const brokenKey: string = `${dataSource.keyPrefix}:${tableName}:${brokenId}`;
            await inTransaction(async transaction => {
                await transaction.add({
                    type: 'hashSet',
                    key: brokenKey,
                    values: { id: `"${brokenId}"`, warehouse: '"east"', shelf: '"c"', code: '"z"', batch: '"9"', name: '{not json' }
                });
                await transaction.add({ type: 'setAdd', key: `${dataSource.keyPrefix}:${tableName}:ids`, members: [brokenId] });
            });

            try {
                await expect(items.findAll({ where: { name: 'first' } })).rejects.toThrow();

                expect((await items.findAll({ where: { warehouse: 'north' } })).map(i => i.name).sort()).toEqual(['first', 'second']);
                expect((await items.findAll({ where: { code: 'x' } })).map(i => i.name).sort()).toEqual(['first', 'second']);
                expect((await items.findAll({ where: { warehouse: 'north', shelf: 'b' } })).map(i => i.name)).toEqual(['second']);
            }
            finally {
                await inTransaction(async transaction => {
                    await transaction.add({ type: 'delete', key: brokenKey });
                    await transaction.add({ type: 'setRemove', key: `${dataSource.keyPrefix}:${tableName}:ids`, members: [brokenId] });
                });
                await items.deleteAll({});
            }
        });
    });

    describe('a transaction committing after the indexes and uniques it read changed', () => {
        it('applies nothing, and says to run it again', async () => {
            const items: Repository<ValKeyShelvedItem> = inject(repositoryTokenFor(ValKeyShelvedItem));
            const tagTable: string = MetadataUtilities.getEntityMetadata(ValKeyTag)?.tableName ?? '';
            const transaction: Transaction = await dataSource.startTransaction();
            assert(transaction instanceof ValKeyTransaction, 'a valkey data source hands out valkey transactions');

            await items.create({ shelf: 'g', name: 'guarded' }, { transaction });
            // as if it had read a list that booting replaced since, which is what a newer version
            // starting next to this one does
            transaction.guardKey(`${dataSource.keyPrefix}:${tagTable}:keys`, '');

            await expect(transaction.commit()).rejects.toThrow(KeyDeclarationsChangedError);
            expect(await items.count({ where: { name: 'guarded' } })).toBe(0);
        });

        it('tells the work waiting for its end that it was not committed', async () => {
            const items: Repository<ValKeyShelvedItem> = inject(repositoryTokenFor(ValKeyShelvedItem));
            const tagTable: string = MetadataUtilities.getEntityMetadata(ValKeyTag)?.tableName ?? '';
            const transaction: Transaction = await dataSource.startTransaction();
            assert(transaction instanceof ValKeyTransaction, 'a valkey data source hands out valkey transactions');
            const ended: boolean[] = [];
            transaction.afterFinish(async committed => await Promise.resolve(void ended.push(committed)));

            await items.create({ shelf: 'g', name: 'guarded' }, { transaction });
            transaction.guardKey(`${dataSource.keyPrefix}:${tagTable}:keys`, '');
            await expect(transaction.commit()).rejects.toThrow(KeyDeclarationsChangedError);
            // what a caller does on a commit that threw
            await transaction.rollback();

            expect(ended).toEqual([false]);
        });
    });

    describe('ordering and pagination', () => {
        beforeEach(async () => {
            await productRepo.createAll([
                { name: 'b', price: 2 },
                { name: 'a', price: 3 },
                { name: 'c', price: 1 }
            ]);
        });

        it('orders ascending', async () => {
            const res: ValKeyProduct[] = await productRepo.findAll({ order: { price: 'ASC' } });
            expect(res.map(p => p.price)).toEqual([1, 2, 3]);
        });

        it('orders descending', async () => {
            const res: ValKeyProduct[] = await productRepo.findAll({ order: { name: 'DESC' } });
            expect(res.map(p => p.name)).toEqual(['c', 'b', 'a']);
        });

        it('paginates', async () => {
            const res: PaginationResult<ValKeyProduct> = await productRepo.findAllPaginated(2, 2, { order: { price: 'ASC' } });

            expect(res.totalAmount).toBe(3);
            expect(res.items.map(p => p.price)).toEqual([3]);
        });
    });

    describe('relations', () => {
        it('resolves a many to one relation', async () => {
            const category: ValKeyCategory = await categoryRepo.create({ name: 'Food' });
            const created: ValKeyProduct = await productRepo.create({ name: 'Kibble', categoryId: category.id });

            const res: ValKeyProduct = await productRepo.findById(created.id, { relations: ['category'] });

            expect(res.category.id).toBe(category.id);
            expect(res.category.name).toBe('Food');
        });

        it('resolves a one to many relation', async () => {
            const category: ValKeyCategory = await categoryRepo.create({ name: 'Food' });
            await productRepo.createAll([
                { name: 'Kibble', categoryId: category.id },
                { name: 'Treats', categoryId: category.id }
            ]);

            const res: ValKeyCategory = await categoryRepo.findById(category.id, { relations: ['products'] });

            expect(res.products.map(p => p.name).sort()).toEqual(['Kibble', 'Treats']);
        });

        it('filters by a relation', async () => {
            const food: ValKeyCategory = await categoryRepo.create({ name: 'Food' });
            const toys: ValKeyCategory = await categoryRepo.create({ name: 'Toys' });
            await productRepo.createAll([
                { name: 'Kibble', categoryId: food.id },
                { name: 'Ball', categoryId: toys.id }
            ]);

            const res: ValKeyProduct[] = await productRepo.findAll({ where: { category: { where: { name: 'Food' } } } });

            expect(res.map(p => p.name)).toEqual(['Kibble']);
        });

        it('stores and resolves a many to many relation', async () => {
            const tagA: ValKeyTag = await tagRepo.create({ name: 'new' });
            const tagB: ValKeyTag = await tagRepo.create({ name: 'sale' });
            const created: ValKeyProduct = await productRepo.create({ name: 'Alpha', tags: [tagA, tagB] });

            const res: ValKeyProduct = await productRepo.findById(created.id, { relations: ['tags'] });

            expect(res.tags.map(t => t.name).sort()).toEqual(['new', 'sale']);
        });

        it('cascades inserts into a one to many relation that declares it', async () => {
            const created: ValKeyCategory = await categoryRepo.create({
                name: 'Food',
                products: [{ name: 'Kibble' }, { name: 'Treats' }]
            });

            const products: ValKeyProduct[] = await productRepo.findAll();
            expect(products.map(p => p.name).sort()).toEqual(['Kibble', 'Treats']);
            // the foreign key of the children points back at the parent
            expect(products.every(p => p.categoryId === created.id)).toBe(true);

            const res: ValKeyCategory = await categoryRepo.findById(created.id, { relations: ['products'] });
            expect(res.products).toHaveLength(2);
        });

        it('rejects a relation member without an id when the relation does not cascade inserts', async () => {
            await expect(productRepo.create({ name: 'Alpha', tags: [{ name: 'new' }] }))
                .rejects
                .toThrow(/has no id and the relation does not cascade inserts/);
        });

        it('resolves a many to many relation from its inverse side', async () => {
            const tag: ValKeyTag = await tagRepo.create({ name: 'new' });
            await productRepo.create({ name: 'Alpha', tags: [tag] });
            await productRepo.create({ name: 'Beta', tags: [tag] });

            const res: ValKeyTag = await tagRepo.findById(tag.id, { relations: ['products'] });

            expect(res.products.map(p => p.name).sort()).toEqual(['Alpha', 'Beta']);
        });

        it('removes a deleted entity from the relation of the entities it was related to', async () => {
            const tag: ValKeyTag = await tagRepo.create({ name: 'new' });
            const created: ValKeyProduct = await productRepo.create({ name: 'Alpha', tags: [tag] });

            await productRepo.deleteById(created.id);
            const res: ValKeyTag = await tagRepo.findById(tag.id, { relations: ['products'] });

            expect(res.products).toEqual([]);
        });

        it('replaces the members of a many to many relation on update', async () => {
            const tagA: ValKeyTag = await tagRepo.create({ name: 'new' });
            const tagB: ValKeyTag = await tagRepo.create({ name: 'sale' });
            const created: ValKeyProduct = await productRepo.create({ name: 'Alpha', tags: [tagA, tagB] });

            await productRepo.updateById(created.id, { tags: [tagB] });
            const res: ValKeyProduct = await productRepo.findById(created.id, { relations: ['tags'] });

            expect(res.tags.map(t => t.name)).toEqual(['sale']);
        });
    });

    describe('transactions', () => {
        it('applies every write of a committed transaction', async () => {
            const transaction: Transaction = await dataSource.startTransaction();
            await productRepo.create({ name: 'a' }, { transaction });
            await productRepo.create({ name: 'b' }, { transaction });

            // nothing has been written to the server yet
            expect(await productRepo.findAll()).toHaveLength(0);

            await transaction.commit();

            expect((await productRepo.findAll()).map(p => p.name).sort()).toEqual(['a', 'b']);
        });

        it('discards every write of a rolled back transaction', async () => {
            const transaction: Transaction = await dataSource.startTransaction();
            await productRepo.create({ name: 'a' }, { transaction });
            await transaction.rollback();

            expect(await productRepo.findAll()).toHaveLength(0);
        });

        it('reads its own writes inside the transaction', async () => {
            const transaction: Transaction = await dataSource.startTransaction();
            const created: ValKeyProduct = await productRepo.create({ name: 'a' }, { transaction });

            const res: ValKeyProduct = await productRepo.findById(created.id, { transaction });
            expect(res.name).toBe('a');

            await transaction.rollback();
        });

        it('reads a row it deleted and created again as it created it, without what it held before', async () => {
            const stored: ValKeyProduct = await productRepo.create({ name: 'a', price: 1 });
            const transaction: Transaction = await dataSource.startTransaction();
            await productRepo.deleteById(stored.id, { transaction });
            await productRepo.create({ id: stored.id, name: 'b' }, { transaction, allowId: true });

            const res: ValKeyProduct = await productRepo.findById(stored.id, { transaction });
            expect(res.name).toBe('b');
            expect(res.price).not.toBe(1);

            await transaction.rollback();
        });

        it('rejects a transaction that belongs to another data source', async () => {
            const postgresRepository: Repository<MigrationEntity> = inject(
                repositoryTokenFor(MigrationEntity, postgresDataSourceClass)
            );
            const postgresTransaction: Transaction = await postgresRepository.dataSource.startTransaction();

            await expect(productRepo.create({ name: 'a' }, { transaction: postgresTransaction }))
                .rejects
                .toThrow(/does not belong to a valkey data source/);

            await postgresTransaction.rollback();
        });

        it('tells the work waiting for its end whether it was committed, once', async () => {
            const ended: string[] = [];

            const committed: Transaction = await dataSource.startTransaction();
            await productRepo.create({ name: 'a' }, { transaction: committed });
            committed.afterFinish(async hasCommitted => await Promise.resolve(void ended.push(`committed: ${hasCommitted}`)));
            await committed.commit();

            const rolledBack: Transaction = await dataSource.startTransaction();
            await productRepo.create({ name: 'b' }, { transaction: rolledBack });
            rolledBack.afterFinish(async hasCommitted => await Promise.resolve(void ended.push(`rolled back: ${hasCommitted}`)));
            await rolledBack.rollback();
            await rolledBack.rollback();

            expect(ended).toEqual(['committed: true', 'rolled back: false']);
        });

        it('hands back the rows it held as it commits', async () => {
            const stored: ValKeyProduct = await productRepo.create({ name: 'a' });
            const transaction: Transaction = await dataSource.startTransaction();
            await productRepo.updateById(stored.id, { name: 'b' }, { transaction });
            await transaction.commit();

            // a row still held would keep this queueing until its claim gave up
            await productRepo.updateById(stored.id, { name: 'c' });

            expect((await productRepo.findById(stored.id)).name).toBe('c');
        });

        it('hands back the rows it held when its commit is refused', async () => {
            const stored: ValKeyProduct = await productRepo.create({ name: 'a' });
            const tagTable: string = MetadataUtilities.getEntityMetadata(ValKeyTag)?.tableName ?? '';
            const transaction: Transaction = await dataSource.startTransaction();
            assert(transaction instanceof ValKeyTransaction, 'a valkey data source hands out valkey transactions');
            await productRepo.updateById(stored.id, { name: 'b' }, { transaction });
            transaction.guardKey(`${dataSource.keyPrefix}:${tagTable}:keys`, '');
            await expect(transaction.commit()).rejects.toThrow(KeyDeclarationsChangedError);

            await productRepo.updateById(stored.id, { name: 'c' });

            expect((await productRepo.findById(stored.id)).name).toBe('c');
        });
    });

    describe('backups', () => {
        it('restores the state that the backup was created in', async () => {
            const created: ValKeyProduct = await productRepo.create({ name: 'Alpha', price: 10 });
            const backup: Readable = dataSource.createBackupData();
            const chunks: string[] = [];
            for await (const chunk of backup) {
                chunks.push(String(chunk));
            }

            await productRepo.deleteById(created.id);
            await productRepo.create({ name: 'created after the backup' });

            await dataSource.restoreBackup(Readable.from(chunks));

            const res: ValKeyProduct[] = await productRepo.findAll();
            expect(res.map(p => p.name)).toEqual(['Alpha']);
        });
    });

    describe('ValKeyCacheStore', () => {
        it('keeps the entries of two caches on one data source apart', async () => {
            const tasks: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            const users: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            tasks.attachTo('TaskCountCache');
            users.attachTo('UserCountCache');

            await tasks.set('u1', { createdAt: new Date(), value: 'tasks', tags: [] });
            await users.set('u1', { createdAt: new Date(), value: 'users', tags: [] });
            await users.clear();

            expect((await tasks.get('u1'))?.value).toBe('tasks');
            expect(await users.get('u1')).toBeUndefined();
            await tasks.clear();
        });

        it('invalidates an entry written while a tag of it was being invalidated', async () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            store.attachTo('InvalidatedWhileWritten');

            await Promise.all([
                store.invalidateTags(['t']),
                store.set('k2', { createdAt: new Date(), value: 'v', tags: ['t'] })
            ]);
            await store.invalidateTags(['t']);

            expect(await store.get('k2')).toBeUndefined();
            await store.clear();
        });

        it('takes a removed entry out of its tags', async () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            store.attachTo('PrunedTags');

            await store.set('k', { createdAt: new Date(), value: 'v', tags: ['t'] });
            await store.delete('k');

            // eslint-disable-next-line cspell/spellchecker
            expect(await dataSource.connection.scard(`${dataSource.keyPrefix}:cache:PrunedTags:tag:t`)).toBe(0);
            await store.clear();
        });

        it('keeps a value written while a read found the key missing', async () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            store.attachTo('WrittenDuringMiss');

            await Promise.all([
                store.get('k'),
                store.set('k', { createdAt: new Date(), value: 'written', tags: [] })
            ]);

            expect((await store.get('k'))?.value).toBe('written');
            await store.clear();
        });

        it.each(['mostRecentlyUsed', 'leastFrequentlyUsed'] as const)('keeps the entry it just wrote when it is full, by %s', async removeOnOverflow => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain', maxEntries: 2, removeOnOverflow });
            store.attachTo(`FullBy-${removeOnOverflow}`);

            for (const key of ['a', 'b', 'c']) {
                await store.set(key, { createdAt: new Date(), value: key, tags: [] });
            }

            expect((await store.get('c'))?.value).toBe('c');
            await store.clear();
        });

        it('refuses to hold the entries of a second cache', () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            store.attachTo('TaskCountCache');

            expect(() => store.attachTo('UserCountCache')).toThrow('holds the entries of one cache');
        });

        it('stores and reads a cached value', async () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            const value: CachedValue<string> = { createdAt: new Date(), value: 'cached', tags: ['tag-a'] };

            await store.set('key', value);
            const res: CachedValue<string> | undefined = await store.get('key');

            expect(res?.value).toBe('cached');
            expect(res?.createdAt).toBeInstanceOf(Date);
            await store.clear();
        });

        it('deletes a cached value', async () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            await store.set('key', { createdAt: new Date(), value: 'cached', tags: [] });
            await store.delete('key');

            expect(await store.get('key')).toBeUndefined();
            await store.clear();
        });

        it('invalidates by tag', async () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            await store.set('a', { createdAt: new Date(), value: 'a', tags: ['tag-a'] });
            await store.set('b', { createdAt: new Date(), value: 'b', tags: ['tag-b'] });

            await store.invalidateTags(['tag-a']);

            expect(await store.get('a')).toBeUndefined();
            expect((await store.get('b'))?.value).toBe('b');
            await store.clear();
        });

        it('evicts the least recently used entry when maxEntries is exceeded', async () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain', maxEntries: 2 });
            await store.set('a', { createdAt: new Date(), value: 'a', tags: [] });
            await store.set('b', { createdAt: new Date(), value: 'b', tags: [] });
            await store.get('a');
            await store.set('c', { createdAt: new Date(), value: 'c', tags: [] });

            expect(await store.size()).toBe(2);
            expect(await store.get('b')).toBeUndefined();
            expect((await store.get('a'))?.value).toBe('a');
            await store.clear();
        });

        it('evicts by age even when the keys sort the other way round', async () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain', maxEntries: 2 });

            // 'z' is written first and is therefore the one to evict, while being the *last* key
            // alphabetically. Recency is a sorted set score, and equal scores are broken
            // lexicographically - so if the score is not fine grained enough to tell these two
            // writes apart, eviction falls back to the name and takes 'a' instead. Nothing here
            // waits, so both writes land in the same millisecond.
            await store.set('z', { createdAt: new Date(), value: 'z', tags: [] });
            await store.set('a', { createdAt: new Date(), value: 'a', tags: [] });
            await store.set('m', { createdAt: new Date(), value: 'm', tags: [] });

            expect(await store.size()).toBe(2);
            expect(await store.get('z')).toBeUndefined();
            expect((await store.get('a'))?.value).toBe('a');
            expect((await store.get('m'))?.value).toBe('m');
            await store.clear();
        });

        it('respects the expiration of a cached value', async () => {
            const store: ValKeyCacheStore<string, string> = new ValKeyCacheStore(dataSource, { model: 'plain' });
            await store.set('key', {
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 100),
                value: 'cached',
                tags: []
            });

            expect((await store.get('key'))?.value).toBe('cached');
            await new Promise(resolve => setTimeout(resolve, 200));
            expect(await store.get('key')).toBeUndefined();
            await store.clear();
        });
    });

    describe('RepositoryRateLimiterStore', () => {
        const future: number = Date.now() + 60000;
        let store: RepositoryRateLimiterStore<BaseRateLimitState>;

        beforeEach(() => {
            store = new RepositoryRateLimiterStore(
                inject(repositoryTokenFor(RateLimitStateEntity, valKeyDataSourceClass)),
                new ValKeyRateLimiterLock(dataSource),
                // one per case, since every case builds its own in the one application
                `rate-limits-${UUIDUtilities.generate()}`
            );
        });

        // not the same thing as the `delete` each test ends with. Those run *after* their assertions,
        // so the first test to fail leaves its rows behind and the next one fails on a key it never
        // wrote - which reports the wrong test and hides the real one
        afterEach(async () => {
            await inject(repositoryTokenFor(RateLimitStateEntity, valKeyDataSourceClass)).deleteAll({});
        });

        it('creates the state on the first atomic update', async () => {
            const res: RateLimiterStoreUpdateResult<BaseRateLimitState> = await store.atomicUpdate(
                'user:1',
                () => ({ expiresAtMs: future, reservations: [] })
            );

            expect(res.sizeChanged).toBe(true);
            expect(await store.get('user:1')).toBeDefined();
            await store.delete('user:1');
        });

        it('passes the current state to the updater', async () => {
            await store.atomicUpdate('user:2', () => ({ expiresAtMs: future, reservations: [] }));

            const res: RateLimiterStoreUpdateResult<BaseRateLimitState> = await store.atomicUpdate('user:2', current => {
                expect(current?.expiresAtMs).toBe(future);
                return { expiresAtMs: future + 1, reservations: [] };
            });

            expect(res.value.expiresAtMs).toBe(future + 1);
            expect(res.sizeChanged).toBe(false);
            await store.delete('user:2');
        });

        it('keeps the algorithm specific part of the state', async () => {
            await store.atomicUpdate('tokens', () => ({ expiresAtMs: future, reservations: [], tokens: 4.5 } as BaseRateLimitState));

            const res: BaseRateLimitState & { tokens?: number } | undefined = await store.get('tokens');
            expect(res?.tokens).toBe(4.5);
            await store.delete('tokens');
        });

        it('lists its keys and deletes state', async () => {
            await store.atomicUpdate('ip:1.2.3.4', () => ({ expiresAtMs: future, reservations: [] }));

            expect(await store.keys()).toContain('ip:1.2.3.4');
            expect(await store.size()).toBeGreaterThan(0);

            await store.delete('ip:1.2.3.4');
            expect(await store.get('ip:1.2.3.4')).toBeUndefined();
        });

        it('treats an expired state as absent', async () => {
            await store.atomicUpdate('expired', () => ({ expiresAtMs: Date.now() - 1, reservations: [] }));

            expect(await store.get('expired')).toBeUndefined();
            expect(await store.keys()).not.toContain('expired');
            await store.delete('expired');
        });

        it('applies concurrent updates without losing any of them', async () => {
            await store.atomicUpdate('concurrent', () => ({ expiresAtMs: future, reservations: [], count: 0 } as BaseRateLimitState));

            await Promise.all(
                Array.from({ length: 10 }, () => store.atomicUpdate('concurrent', (current: CountedRateLimitState | undefined) => ({
                    ...current,
                    expiresAtMs: future,
                    reservations: [],
                    count: (current?.count ?? 0) + 1
                } as BaseRateLimitState)))
            );

            const res: CountedRateLimitState | undefined = await store.get('concurrent');
            expect(res?.count).toBe(10);
            await store.delete('concurrent');
        });

        it('loses no update even when the lock does not hold', async () => {
            // the lock has a ttl, so a section that outlives it - a slow query, a stalled event loop -
            // runs while somebody else already holds the lock. This is that situation: a lock that
            // guards nothing at all, which is the worst the expiry can do
            const unlocked: RepositoryRateLimiterStore<BaseRateLimitState> = new RepositoryRateLimiterStore(
                inject(repositoryTokenFor(RateLimitStateEntity, valKeyDataSourceClass)),
                { withLock: async (_key, run) => await run() },
                'unlocked-rate-limits'
            );
            await unlocked.atomicUpdate('unlocked', () => ({ expiresAtMs: future, reservations: [], count: 0 } as BaseRateLimitState));

            await Promise.all(
                Array.from({ length: 10 }, () => unlocked.atomicUpdate('unlocked', (current: CountedRateLimitState | undefined) => ({
                    ...current,
                    expiresAtMs: future,
                    reservations: [],
                    count: (current?.count ?? 0) + 1
                } as BaseRateLimitState)))
            );

            // without the version on the row this is where updates go missing: everyone reads the
            // same count and everyone writes it back plus one
            const res: CountedRateLimitState | undefined = await unlocked.get('unlocked');
            expect(res?.count).toBe(10);
            await unlocked.delete('unlocked');
        });

        it('keeps one row for a key whose first updates race without the lock', async () => {
            // the store takes a failing create for "somebody else created this key", which is only
            // true where the key is enforced unique. An insert has no row yet to carry a version, so
            // this is the case the version above cannot cover
            const unlocked: RepositoryRateLimiterStore<BaseRateLimitState> = new RepositoryRateLimiterStore(
                inject(repositoryTokenFor(RateLimitStateEntity, valKeyDataSourceClass)),
                { withLock: async (_key, run) => await run() },
                'unlocked-first-rate-limits'
            );

            await Promise.all(Array.from({ length: 3 }, () => unlocked.atomicUpdate('user:42', (current: CountedRateLimitState | undefined) => ({
                ...current,
                expiresAtMs: future,
                reservations: [],
                count: (current?.count ?? 0) + 1
            } as BaseRateLimitState))));

            // two rows for one key would count the limit twice and enforce it once, letting a caller
            // through during a burst, the only time it matters
            expect(await inject(repositoryTokenFor(RateLimitStateEntity, valKeyDataSourceClass)).findAll({ where: { key: 'user:42' } })).toHaveLength(1);
            const state: CountedRateLimitState | undefined = await unlocked.get('user:42');
            expect(state?.count).toBe(3);
        });

        it('deletes everything that expired in one operation', async () => {
            await store.atomicUpdate('gone-1', () => ({ expiresAtMs: Date.now() - 1, reservations: [] }));
            await store.atomicUpdate('gone-2', () => ({ expiresAtMs: Date.now() - 1, reservations: [] }));
            await store.atomicUpdate('stays', () => ({ expiresAtMs: future, reservations: [] }));

            await store.deleteExpired(Date.now());

            expect(await store.keys()).toEqual(['stays']);
            await store.delete('stays');
        });

        it('names only the keys holding a reservation nobody came back for', async () => {
            const reservation: (expiresAtMs: number) => RateLimitReservation = expiresAtMs => ({
                id: `r-${expiresAtMs}`,
                key: 'k',
                count: 1,
                readyAtMs: Date.now(),
                expiresAtMs
            });

            await store.atomicUpdate('quiet', () => ({ expiresAtMs: future, reservations: [] }));
            await store.atomicUpdate('pending', () => ({ expiresAtMs: future, reservations: [reservation(future)] }));
            await store.atomicUpdate('abandoned', () => ({ expiresAtMs: future, reservations: [reservation(Date.now() - 1)] }));

            // the filter runs in the data source rather than over every row here, which is what makes
            // running cleanup every ten seconds affordable
            expect(await store.keysWithExpiredReservations(Date.now())).toEqual(['abandoned']);

            for (const key of ['quiet', 'pending', 'abandoned']) {
                await store.delete(key);
            }
        });
    });
});

// an operation meant to be all or nothing must not do part of its work where nothing can take it
// back. Neither shows in a run that succeeds, which is why both cases interrupt one; each is paired
// with a control, so that breaking the accepted case cannot make the refused one pass
describe('ValKeyDataSource, interrupted', () => {
    let docRepository: Repository<ValKeyDoc>;

    beforeAll(() => {
        docRepository = inject(repositoryTokenFor(ValKeyDoc));
    });

    beforeEach(async () => {
        await docRepository.deleteAll({});
    });

    /**
     * Reads a full backup of the valkey data source into its lines.
     * @returns One string per backed up key.
     */
    async function backupLines(): Promise<string[]> {
        const chunks: string[] = [];
        for await (const chunk of dataSource.createBackupData()) {
            chunks.push(String(chunk));
        }
        return chunks;
    }

    it('restores the state the backup was created in', async () => {
        await docRepository.create({ title: 'Alpha' });
        const lines: string[] = await backupLines();

        await docRepository.deleteAll({});
        await dataSource.restoreBackup(Readable.from(lines));

        expect((await docRepository.findAll()).map(d => d.title)).toEqual(['Alpha']);
    });

    it('leaves the store as it was when the backup stream fails part way through', async () => {
        await docRepository.create({ title: 'Alpha' });
        await docRepository.create({ title: 'Beta' });
        const lines: string[] = await backupLines();
        // a backup worth restoring has more than one key in it, or there is nothing to be partial about
        expect(lines.length).toBeGreaterThan(1);

        await expect(dataSource.restoreBackup(streamThatFailsAfter(lines.slice(0, 1)))).rejects.toThrow();

        // deleting before the replacement is known to be good would leave a truncated stream, a
        // malformed line or a network blip with the store wiped and half filled
        expect((await docRepository.findAll()).map(d => d.title).sort()).toEqual(['Alpha', 'Beta']);
    });

    it('renames a property when the migration commits', async () => {
        const created: ValKeyDoc = await docRepository.create({ title: 'the original value' });
        const transaction: Transaction = dataSource.startTransaction();

        await dataSource.changePropertyOfEntity({
            entity: ValKeyDoc,
            currentProperty: { name: 'title', type: 'string', required: false },
            property: { name: 'heading', type: 'string', required: false },
            transaction
        });
        await transaction.commit();

        expect((await docRepository.findById(created.id)).heading).toBe('the original value');
    });

    it('keeps the old property when the migration is rolled back', async () => {
        const created: ValKeyDoc = await docRepository.create({ title: 'the original value' });
        const transaction: Transaction = dataSource.startTransaction();

        await dataSource.changePropertyOfEntity({
            entity: ValKeyDoc,
            currentProperty: { name: 'title', type: 'string', required: false },
            property: { name: 'heading', type: 'string', required: false },
            transaction
        });
        await transaction.rollback();

        // a removal of the old field issued straight away rather than with the transaction would
        // leave the value under neither name once the write of the new one is rolled back
        expect((await docRepository.findById(created.id)).title).toBe('the original value');
    });
});

// `unique` is declared on the entity, so what it means cannot depend on the store the entity is in
describe('ValKeyDataSource, a unique declaration', () => {
    let accountRepository: Repository<ValKeyAccount>;
    let projectRepository: Repository<ValKeyProject>;

    beforeAll(() => {
        accountRepository = inject(repositoryTokenFor(ValKeyAccount));
        projectRepository = inject(repositoryTokenFor(ValKeyProject));
    });

    beforeEach(async () => {
        await accountRepository.deleteAll({});
        await projectRepository.deleteAll({});
    });

    it('refuses a second row carrying a value the first one holds, naming the property, and leaves the first as it was', async () => {
        // the control: writing a row carrying a unique property at all works
        const first: ValKeyAccount = await accountRepository.create({ email: 'taken@example.com', logins: 1 });

        await expect(accountRepository.create({ email: 'taken@example.com', logins: 2 })).rejects.toThrow(UniqueConstraintViolationError);
        // the same answer a sql store gives
        await expect(accountRepository.create({ email: 'taken@example.com' })).rejects.toMatchObject({ properties: ['email'] });

        const stored: ValKeyAccount[] = await accountRepository.findAll();
        expect(stored.map(a => [a.id, a.logins])).toEqual([[first.id, 1]]);
    });

    it('lets a row be written again while it keeps the value it already holds', async () => {
        const created: ValKeyAccount = await accountRepository.create({ email: 'mine@example.com', logins: 1 });

        // its own id is what the index points at, and a row is not a duplicate of itself
        await accountRepository.updateById(created.id, { logins: 2 });

        expect((await accountRepository.findById(created.id)).logins).toBe(2);
    });

    it('frees a value once the row holding it moved to another one, or is deleted', async () => {
        const moved: ValKeyAccount = await accountRepository.create({ email: 'before@example.com' });
        await accountRepository.updateById(moved.id, { email: 'after@example.com' });
        const deleted: ValKeyAccount = await accountRepository.create({ email: 'gone@example.com' });
        await accountRepository.deleteById(deleted.id);

        await expect(accountRepository.create({ email: 'before@example.com' })).resolves.toBeDefined();
        await expect(accountRepository.create({ email: 'gone@example.com' })).resolves.toBeDefined();
    });

    it('refuses two rows of one save that carry the same value', async () => {
        // the rows of a save are written together, so neither is stored yet when the other is
        // checked: what answers has to be what the save already took, not only what the server holds
        await expect(accountRepository.createAll([
            { email: 'both@example.com' },
            { email: 'both@example.com' }
        ])).rejects.toThrow(UniqueConstraintViolationError);

        expect(await accountRepository.findAll()).toHaveLength(0);
    });

    it('refuses a group only once every property of it repeats', async () => {
        await projectRepository.create({ tenant: 'acme', name: 'website' });

        // either half on its own is free, which is what makes a group a declaration of its own rather
        // than two single ones
        await expect(projectRepository.create({ tenant: 'acme', name: 'intranet' })).resolves.toBeDefined();
        await expect(projectRepository.create({ tenant: 'other', name: 'website' })).resolves.toBeDefined();

        await expect(projectRepository.create({ tenant: 'acme', name: 'website' })).rejects.toThrow(UniqueConstraintViolationError);
    });
});

// two stores over one valkey are what two instances of an application are: the values and the
// bookkeeping keys all live on the server, and both write to them
describe('ValKeyCacheStore, shared by two instances', () => {
    /**
     * Far more than the stores below write, so that what removes an entry is what each case is about
     * rather than the limit.
     */
    const roomToSpare: number = Bytes.KB * 100;

    /**
     * A store over the shared valkey. Every store built on one data source shares its key prefix,
     * which is how two instances see one cache - and it makes them one store across cases too.
     * @returns The store.
     */
    function storeOverTheSharedValKey<K>(): ValKeyCacheStore<K, string> {
        return new ValKeyCacheStore(dataSource, { model: 'plain', maxBytes: roomToSpare, maxEntries: 1000 });
    }

    /**
     * A cached value with no expiry, so that nothing but the byte budget can remove it.
     * @param value - The value to cache.
     * @returns The cached value.
     */
    function permanent(value: string): CachedValue<string> {
        return { value, tags: [], createdAt: new Date() };
    }

    beforeEach(async () => {
        await storeOverTheSharedValKey<string>().clear();
    });

    it('keys an entry the way the in memory store keys it', async () => {
        const store: ValKeyCacheStore<{ userId: string, tenantId: string } | number | string, string> = storeOverTheSharedValKey();

        // an object key written as it came would make two call sites building the same key in
        // another order read each other's entries as misses
        await store.set({ userId: 'u3', tenantId: 't1' }, permanent('found'));
        expect((await store.get({ tenantId: 't1', userId: 'u3' }))?.value).toBe('found');

        // and the number and the string of the same digits are two keys
        await store.set(42, permanent('number'));
        await store.set('42', permanent('string'));
        expect((await store.get(42))?.value).toBe('number');
    });

    // a counter read and then increased by the difference lets both instances add the whole new
    // size: the store would then be over budget forever by what the losers of those races added,
    // evicting everything as fast as it is written
    it('keeps counting right when both instances write the same key at once', async () => {
        const first: ValKeyCacheStore<string, string> = storeOverTheSharedValKey();
        const second: ValKeyCacheStore<string, string> = storeOverTheSharedValKey();

        await Promise.all(Array.from({ length: 20 }, (_, i) => i).flatMap(i => [
            first.set('contended', permanent(`from-first-${i}`)),
            second.set('contended', permanent(`from-second-${i}`))
        ]));

        expect(await first.size()).toBe(1);
        for (let i: number = 0; i < 5; i++) {
            await first.set(`after-${i}`, permanent('still fits'));
        }
        for (let i: number = 0; i < 5; i++) {
            expect((await first.get(`after-${i}`))?.value).toBe('still fits');
        }
    });

    // subtracting a size twice would leave the counter below what the store holds, which turns the
    // budget off rather than tightening it
    it('keeps counting right when both instances remove the same key at once', async () => {
        const first: ValKeyCacheStore<string, string> = storeOverTheSharedValKey();
        const second: ValKeyCacheStore<string, string> = storeOverTheSharedValKey();

        await first.set('doomed', permanent('value'));
        await Promise.all([first.delete('doomed'), second.delete('doomed')]);

        await first.set('kept', permanent('value'));
        expect(await first.size()).toBe(1);
        expect((await first.get('kept'))?.value).toBe('value');
    });

    // the server drops a value when its time to live runs out and knows nothing of the index, the
    // sizes or the counter: without a sweep the entry takes up budget until its key is read again,
    // which for most keys is never
    it('gives back the room an expired entry held without waiting to be asked for it again', async () => {
        const store: ValKeyCacheStore<string, string> = storeOverTheSharedValKey();
        for (let i: number = 0; i < 5; i++) {
            await store.set(`short-lived-${i}`, { ...permanent('value'), expiresAt: new Date(Date.now() + 100) });
        }
        expect(await store.size()).toBe(5);

        await new Promise<void>(resolve => setTimeout(resolve, 300));

        expect(await store.removeExpired()).toBe(5);
        expect(await store.size()).toBe(0);
    });

    // whichever of the two finds it first, one entry expired: a number counting only the sweeps
    // would read near zero on exactly the caches whose keys are read often
    it('reports an expired entry a read already removed rather than losing it', async () => {
        const store: ValKeyCacheStore<string, string> = storeOverTheSharedValKey();
        await store.set('read-first', { ...permanent('value'), expiresAt: new Date(Date.now() + 100) });
        await new Promise<void>(resolve => setTimeout(resolve, 300));

        expect(await store.get('read-first')).toBeUndefined();
        expect(await store.removeExpired()).toBe(1);
    });
});