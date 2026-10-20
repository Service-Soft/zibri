import { describe, expect, it } from 'vitest';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { ConflictError } from '../../error-handling/errors/conflict.error.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { Repository } from '../repository/repository.ts';

/**
 * The cases every data source answers the same way about an upsert whose conflict path changes a
 * property declaring `optimisticLocking`. A file per data source runs them against a repository of
 * its own.
 */

/**
 * A ledger with an owner two people may reassign at once, and a counter both may add to.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Ledger extends BaseEntity {
    /**
     * What identifies a ledger. Generated per test, which is what keeps one test's rows apart from
     * the next.
     */
    @Property.string({ unique: true })
    key!: string;

    /**
     * Who the ledger belongs to, which a write has to say it read before replacing it.
     */
    @Property.string({ format: 'uuid', optimisticLocking: true })
    ownerId!: string;

    /**
     * Locked as well, so that adding to it shows what an increment is asked for.
     */
    @Property.number({ format: 'integer', optimisticLocking: true })
    entries!: number;
}

/**
 * Runs every case against the ledgers of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param ledgersOf - Reads the repository, once the data source is started.
 */
export function describeLockedUpsert(dataSourceName: string, ledgersOf: () => Repository<Ledger>): void {
    /**
     * Creates a ledger no other test uses.
     * @returns The ledger as it was stored.
     */
    async function createLedger(): Promise<Ledger> {
        return await ledgersOf().create({ key: `ledger-${UUIDUtilities.generate()}`, ownerId: UUIDUtilities.generate(), entries: 1 });
    }

    describe(`an upsert changing a property that declares optimistic locking, on ${dataSourceName}`, () => {
        it('refuses to set the property without saying what it was', async () => {
            const ledger: Ledger = await createLedger();
            const ownerId: string = UUIDUtilities.generate();

            await expect(ledgersOf().upsert(
                { key: ledger.key },
                { key: ledger.key, ownerId, entries: 1 },
                { ownerId: { set: ownerId } }
            )).rejects.toThrow(InternalError);
            await expect(ledgersOf().upsertAll(
                ['key'],
                [{ create: { key: ledger.key, ownerId, entries: 1 }, onConflict: { ownerId: { set: ownerId } } }]
            )).rejects.toThrow(/optimistic locking/);
            expect((await ledgersOf().findById(ledger.id)).ownerId).toBe(ledger.ownerId);
        });

        it('sets the property when it still holds the value the call names', async () => {
            const ledger: Ledger = await createLedger();
            const ownerId: string = UUIDUtilities.generate();

            const res: Ledger = await ledgersOf().upsert(
                { key: ledger.key },
                { key: ledger.key, ownerId, entries: 1 },
                { ownerId: { set: ownerId } },
                { where: { ownerId: ledger.ownerId } }
            );

            expect(res.id).toBe(ledger.id);
            expect(res.ownerId).toBe(ownerId);
        });

        it('refuses with a conflict when the property changed since it was read', async () => {
            const ledger: Ledger = await createLedger();
            const ownerId: string = UUIDUtilities.generate();

            await expect(ledgersOf().upsert(
                { key: ledger.key },
                { key: ledger.key, ownerId, entries: 1 },
                { ownerId: { set: ownerId }, entries: { increment: 1 } },
                { where: { ownerId: UUIDUtilities.generate() } }
            )).rejects.toThrow(ConflictError);
            const stored: Ledger = await ledgersOf().findById(ledger.id);
            expect(stored.ownerId).toBe(ledger.ownerId);
            expect(stored.entries).toBe(1);
        });

        it('refuses with a conflict when the value named is one the property cannot hold', async () => {
            const ledger: Ledger = await createLedger();
            const ownerId: string = UUIDUtilities.generate();

            await expect(ledgersOf().upsert(
                { key: ledger.key },
                { key: ledger.key, ownerId, entries: 1 },
                { ownerId: { set: ownerId } },
                { where: { ownerId: 'not-a-uuid' } }
            )).rejects.toThrow(ConflictError);
        });

        it('overwrites the property regardless when the call names it with no value', async () => {
            const ledger: Ledger = await createLedger();
            const ownerId: string = UUIDUtilities.generate();

            const res: Ledger = await ledgersOf().upsert(
                { key: ledger.key },
                { key: ledger.key, ownerId, entries: 1 },
                { ownerId: { set: ownerId } },
                { where: { ownerId: undefined } }
            );

            expect(res.ownerId).toBe(ownerId);
        });

        it('inserts a row whose identity is free, whatever the condition names', async () => {
            const key: string = `ledger-${UUIDUtilities.generate()}`;
            const ownerId: string = UUIDUtilities.generate();

            const res: Ledger = await ledgersOf().upsert(
                { key },
                { key, ownerId, entries: 1 },
                { ownerId: { set: ownerId } },
                { where: { ownerId: UUIDUtilities.generate() } }
            );

            expect(res.key).toBe(key);
            expect(res.ownerId).toBe(ownerId);
        });

        it('adds to the property without a condition, since an increment loses no other write', async () => {
            const ledger: Ledger = await createLedger();

            const res: Ledger = await ledgersOf().upsert(
                { key: ledger.key },
                { key: ledger.key, ownerId: ledger.ownerId, entries: 1 },
                { entries: { increment: 2 } }
            );

            expect(res.entries).toBe(3);
        });

        it('judges each row of a batch by its own condition, and writes none when one changed', async () => {
            const first: Ledger = await createLedger();
            const second: Ledger = await createLedger();
            const firstOwner: string = UUIDUtilities.generate();
            const secondOwner: string = UUIDUtilities.generate();

            const written: Ledger[] = await ledgersOf().upsertAll(['key'], [
                {
                    create: { key: first.key, ownerId: firstOwner, entries: 1 },
                    onConflict: { ownerId: { set: firstOwner } },
                    where: { ownerId: first.ownerId }
                },
                {
                    create: { key: second.key, ownerId: secondOwner, entries: 1 },
                    onConflict: { ownerId: { set: secondOwner } },
                    where: { ownerId: second.ownerId }
                }
            ]);
            await expect(ledgersOf().upsertAll(['key'], [
                {
                    create: { key: first.key, ownerId: second.ownerId, entries: 1 },
                    onConflict: { ownerId: { set: second.ownerId } },
                    where: { ownerId: firstOwner }
                },
                {
                    create: { key: second.key, ownerId: first.ownerId, entries: 1 },
                    onConflict: { ownerId: { set: first.ownerId } },
                    where: { ownerId: second.ownerId }
                }
            ])).rejects.toThrow(ConflictError);

            expect(written.map(l => l.ownerId)).toEqual([firstOwner, secondOwner]);
            expect((await ledgersOf().findById(first.id)).ownerId).toBe(firstOwner);
            expect((await ledgersOf().findById(second.id)).ownerId).toBe(secondOwner);
        });
    });
}