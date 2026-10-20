import { afterEach, describe, expect, it } from 'vitest';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../entity/models/relation.type.ts';
import { scopeFor } from '../../entity/models/entity-scope.model.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { Repository } from '../repository/repository.ts';

/**
 * The cases every data source answers the same way about a call reaching more rows than one statement
 * can bind a value for. A file per data source runs them against repositories of its own.
 *
 * Not run against the in-memory data source, which checks a unique declaration and finds an upsert's
 * row by reading the whole table and is built for the few rows a test writes. At this size that is
 * the square of the batch, where what is under test is how a store that binds values splits it.
 */

/**
 * More rows than a statement of any data source here binds values, so that even a statement binding
 * one value per row has to be split or bound differently.
 */
const ROWS: number = 70000;

/**
 * How long one case may take. Writing this many rows one statement after another is slow on purpose,
 * and a store answering per row is slower still.
 */
const TIMEOUT_IN_MS: number = 50000;

/**
 * The owner the scope restricts to, set by the case about it. Undefined otherwise, which the scope
 * then does not restrict.
 */
let actingAs: string | undefined;

/**
 * What the rows of one run belong to.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class BulkOwner extends BaseEntity {
    /**
     * Unique per run, so a filter reaching through the relation finds this run's rows alone.
     */
    @Property.string()
    name!: string;

    /**
     * The rows pointing at this owner.
     */
    @Property.oneToMany({ target: () => BulkRow, inverseSide: 'owner' })
    rows!: BulkRow[];
}

/**
 * One row of a large batch.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: { restrictedTo: scopeFor<BulkRow>(() => actingAs == undefined ? undefined : { ownerId: actingAs }) }
})
export class BulkRow extends BaseEntity {
    /**
     * What an upsert identifies the row by.
     */
    @Property.string({ unique: true })
    key!: string;

    /**
     * Changed by every case that writes.
     */
    @Property.string()
    label!: string;

    /**
     * The owner.
     */
    @Property.manyToOne({ target: () => BulkOwner, joinColumn: 'ownerId', inverseSide: 'rows', required: false })
    owner?: Relation<BulkOwner>;

    /**
     * The foreign key of the owner.
     */
    @Property.string({ format: 'uuid' })
    ownerId!: string;
}

/**
 * The repositories the cases run against.
 */
export type LargeBatchRepositories = {
    /**
     * The owners.
     */
    owners: Repository<BulkOwner>,
    /**
     * The rows.
     */
    rows: Repository<BulkRow>
};

/**
 * Runs every case against the repositories of one data source.
 *
 * The cases build on each other, in the order they are declared: writing this many rows is what each
 * of them is about, and writing them once per case would multiply the slowest part of the suite.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoriesOf - Reads the repositories, once the data source is started.
 */
export function describeLargeBatches(dataSourceName: string, repositoriesOf: () => LargeBatchRepositories): void {
    describe(`calls reaching more rows than one statement binds values for, on ${dataSourceName}`, () => {
        const ownerName: string = `owner-${UUIDUtilities.generate()}`;
        let owner: BulkOwner;
        let created: BulkRow[] = [];
        // what writing the rows on their own took, which the nested save of as many is measured against
        let createAllInMs: number = 0;

        afterEach(() => {
            actingAs = undefined;
        });

        it('finds rows by a list longer than a statement binds values', async () => {
            const few: BulkOwner = await repositoriesOf().owners.create({ name: `few-${UUIDUtilities.generate()}` });
            const rows: BulkRow[] = await repositoriesOf().rows.createAll([
                { key: UUIDUtilities.generate(), label: 'one', ownerId: few.id },
                { key: UUIDUtilities.generate(), label: 'two', ownerId: few.id }
            ]);
            const unknown: string[] = Array.from({ length: ROWS }, () => UUIDUtilities.generate());
            const [first, second] = rows.map(r => r.id);

            expect(await repositoriesOf().rows.count({ where: { id: { oneOf: [...unknown, ...rows.map(r => r.id)] } } })).toBe(2);
            expect(await repositoriesOf().rows.count({ where: { ownerId: few.id, id: { notOneOf: [...unknown, first ?? ''] } } }))
                .toBe(1);
            expect(await repositoriesOf().rows.count({ where: { ownerId: few.id, id: { notOneOf: [...unknown, second ?? ''] } } }))
                .toBe(1);
        }, TIMEOUT_IN_MS);

        it('creates more rows at once than one statement binds values for, and hands them back with their relations', async () => {
            owner = await repositoriesOf().owners.create({ name: ownerName });

            const startedAt: number = Date.now();
            created = await repositoriesOf().rows.createAll(
                Array.from({ length: ROWS }, (_, i) => ({ key: `${ownerName}-${i}`, label: 'created', ownerId: owner.id })),
                { relations: { owner: true } }
            );
            createAllInMs = Date.now() - startedAt;

            expect(created).toHaveLength(ROWS);
            expect(created.every(r => r.owner?.id === owner.id)).toBe(true);
            expect(await repositoriesOf().rows.count({ where: { ownerId: owner.id } })).toBe(ROWS);
        }, TIMEOUT_IN_MS);

        // evaluation/01-data-layer M43: the valkey driver hands the saved children back to their owner
        // by copying the owner's list with each child added, which is the square of the children of one
        // owner. The same writes as the case above, so a save that is linear takes about as long
        it('creates an owner together with more rows than one statement binds values for, about as fast as the rows alone', async () => {
            const nestedName: string = `nested-${UUIDUtilities.generate()}`;
            const startedAt: number = Date.now();

            const nested: BulkOwner = await repositoriesOf().owners.create({
                name: nestedName,
                rows: Array.from({ length: ROWS }, (_, i) => ({ key: `${nestedName}-${i}`, label: 'nested' }))
            });
            const nestedInMs: number = Date.now() - startedAt;

            expect(await repositoriesOf().rows.count({ where: { ownerId: nested.id } })).toBe(ROWS);
            expect(nestedInMs).toBeLessThan((createAllInMs * 3) + 1000);
        }, TIMEOUT_IN_MS);

        it('upserts more rows at once than one statement binds values for', async () => {
            const upserted: BulkRow[] = await repositoriesOf().rows.upsertAll(['key'], created.map(r => ({
                create: { key: r.key, label: 'inserted', ownerId: owner.id },
                onConflict: { label: { set: 'upserted' } }
            })));

            expect(upserted).toHaveLength(ROWS);
            expect(upserted.map(r => r.id)).toEqual(created.map(r => r.id));
            expect(upserted.every(r => r.label === 'upserted')).toBe(true);
        }, TIMEOUT_IN_MS);

        it('upserts more rows at once than one statement binds values for, on an entity with a scope', async () => {
            actingAs = owner.id;

            const upserted: BulkRow[] = await repositoriesOf().rows.upsertAll(['key'], created.map(r => ({
                create: { key: r.key, label: 'inserted', ownerId: owner.id },
                onConflict: { label: { set: 'scoped' } }
            })));

            expect(upserted).toHaveLength(ROWS);
            expect(upserted.map(r => r.id)).toEqual(created.map(r => r.id));
            expect(upserted.every(r => r.label === 'scoped')).toBe(true);
        }, TIMEOUT_IN_MS);

        it('updates more rows than one statement binds values for, through a filter on a relation', async () => {
            const count: number = await repositoriesOf().rows.updateAll({ owner: { where: { name: ownerName } } }, { label: 'moved' });

            expect(count).toBe(ROWS);
            expect(await repositoriesOf().rows.count({ where: { ownerId: owner.id, label: 'moved' } })).toBe(ROWS);
        }, TIMEOUT_IN_MS);

        it('deletes more rows than one statement binds values for', async () => {
            const count: number = await repositoriesOf().rows.deleteAll({ ownerId: owner.id });

            expect(count).toBe(ROWS);
            expect(await repositoriesOf().rows.count({ where: { ownerId: owner.id } })).toBe(0);
        }, TIMEOUT_IN_MS);
    });
}