import { describe, expect, it } from 'vitest';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { UpsertRow } from '../models/upsert-row.model.ts';
import { Repository } from '../repository/repository.ts';

/**
 * The cases every data source answers the same way about an upsert of several rows in one call. A
 * file per data source runs them against a repository of its own.
 */

/**
 * A named tally: one per name across the whole table.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Tally extends BaseEntity {
    /**
     * What identifies a tally. Generated per test, which is what keeps one test's rows apart from
     * the next.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * Set or counted up by the conflict path.
     */
    @Property.number({ format: 'integer' })
    count!: number;

    /**
     * Something a row may leave out, and a second column a conflict can change.
     */
    @Property.string({ required: false })
    note: string | undefined | null;
}

/**
 * Runs every case against the tallies of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param talliesOf - Reads the repository, once the data source is started.
 */
export function describeUpsertAll(dataSourceName: string, talliesOf: () => Repository<Tally>): void {

    /**
     * Builds a name no other test uses.
     * @returns The name.
     */
    function freshName(): string {
        return `tally-${UUIDUtilities.generate()}`;
    }

    describe(`an upsert of several rows at once, on ${dataSourceName}`, () => {
        it('inserts the rows whose identity is free and changes the ones whose identity is held', async () => {
            const held: Tally = await talliesOf().create({ name: freshName(), count: 5 });
            const free: string = freshName();

            const [changed, inserted] = await talliesOf().upsertAll(['name'], [
                { create: { name: held.name, count: 1 }, onConflict: { count: { increment: 2 } } },
                { create: { name: free, count: 1 }, onConflict: { count: { increment: 2 } } }
            ]);

            expect(changed?.id).toBe(held.id);
            expect(changed?.count).toBe(7);
            expect(inserted?.name).toBe(free);
            expect(inserted?.count).toBe(1);
            expect(await talliesOf().count({ where: { name: { oneOf: [held.name, free] } } })).toBe(2);
        });

        it('applies to each row the change that row brings', async () => {
            const first: Tally = await talliesOf().create({ name: freshName(), count: 1 });
            const second: Tally = await talliesOf().create({ name: freshName(), count: 1 });
            const third: Tally = await talliesOf().create({ name: freshName(), count: 1 });

            const res: Tally[] = await talliesOf().upsertAll(['name'], [
                { create: { name: first.name, count: 0 }, onConflict: { count: { increment: 1 } } },
                { create: { name: second.name, count: 0 }, onConflict: { count: { increment: 10 } } },
                { create: { name: third.name, count: 0 }, onConflict: { count: { set: 100 } } }
            ]);

            // one column, three different changes to it, and a set beside the increments
            expect(res.map(r => r.count)).toEqual([2, 11, 100]);
        });

        it('leaves a column alone for a row whose change does not name it', async () => {
            const counted: Tally = await talliesOf().create({ name: freshName(), count: 1, note: 'kept' });
            const noted: Tally = await talliesOf().create({ name: freshName(), count: 1, note: 'old' });

            await talliesOf().upsertAll(['name'], [
                { create: { name: counted.name, count: 0 }, onConflict: { count: { increment: 1 } } },
                { create: { name: noted.name, count: 0 }, onConflict: { note: { set: 'new' } } }
            ]);

            const storedCounted: Tally = await talliesOf().findById(counted.id);
            const storedNoted: Tally = await talliesOf().findById(noted.id);
            expect(storedCounted.count).toBe(2);
            expect(storedCounted.note).toBe('kept');
            expect(storedNoted.count).toBe(1);
            expect(storedNoted.note).toBe('new');
        });

        it('hands the rows back in the order they were given', async () => {
            const held: Tally = await talliesOf().create({ name: freshName(), count: 1 });
            const names: string[] = [freshName(), held.name, freshName()];

            const res: Tally[] = await talliesOf().upsertAll(
                ['name'],
                names.map(name => ({ create: { name, count: 1 }, onConflict: { count: { increment: 1 } } }))
            );

            expect(res.map(r => r.name)).toEqual(names);
            expect(res[1]?.id).toBe(held.id);
        });

        it('writes what a row leaves out the way creating it alone would', async () => {
            const created: Tally = await talliesOf().create({ name: freshName(), count: 1 });

            const [noted, bare] = await talliesOf().upsertAll(['name'], [
                { create: { name: freshName(), count: 1, note: 'given' }, onConflict: { count: { increment: 1 } } },
                { create: { name: freshName(), count: 1 }, onConflict: { count: { increment: 1 } } }
            ]);

            // one statement inserts every row with the same columns, and the row that gives no note
            // must not come out holding something a row created on its own would not
            expect(noted?.note).toBe('given');
            expect(bare?.note).toEqual(created.note);
        });

        it('refuses two rows holding the same identity, and writes neither', async () => {
            const name: string = freshName();

            const res: Promise<Tally[]> = talliesOf().upsertAll(['name'], [
                { create: { name, count: 1 }, onConflict: { count: { increment: 1 } } },
                { create: { name, count: 1 }, onConflict: { count: { increment: 1 } } }
            ]);

            await expect(res).rejects.toThrow(InternalError);
            expect(await talliesOf().count({ where: { name } })).toBe(0);
        });

        it('refuses a change that would move a row to another identity', async () => {
            const held: Tally = await talliesOf().create({ name: freshName(), count: 1 });

            const res: Promise<Tally[]> = talliesOf().upsertAll(
                ['name'],
                [{ create: { name: held.name, count: 1 }, onConflict: { name: { set: freshName() } } }]
            );

            // the identity is what the row was found by, so changing it lands the row on one nobody
            // looked up. Written back to itself it changes nothing, which the control below keeps legal
            await expect(res).rejects.toThrow(InternalError);
            const [kept] = await talliesOf().upsertAll(
                ['name'],
                [{ create: { name: held.name, count: 1 }, onConflict: { name: { set: held.name } } }]
            );
            expect(kept?.id).toBe(held.id);
        });

        it('refuses a single upsert whose identity names other values than its row', async () => {
            const res: Promise<Tally> = talliesOf().upsert(
                { name: freshName() },
                { name: freshName(), count: 1 },
                { count: { increment: 1 } }
            );

            // a store looks the row up by one and inserts the other
            await expect(res).rejects.toThrow(InternalError);
        });

        it('lands two batches naming the same rows in opposite orders', async () => {
            const held: Tally[] = await talliesOf().createAll(Array.from({ length: 200 }, () => ({ name: freshName(), count: 0 })));
            const counted: UpsertRow<Tally>[] = held.map(h => ({
                create: { name: h.name, count: 0 },
                onConflict: { count: { increment: 1 } }
            }));

            // each would take the rows it shares with the other in its own order, so the two meet half
            // way and each waits on what the other holds - unless the store takes them in one order
            // whatever order they were given in
            await Promise.all([
                talliesOf().upsertAll(['name'], counted),
                talliesOf().upsertAll(['name'], [...counted].reverse())
            ]);

            const stored: Tally[] = await talliesOf().findAll({ where: { name: { oneOf: held.map(h => h.name) } } });
            expect(stored.map(s => s.count)).toEqual(held.map(() => 2));
        }, 60000);

        it('answers an empty batch with no rows', async () => {
            expect(await talliesOf().upsertAll(['name'], [])).toEqual([]);
        });
    });
}