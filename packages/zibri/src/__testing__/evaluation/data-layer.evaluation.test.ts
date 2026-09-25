import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { QueryRunner, Table, TableColumn, Logger as TypeOrmLogger } from 'typeorm';

import { ChangeSetType } from '../../change-sets/models/change-set-type.enum';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository';
import { IsolationLevel } from '../../data-source/data-sources/data-source.interface';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres/postgres-typeorm-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { SchemaManagement } from '../../data-source/models/schema-management.model';
import { whereFor } from '../../data-source/models/where/where-for.function';
import { Repository, UNBOUNDED_FIND_ALL_LIMIT } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { UniqueConstraintViolationError } from '../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity, EntityMetadata } from '../../entity/decorators/entity.decorator';
import { Property, PropertyMetadata } from '../../entity/decorators/property.decorator';
import { scopeFor } from '../../entity/models/entity-scope.model';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { TypeOrmUtilities } from '../../utilities/typeorm.utilities';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/01-data-layer.md.
 *
 * Every expectation here describes the fixed behavior, so the whole file is red until the
 * corresponding finding is closed. See ./README.md for why.
 */

// ---------- Test entities ----------

@Entity({ allowOrphan: true })
class EvalOrder extends BaseEntity {
    @Property.string()
    reference!: string;

    /**
     * A constant default, which is the kind a column can hold as well.
     */
    @Property.string({ required: false, default: 'NEW' })
    status: string | undefined | null;

    @Property.number({ required: false })
    total: number | undefined | null;

    /**
     * A default that is a function of when the row is written, which is the kind a column cannot run.
     */
    @Property.date({ required: false, default: () => new Date() })
    queuedAt: Date | undefined | null;

    /**
     * Writing this without saying what it was is refused, rather than silently winning.
     */
    @Property.string({ required: false, optimisticLocking: true })
    owner: string | undefined | null;
}

/**
 * Every column optional on purpose.
 *
 * An update that misses its row falls back to an insert, and what happens next is decided by the
 * entity rather than by the repository: with a required column the insert breaks a constraint, with
 * none it quietly succeeds. This is the second case, which is the one that leaves no trace.
 */
@Entity({ allowOrphan: true })
class EvalNote extends BaseEntity {
    @Property.string({ required: false })
    body: string | undefined | null;
}

/**
 * Scoped so that an archived row is out of reach for everyone.
 *
 * A static scope rather than one keyed on the current user, because what is being tested is what a
 * caller is told about a row they cannot see, and that does not need a login to arise.
 */
@Entity({
    allowOrphan: true,
    scope: { restrictedTo: scopeFor<EvalScopedOrder>(() => ({ archived: false })) }
})
class EvalScopedOrder extends BaseEntity {
    @Property.boolean()
    archived!: boolean;

    @Property.string({ required: false, optimisticLocking: true })
    owner: string | undefined | null;
}

/**
 * A real soft delete entity, because that is what the finding is about.
 *
 * It used to be a plain entity carrying a `deleted` column, which meant the test could describe the
 * problem but never the fix: nothing about a boolean property tells the framework that the row is
 * gone.
 */
@Entity({ allowOrphan: true })
class EvalAccount extends SoftDeleteEntity {
    @Property.string({ unique: { where: whereFor<EvalAccount>({ deleted: false }) } })
    email!: string;
}

/**
 * The same thing where no column is unique on its own - one address per tenant, among live rows.
 */
@Entity({
    allowOrphan: true,
    uniques: [{ properties: ['tenantId', 'email'], where: whereFor<EvalTenantAccount>({ deleted: false }) }]
})
class EvalTenantAccount extends SoftDeleteEntity {
    @Property.string()
    tenantId!: string;

    @Property.string()
    email!: string;
}

let server: StartedTestServer | undefined;
let orderRepo: Repository<EvalOrder>;
let noteRepo: Repository<EvalNote>;
let scopedOrderRepo: Repository<EvalScopedOrder>;

/**
 * Counts the statements the driver actually issues, so "does this scale with the row count" is
 * measured rather than timed. A 500ms threshold over 300 rows passed comfortably on a local
 * container and detected nothing.
 */
let statementCount: number = 0;

/**
 * The reads among them, counted separately because reading a row twice and writing a row twice are
 * different problems: one is answered by how many statements there are at all, the other by how many
 * of them fetch the same row.
 */
let readCount: number = 0;

const statementCountingLogger: TypeOrmLogger = {
    logQuery: (query: string) => {
        statementCount++;
        if (query.trimStart().toUpperCase()
            .startsWith('SELECT')) {
            readCount++;
        }
    },
    logQueryError: () => {},
    logQuerySlow: () => {},
    logSchemaBuild: () => {},
    logMigration: () => {},
    log: () => {}
};

@DataSource()
class EvalDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        logging: true,
        logger: statementCountingLogger
    };

    entities: Newable<BaseEntity>[] = [
        ...defaultTestServerEntities,
        EvalOrder,
        EvalAccount,
        EvalTenantAccount,
        EvalNote,
        EvalScopedOrder
    ];

    schemaManagement: SchemaManagement = 'synchronize';
}

const dataSourceClass: Newable<PostgresDataSource> = EvalDataSource;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    orderRepo = inject(repositoryTokenFor(EvalOrder));
    noteRepo = inject(repositoryTokenFor(EvalNote));
    scopedOrderRepo = inject(repositoryTokenFor(EvalScopedOrder));
}, 60000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 30000);

beforeEach(async () => {
    // one statement per table rather than deleteAll, which M3 is about: it reads every matching row
    // and deletes them one at a time, and the M4 test leaves ten thousand of them behind. A fixture
    // that resets through the operation the file is asserting is broken pays for it in every test
    const dataSource: PostgresDataSource = inject(dataSourceClass);
    const transaction: Transaction = await dataSource.startTransaction();
    const queryRunner: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner;
    await queryRunner.query(`DELETE FROM ${MetadataUtilities.getEntityMetadata(EvalOrder)?.tableName}`);
    await queryRunner.query(`DELETE FROM ${MetadataUtilities.getEntityMetadata(EvalNote)?.tableName}`);
    await queryRunner.query(`DELETE FROM ${MetadataUtilities.getEntityMetadata(EvalScopedOrder)?.tableName}`);
    await transaction.commit();
});

describe('evaluation/01-data-layer', () => {

    // C1 (synchronize must be opt-in) lives in ./bootstrap.evaluation.test.ts, because it needs a
    // data source of its own and startTestServer resets the DI singleton.

    describe('M1 - concurrent edits of the same property', () => {
        // The version column this finding asks for is deliberately not here. A counter is a token for
        // the whole row, so it clashes on any concurrent write - two people editing a company's name
        // and its phone number would be told they conflicted when nothing they touched overlapped.
        // The unit that clashes is the property, which means comparing values, which means the value
        // the editor was looking at. The server cannot know it: by the time the update arrives, a
        // read returns the value including the other write. So it comes back from the caller, and
        // `where` is where it goes - which also covers what a counter cannot express at all, namely
        // locking on a property you read but are not writing.

        it('lets two callers change different properties of the same row without clashing', async () => {
            const created: EvalOrder = await orderRepo.create({ reference: 'A', status: 'new', owner: 'ann' });

            // both read the same row, then each writes a different property of it
            const first: EvalOrder = await orderRepo.findById(created.id);
            const second: EvalOrder = await orderRepo.findById(created.id);

            await orderRepo.updateById(first.id, { owner: 'bob' }, { where: { owner: first.owner } });
            await orderRepo.updateById(second.id, { status: 'shipped' });

            const after: EvalOrder = await orderRepo.findById(created.id);
            expect(after.owner).toBe('bob');
            expect(after.status).toBe('shipped');
        });

        it('refuses the second write when both callers changed the same property', async () => {
            const created: EvalOrder = await orderRepo.create({ reference: 'B', owner: 'ann' });

            const first: EvalOrder = await orderRepo.findById(created.id);
            const second: EvalOrder = await orderRepo.findById(created.id);

            await orderRepo.updateById(first.id, { owner: 'bob' }, { where: { owner: first.owner } });

            // `second` read before that landed, so writing back what it saw must not silently win.
            // Told that the row changed rather than that it is missing, because this caller can see
            // it - the answer is what to do next, which is read it again and decide
            await expect(
                orderRepo.updateById(second.id, { owner: 'admin' }, { where: { owner: second.owner } })
            ).rejects.toThrow(ConflictError);

            expect((await orderRepo.findById(created.id)).owner).toBe('bob');
        });

        it('says only that the row is gone when the caller was never allowed to see it', async () => {
            // the row is there and the condition on it holds - the only thing standing between this
            // caller and the write is the scope. Answering that as a conflict would confirm the id
            // exists to somebody who cannot read it, which is why the two are told apart by a read
            // that goes through the scope rather than by which condition failed
            const hidden: EvalScopedOrder = await scopedOrderRepo.create(
                { archived: true, owner: 'ann' },
                { unscoped: true }
            );

            await expect(
                scopedOrderRepo.updateById(hidden.id, { owner: 'bob' }, { where: { owner: 'ann' } })
            ).rejects.toThrow(NotFoundError);
        });

        it('refuses to write an optimistically locked property when no condition names it', async () => {
            const created: EvalOrder = await orderRepo.create({ reference: 'C', owner: 'ann' });

            // the declaration is what makes this impossible to forget: last write wins is the default
            // everywhere, and a property that may not be silently overwritten says so once
            await expect(orderRepo.updateById(created.id, { owner: 'bob' })).rejects.toThrow('owner');
        });

        it('writes blindly when the condition is cleared on purpose', async () => {
            const created: EvalOrder = await orderRepo.create({ reference: 'D', owner: 'ann' });

            // naming the property with no condition is how a caller says it means to overwrite - an
            // administrative fix, an import. Told apart from not naming it at all by the key being
            // there, so that building a filter that came out empty is still refused
            await orderRepo.updateById(created.id, { owner: 'bob' }, { where: { owner: undefined } });

            expect((await orderRepo.findById(created.id)).owner).toBe('bob');
        });

        it('applies the same rule to a bulk update', async () => {
            await orderRepo.createAll([
                { reference: 'E', owner: 'ann' },
                { reference: 'F', owner: 'ann' }
            ]);

            await expect(orderRepo.updateAll({ reference: 'E' }, { owner: 'bob' })).rejects.toThrow('owner');
            expect(await orderRepo.updateAll({ owner: 'ann' }, { owner: 'bob' })).toBe(2);
        });
    });

    describe('M2 - declaring database indexes', () => {
        it('supports an index flag on a property', () => {
            const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(EvalOrder);

            expect(props['reference']).toHaveProperty('index');
        });

        it('supports declaring indexes on the entity, so composite and partial indexes are expressible', () => {
            const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(EvalOrder);

            expect(metadata).toHaveProperty('indexes');
        });
    });

    describe('M3 - updateAll / deleteAll must push down to SQL', () => {
        it('updates without loading every matching row into memory', async () => {
            await orderRepo.createAll(
                Array.from({ length: 300 }, (_, i) => ({ reference: `bulk-${i}`, status: 'new' }))
            );

            statementCount = 0;
            await orderRepo.updateAll({ status: 'new' }, { status: 'archived' });
            const statementsForUpdate: number = statementCount;

            // a single `UPDATE ... WHERE status = 'new'` is one statement regardless of how many
            // rows match. Today this is two full SELECTs plus a save per row, so the count scales
            // with the table - which is what makes it OOM on a large tenant rather than merely
            // being slow.
            expect(statementsForUpdate).toBeLessThan(10);
            expect(await orderRepo.findAll({ where: { status: 'new' } })).toHaveLength(0);
        }, 30000);

        it('deletes without one statement per row', async () => {
            await orderRepo.createAll(
                Array.from({ length: 300 }, (_, i) => ({ reference: `bulk-delete-${i}`, status: 'new' }))
            );

            statementCount = 0;
            await orderRepo.deleteAll({ status: 'new' });
            const statementsForDelete: number = statementCount;

            // the rows themselves are read, because the delete hook runs per row and the caller is
            // handed what was deleted. What must not scale with the row count is the writing: one
            // `DELETE ... WHERE id = ANY(...)` takes them all away at once
            expect(statementsForDelete).toBeLessThan(10);
            expect(await orderRepo.findAll({ where: { status: 'new' } })).toHaveLength(0);
        }, 30000);

        it('reports how many rows it changed instead of returning all of them', async () => {
            await orderRepo.createAll(
                Array.from({ length: 10 }, (_, i) => ({ reference: `r-${i}`, status: 'new' }))
            );

            const res: unknown = await orderRepo.updateAll({ status: 'new' }, { status: 'done' });

            // returning the full updated set forces the whole table through the heap for any
            // large update - a count is what a bulk operation should hand back
            expect(typeof res).toBe('number');
        });
    });

    describe('M4 - findAll must be bounded', () => {
        it('reads a table that fits without being asked for a limit', async () => {
            await orderRepo.createAll(
                Array.from({ length: 250 }, (_, i) => ({ reference: `bounded-${i}` }))
            );

            // the ordinary case, and the reason the bound is where it is rather than lower: asking
            // for everything is right whenever everything is small, and that has to keep working
            expect(await orderRepo.findAll()).toHaveLength(250);
        }, 30000);

        it('refuses to stream a whole table into the heap, unless it is asked to', async () => {
            const overTheLimit: number = UNBOUNDED_FIND_ALL_LIMIT + 1;
            await orderRepo.createAll(
                Array.from({ length: overTheLimit }, (_, i) => ({ reference: `unbounded-${i}` }))
            );

            // refused rather than trimmed. Handing back a limit's worth of a larger table would make
            // every caller that loops over the result quietly do part of its work, and nothing would
            // say so - the failure this replaces is loud, and its replacement has to be too
            await expect(orderRepo.findAll()).rejects.toThrow();

            // the bound is on calls that named no limit, not on how much may be read. A caller that
            // says how much it wants has already made the claim the bound exists to check. Asserted
            // here rather than in a test of its own, because seeding this many rows twice costs more
            // than the two assertions are worth apart
            expect(await orderRepo.findAll({ take: overTheLimit })).toHaveLength(overTheLimit);

            // and this is what the bound costs without M14's count: how large a table is stops being
            // answerable through it at exactly the point the answer starts to matter. Asserted on
            // these rows for the same reason as above
            expect(await orderRepo.count()).toBe(overTheLimit);
        }, 60000);
    });

    describe('M5 - a page and its total have to describe one table', () => {
        it('walks the whole table exactly once, on an entity that declares no order', async () => {
            await orderRepo.createAll(
                Array.from({ length: 12 }, (_, i) => ({ reference: `walk-${i}` }))
            );

            const seen: string[] = [];
            for (let page: number = 1; page <= 6; page++) {
                const res: PaginationResult<EvalOrder> = await orderRepo.findAllPaginated(page, 2);
                seen.push(...res.items.map(o => o.id));

                // an ordinary write, in the middle of an ordinary walk. Postgres answers an update
                // by writing a new version of the row and leaving the old one behind, so the row
                // that was just edited is now at the end of the table rather than where it was -
                // and a read that names no order returns rows in whatever order it finds them.
                // Every page after this one is therefore reading a differently ordered table than
                // the page before it did, which is how OFFSET skips rows nobody deleted.
                // guarded rather than indexed, because a walk that has gone wrong runs out of rows
                // early - which is one of the ways it goes wrong, and not the one being asserted
                const edited: EvalOrder | undefined = res.items.at(0);
                if (edited) {
                    await orderRepo.updateById(edited.id, { status: `seen-on-page-${page}` });
                }
            }

            // twelve rows, six pages of two, no row deleted and none added: a walk that does not
            // hand back each of them exactly once has lost some and repeated others. Nothing here
            // asks for an order, which is the point - `defaultOrder` is optional and most entities
            // declare none, so this is what pagination does by default.
            expect(new Set(seen).size).toBe(12);
        }, 30000);

        it('reports a total the page it came with agrees with', async () => {
            await orderRepo.createAll(
                Array.from({ length: 20 }, (_, i) => ({ reference: `snapshot-${i}` }))
            );

            // a second writer, doing the most ordinary thing there is: adding a row and removing it
            // again. The table is 20 rows or 21 depending on the instant it is asked.
            let churning: boolean = true;
            const churn: Promise<void> = (async () => {
                while (churning) {
                    const extra: EvalOrder = await orderRepo.create({ reference: 'churn' });
                    await orderRepo.deleteById(extra.id);
                }
            })();

            try {
                for (let i: number = 0; i < 100; i++) {
                    // a page large enough to hold the whole table, so the two numbers are answers to
                    // the same question. They can only disagree by being asked at two moments -
                    // which is exactly what a page and a count taken as separate statements are.
                    const res: PaginationResult<EvalOrder> = await orderRepo.findAllPaginated(1, 30);
                    expect(res.items).toHaveLength(res.totalAmount);
                }
            }
            finally {
                churning = false;
                await churn;
            }
        }, 60000);
    });

    describe('M6 - transactions', () => {
        // The helper this finding asked for is deliberately not here. Threading `{ transaction }`
        // through every call is what lets a method take one optionally and start its own when it is
        // given none - a caller that already holds a transaction passes it down, and the method
        // joins it. A `runInTransaction(cb)` cannot see that, so it would start a second
        // transaction inside the first, which is savepoints or a silent nesting bug rather than a
        // convenience. Ambient propagation would answer it and is worse: a stray read in a callback
        // joins a transaction nobody meant it to join.
        //
        // What the finding was right about is the other half, and neither part of it was the
        // threading. See ../../data-source/transaction/abandoned-transaction.test.ts and its valkey
        // counterpart for a transaction that reaches neither a commit nor a rollback, and
        // ../../data-source/transaction/transaction.test.ts for a commit that throws.

        it('commits and rolls back through a transaction the data source handed out', async () => {
            const dataSource: PostgresDataSource = inject(dataSourceClass);
            const transaction: Transaction = await dataSource.startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });

            await orderRepo.create({ reference: 'tx' }, { transaction });
            await transaction.commit();

            // a guard rather than a finding: it establishes that the happy path works, so a failure
            // in the leak tests elsewhere cannot be mistaken for this
            expect(await orderRepo.findAll({ where: { reference: 'tx' } })).toHaveLength(1);
        });
    });

    describe('M7 - connection pool default', () => {
        it('defaults to a pool size a cluster of replicas can actually afford', () => {
            const dataSource: PostgresDataSource = inject(dataSourceClass);

            // the effective value the data source will hand to the driver, defaults merged in -
            // this test data source never sets poolSize, so this is the framework default
            const poolSize: number | undefined = dataSource['fullOptions'].poolSize;

            // 100 per process x 20 pods is 2000 connections against a stock max_connections of 100,
            // so the first scale-out event takes the database down
            expect(poolSize).toBeLessThanOrEqual(20);
        });
    });

    describe('M9 - column defaults must reach the database', () => {
        // read off the live schema rather than off the metadata: the finding is about what a write
        // the application never saw gets, and the declaration being present says nothing about
        // whether the column carries it. Read rather than written, because what is being checked is
        // the schema the framework built, not a way around the repository.
        it('declares a constant default on the column, for the writes the application never runs', async () => {
            const dataSource: PostgresDataSource = inject(dataSourceClass);
            const transaction: Transaction = await dataSource.startTransaction();
            try {
                const runner: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner;
                const table: Table | undefined = await runner.getTable('eval_order');
                const status: TableColumn | undefined = table?.columns.find(c => c.name === 'status');

                // a data migration, a dba, another service against the same database - none of them
                // run the entity's default, and the column is what answers for all of them
                expect(status?.default).toContain('NEW');
            }
            finally {
                await transaction.rollback();
            }
        });

        it('leaves a default the column cannot hold to the application', async () => {
            // `queuedAt` defaults to a function of when the row is written, which a column cannot
            // run. Declaring nothing is the right answer there - the alternative is a column whose
            // default is the moment the class was evaluated, which is a wrong answer that looks
            // like a right one.
            const dataSource: PostgresDataSource = inject(dataSourceClass);
            const transaction: Transaction = await dataSource.startTransaction();
            try {
                const runner: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner;
                const table: Table | undefined = await runner.getTable('eval_order');
                const queuedAt: TableColumn | undefined = table?.columns.find(c => c.name === 'queuedAt');

                expect(queuedAt?.default).toBeUndefined();
            }
            finally {
                await transaction.rollback();
            }
        });
    });

    describe('M13 - soft delete and unique constraints', () => {
        it('lets an address be reused after the row holding it was soft deleted', async () => {
            const accountRepo: SoftDeleteRepository<EvalAccount> = inject(repositoryTokenFor(EvalAccount));
            await accountRepo.deleteAll({}, { hardDelete: true });

            const created: EvalAccount = await accountRepo.create({ email: 'reuse@example.com' });
            await accountRepo.deleteById(created.id);

            // a plain UNIQUE constraint keeps the soft deleted row occupying the value forever, so
            // a user can never re-register with an address they previously deleted
            await expect(accountRepo.create({ email: 'reuse@example.com' })).resolves.toBeDefined();
        });

        it('still refuses two live rows holding the same address', async () => {
            const accountRepo: SoftDeleteRepository<EvalAccount> = inject(repositoryTokenFor(EvalAccount));
            await accountRepo.deleteAll({}, { hardDelete: true });
            await accountRepo.create({ email: 'taken@example.com' });

            // the half that has to keep working: narrowing which rows a constraint covers is not the
            // same as dropping it, and a fix that only made the first test pass would do that
            await expect(accountRepo.create({ email: 'taken@example.com' })).rejects.toThrow(UniqueConstraintViolationError);
        });

        it('applies the same to a group declared on the entity', async () => {
            const repo: SoftDeleteRepository<EvalTenantAccount> = inject(repositoryTokenFor(EvalTenantAccount));
            await repo.deleteAll({}, { hardDelete: true });

            const created: EvalTenantAccount = await repo.create({ tenantId: 'a', email: 'shared@example.com' });
            // another tenant is a different row of the group either way, deleted or not
            await expect(repo.create({ tenantId: 'b', email: 'shared@example.com' })).resolves.toBeDefined();
            await expect(repo.create({ tenantId: 'a', email: 'shared@example.com' }))
                .rejects.toThrow(UniqueConstraintViolationError);

            await repo.deleteById(created.id);
            await expect(repo.create({ tenantId: 'a', email: 'shared@example.com' })).resolves.toBeDefined();
        });
    });

    describe('M12 - write amplification on change set and soft delete entities', () => {
        it('reads the row once for a soft delete rather than once per layer', async () => {
            const accountRepo: SoftDeleteRepository<EvalAccount> = inject(repositoryTokenFor(EvalAccount));
            await accountRepo.deleteAll({}, { hardDelete: true });

            // measured against the operation a soft delete *is* rather than against a number, so
            // that what this asserts is the one read the fix removed. An absolute count would also
            // be counting the transaction, typeorm's own read to decide insert from update, and the
            // change set's relation - none of which this finding is about, and any of which moving
            // would break the test without anything having regressed
            const toUpdate: EvalAccount = await accountRepo.create({ email: 'baseline@example.com' });
            readCount = 0;
            await accountRepo.updateById(toUpdate.id, { email: 'baseline-changed@example.com' });
            const readsForUpdate: number = readCount;

            const toDelete: EvalAccount = await accountRepo.create({ email: 'amplified@example.com' });
            readCount = 0;
            await accountRepo.deleteById(toDelete.id);
            const readsForSoftDelete: number = readCount;

            // a soft delete is an update that writes one change set, which is exactly what the
            // update above is - so the two read the row the same number of times. They did not: the
            // soft delete guard read it, and the update underneath read it a second time for a
            // change set that excludes `deleted` and was therefore never written.
            //
            // Reads rather than statements, because the writes differ on purpose: an update lists
            // the property it changed, and the one property a soft delete changes is the one its
            // change set leaves out - so the update has a change to write and the delete has none
            expect(readsForSoftDelete).toBe(readsForUpdate);
            expect(await accountRepo.findById(toDelete.id, { withDeleted: true })).toHaveProperty('deleted', true);
        }, 30000);

        it('records the delete once, under the type it is', async () => {
            const accountRepo: SoftDeleteRepository<EvalAccount> = inject(repositoryTokenFor(EvalAccount));
            await accountRepo.deleteAll({}, { hardDelete: true });
            const created: EvalAccount = await accountRepo.create({ email: 'recorded@example.com' });

            await accountRepo.deleteById(created.id);

            // the read that went away was there for a change set, so the thing to prove is that the
            // trail did not go with it: one DELETE change set, and no UPDATE beside it saying the
            // same row was edited
            const changeSets: ChangeSet[] = await inject(repositoryTokenFor(ChangeSet))
                .findAll({ where: { changeSetEntityId: created.id } });
            expect(changeSets.map(c => c.type)).toEqual([ChangeSetType.CREATE, ChangeSetType.DELETE]);
        }, 30000);

        it('hands the updated row back instead of reading it again', async () => {
            const created: EvalOrder = await orderRepo.create({ reference: 'read-back', status: 'new' });

            // measured against the read the same row costs on its own, for the reason the soft
            // delete above is measured against an ordinary update: what this asserts is that an
            // update reads the row the once it has to - the guard telling a missing row from a
            // write that changed nothing - and not a second time to find out what it just wrote
            readCount = 0;
            await orderRepo.findById(created.id);
            const readsForRead: number = readCount;

            readCount = 0;
            const updated: EvalOrder = await orderRepo.updateById(created.id, { status: 'done' });
            const readsForUpdate: number = readCount;

            expect(readsForUpdate).toBe(readsForRead);
            // the whole row rather than the change: a caller gets what is stored, so a column they
            // did not write has to be on it
            expect(updated.status).toBe('done');
            expect(updated.reference).toBe('read-back');
        }, 30000);

        it('reads the row once for a conditional update too', async () => {
            const created: EvalOrder = await orderRepo.create({ reference: 'conditional', status: 'new', owner: 'a' });

            readCount = 0;
            const updated: EvalOrder = await orderRepo.updateById(
                created.id,
                { owner: 'b' },
                { where: { owner: 'a' } }
            );
            const readsForUpdate: number = readCount;

            // the condition travels into the write, so it costs no read of its own. The one read
            // left is the guard, which runs before the write and without the condition
            expect(readsForUpdate).toBe(1);
            expect(updated.owner).toBe('b');
            expect(updated.reference).toBe('conditional');
        }, 30000);

        it('resolves who is acting once per request rather than once per write', async () => {
            const accountRepo: SoftDeleteRepository<EvalAccount> = inject(repositoryTokenFor(EvalAccount));
            await accountRepo.deleteAll({}, { hardDelete: true });

            statementCount = 0;
            await accountRepo.createAll(
                Array.from({ length: 20 }, (_, i) => ({ email: `actor-${i}@example.com` }))
            );

            // `getCreatedBy` asks the auth service for the current user on every change set it
            // writes. Memoized per request context, so twenty writes ask once - and outside a
            // request there is no context to ask about at all
            expect(statementCount).toBeLessThan(10);
        }, 30000);
    });

    describe('M14 - operations a production repository needs', () => {
        it('counts what a filter matches without reading any of it', async () => {
            await orderRepo.createAll(
                Array.from({ length: 300 }, (_, i) => ({ reference: `counted-${i}`, status: i < 40 ? 'new' : 'done' }))
            );

            statementCount = 0;
            const open: number = await orderRepo.count({ where: { status: 'new' } });
            const statementsForCount: number = statementCount;

            expect(open).toBe(40);
            expect(await orderRepo.count()).toBe(300);
            // the point of having this at all. `findAll(...).length` answers the same question by
            // pulling every matching row through the heap, and above M4's bound it cannot answer it
            // at all - so a count that is one statement no matter how many rows match is the
            // difference between "how many" being cheap and being impossible
            expect(statementsForCount).toBeLessThan(5);
        }, 30000);

        it('answers whether anything matches without reading the row', async () => {
            await orderRepo.create({ reference: 'here', status: 'new' });

            expect(await orderRepo.exists({ where: { reference: 'here' } })).toBe(true);
            expect(await orderRepo.exists({ where: { reference: 'not-here' } })).toBe(false);
            // an empty table is the case a caller uses this for - seeding a database on first boot,
            // refusing a migration that has already run
            await orderRepo.deleteAll({});
            expect(await orderRepo.exists()).toBe(false);
        });

        it('counts through the entity scope rather than around it', async () => {
            await scopedOrderRepo.createAll([{ archived: false }, { archived: false }]);
            await scopedOrderRepo.createAll([{ archived: true }], { unscoped: true });

            // the same leak `findAllPaginated`'s total once had: a count taken from the caller's
            // filter alone reports how many rows exist rather than how many they may see, and on a
            // per-tenant scope that is a row count of somebody else's data
            expect(await scopedOrderRepo.count()).toBe(2);
            expect(await scopedOrderRepo.count({ unscoped: true })).toBe(3);
            expect(await scopedOrderRepo.exists({ where: { archived: true } })).toBe(false);
            expect(await scopedOrderRepo.exists({ where: { archived: true }, unscoped: true })).toBe(true);
        });

        it('reads past the bound findAll refuses at, without holding the result', async () => {
            // one row more than an unbounded findAll will hand back, so the table is genuinely on
            // the far side of the bound this exists to get past
            const references: string[] = Array.from(
                { length: UNBOUNDED_FIND_ALL_LIMIT + 1 },
                (_, i) => `streamed-${i}`
            );
            await orderRepo.deleteAll({});
            await orderRepo.createAll(references.map(reference => ({ reference })));

            // the control: this is what a caller hits today, and what the stream is the way past
            await expect(orderRepo.findAll()).rejects.toThrow(InternalError);

            const seen: Set<string> = new Set();
            for await (const order of orderRepo.stream()) {
                seen.add(order.reference);
            }
            expect(seen.size).toBe(references.length);
        }, 60000);

        it('stops reading when the caller stops', async () => {
            await orderRepo.deleteAll({});
            await orderRepo.createAll(Array.from({ length: 50 }, (_, i) => ({ reference: `early-${i}` })));

            let read: number = 0;
            for await (const order of orderRepo.stream()) {
                expect(order.reference).toContain('early-');
                read++;
                break;
            }

            // `break` has to end the read rather than leave a cursor and its connection open behind
            // it. What is observable from here is that the loop stopped; what it protects is the
            // pool, which a stream nobody finished would hold one of forever
            expect(read).toBe(1);
        });

        it('narrows a stream by the entity scope, like every other read', async () => {
            await scopedOrderRepo.deleteAll({}, { unscoped: true });
            await scopedOrderRepo.createAll([{ archived: false }, { archived: false }]);
            await scopedOrderRepo.createAll([{ archived: true }], { unscoped: true });

            const streamed: EvalScopedOrder[] = [];
            for await (const order of scopedOrderRepo.stream()) {
                streamed.push(order);
            }

            // a read that walks the whole table is exactly the one a scope must not be missing from
            expect(streamed).toHaveLength(2);
            expect(streamed.every(o => !o.archived)).toBe(true);
        });
    });

    describe('M21 - an id the entity cannot hold is a missing row, not a failed query', () => {
        it('reports a malformed id as missing rather than letting the store refuse it', async () => {
            // `GET /orders/not-a-uuid` is the reachable form of this. The id property declares
            // format uuid, so no row can carry this value and the answer is the same one an unknown
            // id gets - reaching the store instead means a client typo comes back as a server fault
            await expect(orderRepo.findById('not-a-uuid')).rejects.toThrow(NotFoundError);
        });

        it('returns undefined for a malformed id when a result is not required', async () => {
            await expect(orderRepo.findById('not-a-uuid', { required: false })).resolves.toBeUndefined();
        });

        it('answers a malformed id without asking the store at all', async () => {
            statementCount = 0;
            await orderRepo.findById('not-a-uuid', { required: false });

            expect(statementCount).toBe(0);
        });

        it('carries through to updateById and deleteById', async () => {
            await expect(orderRepo.updateById('not-a-uuid', { status: 'shipped' })).rejects.toThrow(NotFoundError);
            await expect(orderRepo.deleteById('not-a-uuid')).rejects.toThrow(NotFoundError);
        });

        it('answers a filter naming an impossible value with no rows rather than failing', async () => {
            // the same defect one method over, and the reachable form is a query parameter that
            // filters by an id. A store that filters in process already answers this with none of
            // them, so this is the two data sources agreeing rather than a new rule
            await expect(orderRepo.findAll({ where: { id: 'not-a-uuid' } })).resolves.toEqual([]);
        });

        it('keeps the possible half of a filter that lists several ids', async () => {
            const created: EvalOrder = await orderRepo.create({ reference: 'one-of-two' });

            const found: EvalOrder[] = await orderRepo.findAll({ where: { id: { oneOf: ['not-a-uuid', created.id] } } });

            // dropping the whole condition would hide a row the caller legitimately asked for
            expect(found.map(o => o.id)).toEqual([created.id]);
        });

        it('still finds a row whose id is a uuid version this framework does not generate', async () => {
            // the reason the check is looser than the validation applied to incoming values: this id
            // is in the table, so recognizing only the versions `generate` produces would answer that
            // an existing row does not exist
            const id: string = '01912d68-783e-7000-8000-1f9b0a2c4d5e';
            await orderRepo.create({ id, reference: 'externally-generated' }, { allowId: true });

            expect(await orderRepo.findById(id)).toHaveProperty('id', id);
        });
    });

    describe('updateById on a row that is gone', () => {
        it('reports that the row is missing rather than failing on a column constraint', async () => {
            const created: EvalOrder = await orderRepo.create({ reference: 'deleted-under-us' });
            await orderRepo.deleteById(created.id);

            // updateById sets data.id and hands it to the driver's save, which is an upsert - so a
            // missing id is not an error, it is an INSERT with every column the caller did not name
            // left at DEFAULT. What surfaces is whichever constraint that insert happens to break,
            // attributed to an update. findById already throws NotFoundError for exactly this
            // situation, so there is a right answer and this is not it.
            await expect(orderRepo.updateById(created.id, { status: 'shipped' }))
                .rejects.toThrow(NotFoundError);
        });

        it('does not bring a deleted row back when nothing constrains the insert', async () => {
            const created: EvalNote = await noteRepo.create({ body: 'deleted-under-us' });
            await noteRepo.deleteById(created.id);

            // whether it throws is the test above. What matters here is what it leaves behind, so
            // the outcome is swallowed rather than asserted - otherwise a failure there would abort
            // this one before it ever looks at the table.
            await noteRepo.updateById(created.id, { body: 'edited' }).catch(() => undefined);

            // the quiet half, and the reason this entity has no required columns: with nothing to
            // break, the insert succeeds and the row returns from the dead carrying only what this
            // call happened to set. Nothing is raised anywhere.
            expect(await noteRepo.findAll({ where: { id: created.id } })).toEqual([]);
        });
    });

    describe('repository must not mutate caller input', () => {
        it('leaves the create payload untouched', async () => {
            const payload: { reference: string, id: string } = { reference: 'immutable', id: 'caller-supplied' };

            await orderRepo.create(payload);

            // `delete data.id` on the caller's object is a side effect on data they still hold
            expect(payload.id).toBe('caller-supplied');
        });

        it('leaves the update payload untouched', async () => {
            const created: EvalOrder = await orderRepo.create({ reference: 'immutable-update' });
            const payload: { status: string } = { status: 'changed' };

            await orderRepo.updateById(created.id, payload);

            expect(Object.keys(payload)).toEqual(['status']);
        });
    });
});