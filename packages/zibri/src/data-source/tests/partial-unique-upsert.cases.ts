import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { whereFor } from '../models/where/where-for.function';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about an upsert whose identity is unique among
 * only some of the rows. A file per data source runs them against a repository of its own.
 */

/**
 * A booking of a room, unique among the bookings that have not been cancelled.
 */
@Entity({ allowOrphan: true, allowDuplicate: true })
export class Slot extends BaseEntity {
    /**
     * What identifies a slot, among the slots that are still open.
     *
     * A cancelled slot keeps its room, and a new slot for that room is not in conflict with it -
     * which is the whole of what a key over part of a table means. Also what isolates one test from
     * the next, since it is the identity: a room is generated per test rather than named.
     */
    @Property.string({ unique: { where: whereFor<Slot>({ cancelled: false }) } })
    room!: string;

    /**
     * Whether it is still open, which is what decides if the key covers it.
     */
    @Property.boolean()
    cancelled!: boolean;

    /**
     * Counted up by the conflict path, so that an upsert landing on an existing row is told apart
     * from one inserting a new one.
     */
    @Property.number({ format: 'integer' })
    bookings!: number;
}

/**
 * Runs every case against the slots of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param slotsOf - Reads the repository, once the data source is started.
 */
export function describePartialUniqueUpsert(dataSourceName: string, slotsOf: () => Repository<Slot>): void {

    /**
     * Books the room, inserting the slot when it is not open yet and counting it up when it is.
     * @param room - The room to book.
     * @returns The slot as it stands after the call.
     */
    async function book(room: string): Promise<Slot> {
        return await slotsOf().upsert(
            { room },
            { room, cancelled: false, bookings: 1 },
            { bookings: { increment: 1 } }
        );
    }

    describe(`an upsert on a key covering part of the table, on ${dataSourceName}`, () => {
        it('inserts when no row the key covers holds the value', async () => {
            const room: string = UUIDUtilities.generate();

            const slot: Slot = await book(room);

            expect(slot.bookings).toBe(1);
            expect(slot.cancelled).toBe(false);
            expect(await slotsOf().count({ where: { room } })).toBe(1);
        });

        it('lands on the same row when one does', async () => {
            const room: string = UUIDUtilities.generate();
            await book(room);

            const again: Slot = await book(room);

            // the conflict path ran, which is the only way the count moves without a second row
            expect(again.bookings).toBe(2);
            expect(await slotsOf().count({ where: { room } })).toBe(1);
        });

        it('does not conflict with a row the key leaves out', async () => {
            const room: string = UUIDUtilities.generate();
            const first: Slot = await book(room);
            await slotsOf().updateById(first.id, { cancelled: true });

            const second: Slot = await book(room);

            // the cancelled row still holds the room and the key does not cover it, so this is an
            // insert rather than an increment - the row it would have landed on is out of scope
            expect(second.bookings).toBe(1);
            expect(second.id).not.toBe(first.id);
            expect(await slotsOf().count({ where: { room } })).toBe(2);
            expect(await slotsOf().count({ where: { room, cancelled: false } })).toBe(1);
        });

        it('keeps landing on the row the key does cover, with others beside it', async () => {
            const room: string = UUIDUtilities.generate();
            const first: Slot = await book(room);
            await slotsOf().updateById(first.id, { cancelled: true });
            const second: Slot = await book(room);

            const again: Slot = await book(room);

            // one row the key covers and one it does not, both holding the same room. The upsert has
            // to pick the covered one rather than whichever the store happens to read first
            expect(again.id).toBe(second.id);
            expect(again.bookings).toBe(2);
            expect(await slotsOf().count({ where: { room } })).toBe(2);
        });

        it('reads the rows the key leaves out', async () => {
            const room: string = UUIDUtilities.generate();
            const first: Slot = await book(room);
            await slotsOf().updateById(first.id, { cancelled: true });
            await book(room);

            const found: Slot[] = await slotsOf().findAll({ where: { room } });

            // a key covering part of the table covers part of the table, so anything reading a
            // filter through it answers about the covered rows alone. Both rooms are held here, and
            // a filter naming the property has to see both of them
            expect(found.map(f => f.cancelled).sort()).toEqual([false, true]);
            expect(await slotsOf().count({ where: { room } })).toBe(2);
        });

        it('tells two rooms apart', async () => {
            const blue: string = UUIDUtilities.generate();
            const red: string = UUIDUtilities.generate();

            await book(blue);
            const second: Slot = await book(red);

            expect(second.bookings).toBe(1);
            expect(await slotsOf().count({ where: { room: blue } })).toBe(1);
            expect(await slotsOf().count({ where: { room: red } })).toBe(1);
        });
    });
}