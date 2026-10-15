import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';

/**
 * The cases every data source answers the same way about how a uuid is stored and found, whichever
 * case it was written in. A file per data source runs them against repositories of its own.
 */

/**
 * What items belong to.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class UuidOwner extends BaseEntity {
    /**
     * Anything, so the row has a column of its own.
     */
    @Property.string()
    name!: string;

    /**
     * The items pointing at this owner.
     */
    @Property.oneToMany({ target: () => UuidItem, inverseSide: 'owner' })
    items!: UuidItem[];
}

/**
 * A row holding a uuid of its own and one pointing at another row.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class UuidItem extends BaseEntity {
    /**
     * Changed by the conflict path of an upsert.
     */
    @Property.string()
    label!: string;

    /**
     * A uuid that is not a key, unique so it can identify an upsert.
     */
    @Property.string({ format: 'uuid', unique: true, required: false })
    reference?: string;

    /**
     * The owner, when there is one.
     */
    @Property.manyToOne({ target: () => UuidOwner, joinColumn: 'ownerId', inverseSide: 'items', required: false })
    owner?: UuidOwner;

    /**
     * The foreign key of the owner.
     */
    @Property.string({ format: 'uuid', required: false })
    ownerId?: string;
}

/**
 * The repositories the cases run against.
 */
export type UuidValueRepositories = {
    /**
     * The owners.
     */
    owners: Repository<UuidOwner>,
    /**
     * The items.
     */
    items: Repository<UuidItem>
};

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoriesOf - Reads the repositories, once the data source is started.
 */
export function describeUuidValues(dataSourceName: string, repositoriesOf: () => UuidValueRepositories): void {
    describe(`how a uuid is stored and found, on ${dataSourceName}`, () => {
        it('stores a uuid written in upper case in lower case', async () => {
            const reference: string = UUIDUtilities.generate();

            const created: UuidItem = await repositoriesOf().items.create({ label: 'upper', reference: reference.toUpperCase() });

            expect(created.reference).toBe(reference);
            expect((await repositoriesOf().items.findById(created.id)).reference).toBe(reference);
        });

        it('stores a chosen id written in upper case in lower case', async () => {
            const id: string = UUIDUtilities.generate();

            const created: UuidItem = await repositoriesOf().items.create(
                { id: id.toUpperCase(), label: 'chosen' },
                { allowId: true }
            );

            expect(created.id).toBe(id);
            expect((await repositoriesOf().items.findById(id)).label).toBe('chosen');
        });

        it('stores the foreign key of a related row named in upper case in lower case', async () => {
            const owner: UuidOwner = await repositoriesOf().owners.create({ name: 'owner' });

            const upper: string = owner.id.toUpperCase();
            const byRelation: UuidItem = await repositoriesOf().items.create({ label: 'by relation', owner: { id: upper } });
            const byKey: UuidItem = await repositoriesOf().items.create({ label: 'by key', ownerId: upper });

            expect(byRelation.ownerId).toBe(owner.id);
            expect(byKey.ownerId).toBe(owner.id);
            const found: UuidItem[] = await repositoriesOf().items.findAll({ where: { ownerId: owner.id }, order: { label: 'ASC' } });
            expect(found.map(i => i.label)).toEqual(['by key', 'by relation']);
        });

        it('stores a uuid an update writes in upper case in lower case', async () => {
            const created: UuidItem = await repositoriesOf().items.create({ label: 'to update' });
            const reference: string = UUIDUtilities.generate();

            const updated: UuidItem = await repositoriesOf().items.updateById(created.id, { reference: reference.toUpperCase() });

            expect(updated.reference).toBe(reference);
            expect(await repositoriesOf().items.count({ where: { reference } })).toBe(1);
        });

        it('finds a row by a uuid written in upper case', async () => {
            const reference: string = UUIDUtilities.generate();
            const created: UuidItem = await repositoriesOf().items.create({ label: 'findable', reference });
            const upper: string = reference.toUpperCase();

            expect((await repositoriesOf().items.findById(created.id.toUpperCase())).id).toBe(created.id);
            expect(await repositoriesOf().items.count({ where: { reference: upper } })).toBe(1);
            expect(await repositoriesOf().items.count({ where: { reference: { oneOf: [upper] } } })).toBe(1);
            expect(await repositoriesOf().items.count({ where: { id: created.id, reference: { not: upper } } })).toBe(0);
            expect(await repositoriesOf().items.count({ where: { id: created.id, reference: { notOneOf: [upper] } } })).toBe(0);
        });

        it('refuses a negation of a value no uuid can be', async () => {
            // every row differs from it: matching all of them would be a filter wider than it reads,
            // and a store typing its columns refused the value as a failed query
            await expect(repositoriesOf().items.findAll({ where: { reference: { not: 'garbage' } } }))
                .rejects.toThrow(BadRequestError);
            await expect(repositoriesOf().items.count({ where: { ownerId: { notOneOf: [UUIDUtilities.generate(), 'garbage'] } } }))
                .rejects.toThrow(BadRequestError);
        });

        it('finds nothing through a relation filter naming an id no row can have', async () => {
            const owner: UuidOwner = await repositoriesOf().owners.create({ name: 'joined' });
            await repositoriesOf().items.create({ label: 'joined', owner: { id: owner.id } });

            // reached through a join, where the target's uuid column is what compares
            expect(await repositoriesOf().items.findAll({ where: { owner: { where: { id: 'garbage' } } } })).toEqual([]);
            expect(await repositoriesOf().items.count({ where: { owner: { where: [{ id: 'garbage' }, { id: owner.id }] } } }))
                .toBe(1);
            await expect(repositoriesOf().items.findAll({ where: { owner: { where: { id: { not: 'garbage' } } } } }))
                .rejects.toThrow(BadRequestError);
        });

        it('refuses a uuid that differs from a unique one only in case', async () => {
            const reference: string = UUIDUtilities.generate();
            await repositoriesOf().items.create({ label: 'first', reference: reference.toUpperCase() });

            await expect(repositoriesOf().items.create({ label: 'second', reference }))
                .rejects.toThrow(UniqueConstraintViolationError);
        });

        it('upserts onto the row holding a uuid identity written in another case', async () => {
            const reference: string = UUIDUtilities.generate();
            const created: UuidItem = await repositoriesOf().items.upsert(
                { reference: reference.toUpperCase() },
                { label: 'inserted', reference: reference.toUpperCase() },
                { label: { set: 'changed' } }
            );

            const changed: UuidItem = await repositoriesOf().items.upsert(
                { reference },
                { label: 'inserted', reference },
                { label: { set: 'changed' } }
            );

            expect(created.reference).toBe(reference);
            expect(changed.id).toBe(created.id);
            expect(changed.label).toBe('changed');
        });

        it('pairs each row of a batch upsert with the row holding its identity in another case', async () => {
            const held: UuidItem = await repositoriesOf().items.create({ label: 'held', reference: UUIDUtilities.generate() });
            const free: string = UUIDUtilities.generate();

            const [changed, inserted] = await repositoriesOf().items.upsertAll(['reference'], [
                { create: { label: 'inserted', reference: held.reference?.toUpperCase() }, onConflict: { label: { set: 'changed' } } },
                { create: { label: 'inserted', reference: free.toUpperCase() }, onConflict: { label: { set: 'changed' } } }
            ]);

            expect(changed?.id).toBe(held.id);
            expect(changed?.label).toBe('changed');
            expect(inserted?.reference).toBe(free);
            expect(inserted?.label).toBe('inserted');
        });
    });
}