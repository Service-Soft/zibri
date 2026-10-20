import { describe, expect, it } from 'vitest';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../entity/models/relation.type.ts';
import { ConflictError } from '../../error-handling/errors/conflict.error.ts';
import { NotFoundError } from '../../error-handling/errors/not-found.error.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { Repository } from '../repository/repository.ts';

/**
 * The cases every data source answers the same way about what an update hands back. A file per data
 * source runs them against a repository of its own.
 */

const renewedAt: Date = new Date('2026-05-04T08:30:00.000Z');

/**
 * One column of every kind a write has to hand back, so that what arrives can be compared against
 * what a read of the same row gives.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Subscription extends BaseEntity {
    /**
     * The rows one test wrote, so that what a filter finds is not mixed up with another test's rows.
     */
    @Property.string()
    batch!: string;

    /**
     * Who it belongs to.
     */
    @Property.string()
    holder!: string;

    /**
     * What it is on, which is what most of the cases change.
     */
    @Property.string({ required: false })
    plan: string | undefined | null;

    /**
     * How many it covers, so a number arrives as one rather than as the text it is stored as.
     */
    @Property.number({ format: 'integer', required: false })
    seats: number | undefined | null;

    /**
     * When it last renewed, so a date arrives as one.
     */
    @Property.date({ required: false })
    renewedAt: Date | undefined | null;

    /**
     * Whether it is on hold, so a boolean that is `false` is told apart from one that is missing.
     */
    @Property.boolean({ required: false })
    suspended: boolean | undefined | null;

    /**
     * Stored as ciphertext, so that what an update hands back proves the hooks that run on a read
     * ran on it too.
     */
    @Property.string({ encryption: true, required: false })
    secret: string | undefined | null;

    /**
     * Stored as a digest, which is the other direction: nothing on the way out undoes it, so what
     * comes back has to be what is stored rather than what was written.
     */
    @Property.string({ hash: true, required: false })
    password: string | undefined | null;

    /**
     * Hidden on the way out, so that a write handing the row back hides it the same way a read does.
     */
    @Property.string({ exclude: true, required: false })
    note: string | undefined | null;
}

/**
 * Carries a relation it always reads, which is the one thing a write cannot hand back: the rows it
 * stands for are beside this one rather than in a column of it.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, defaultRelations: { seats: true } })
export class Team extends BaseEntity {
    /**
     * What it is called, which is what the case changes.
     */
    @Property.string()
    name!: string;

    /**
     * The rows that have to be resolved whether or not anybody asked for them.
     */
    @Property.oneToMany({ target: () => Seat, inverseSide: 'team' })
    seats!: Seat[];
}

/**
 * The far side of the relation a team always reads.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Seat extends BaseEntity {
    /**
     * Who is sitting in it.
     */
    @Property.string()
    occupant!: string;

    /**
     * The team it belongs to.
     */
    @Property.manyToOne({ target: () => Team, joinColumn: 'teamId', inverseSide: 'seats', required: false })
    team?: Relation<Team>;

    /**
     * The key that relation is stored as.
     */
    @Property.string({ format: 'uuid', required: false })
    teamId?: string;
}

/**
 * A team and the one seat it was created with, which the relation cases need both ends of.
 */
type TeamWithSeat = {
    /**
     * The team, as the create handed it back.
     */
    team: Team,
    /**
     * Its one seat, which carries the team's id in a column of its own.
     */
    seat: Seat
};

/**
 * Runs every case against the subscriptions of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param subscriptionsOf - Reads the repository, once the data source is started.
 * @param teamsOf - Reads the repository of the entity that always resolves a relation.
 * @param seatsOf - Reads the repository of the entity that holds a relation's key in a column.
 */
export function describeUpdatedEntity(
    dataSourceName: string,
    subscriptionsOf: () => Repository<Subscription>,
    teamsOf: () => Repository<Team>,
    seatsOf: () => Repository<Seat>
): void {

    /**
     * Creates one subscription under a batch of its own.
     * @returns The created subscription.
     */
    async function createSubscription(): Promise<Subscription> {
        return await subscriptionsOf().create({
            batch: UUIDUtilities.generate(),
            holder: 'Ada',
            plan: 'team',
            seats: 12,
            renewedAt,
            suspended: false,
            secret: 'kept',
            password: 'hunter2',
            note: 'internal'
        });
    }

    /**
     * Creates a team with one seat, and reads the seat back on its own.
     * @returns The team and its seat.
     */
    async function createTeamWithSeat(): Promise<TeamWithSeat> {
        const team: Team = await teamsOf().create({ name: 'core', seats: [{ occupant: 'Ada' }] });
        const seat: Seat | undefined = team.seats.at(0);
        if (seat == undefined) {
            throw new Error('the team was created without the seat it was given.');
        }
        return { team, seat };
    }

    describe(`what an update hands back, on ${dataSourceName}`, () => {
        it('holds every column, not only the ones that were written', async () => {
            const created: Subscription = await createSubscription();

            const updated: Subscription = await subscriptionsOf().updateById(created.id, { plan: 'enterprise' });

            expect(updated.plan).toBe('enterprise');
            expect(updated.holder).toBe('Ada');
            expect(updated.seats).toBe(12);
            expect(updated.suspended).toBe(false);
            expect(updated.renewedAt?.getTime()).toBe(renewedAt.getTime());
            expect(updated.id).toBe(created.id);
        });

        it('holds what the same row reads back as', async () => {
            const created: Subscription = await createSubscription();

            const updated: Subscription = await subscriptionsOf().updateById(created.id, { seats: 30 });
            const read: Subscription = await subscriptionsOf().findById(created.id);

            // the update no longer reads the row, so the two answers come from different places -
            // which is exactly why they have to agree
            expect(updated.seats).toBe(read.seats);
            expect(updated.renewedAt?.getTime()).toBe(read.renewedAt?.getTime());
            expect(updated.suspended).toBe(read.suspended);
            expect(updated.holder).toBe(read.holder);
        });

        it('hands back a decrypted value, the way a read does', async () => {
            const created: Subscription = await createSubscription();

            const updated: Subscription = await subscriptionsOf().updateById(created.id, { holder: 'Grace' });

            expect(updated.secret).toBe('kept');
        });

        it('hands back a hashed value as what is stored, the way a read does', async () => {
            const created: Subscription = await createSubscription();

            const updated: Subscription = await subscriptionsOf().updateById(created.id, { holder: 'Grace' });
            const read: Subscription = await subscriptionsOf().findById(created.id);

            // nothing on the way out undoes a hash, so the one thing that would be wrong is the
            // write handing back what the caller passed in rather than what landed
            expect(updated.password).not.toBe('hunter2');
            expect(updated.password).toBe(read.password);
        });

        it('hides an excluded property, the way a read does', async () => {
            const created: Subscription = await createSubscription();

            const updated: Subscription = await subscriptionsOf().updateById(created.id, { holder: 'Grace' });
            const read: Subscription = await subscriptionsOf().findById(created.id);

            // hidden rather than dropped: the value is still readable by name and gone from anything
            // that walks the object, which is what serializing it does
            expect(Object.keys(updated)).not.toContain('note');
            expect(Object.keys(read)).not.toContain('note');
            expect(updated.note).toBe('internal');
        });

        it('hands back a value the update itself wrote to an encrypted property', async () => {
            const created: Subscription = await createSubscription();

            const updated: Subscription = await subscriptionsOf().updateById(created.id, { secret: 'rotated' });

            expect(updated.secret).toBe('rotated');
            expect(await subscriptionsOf().findById(created.id)).toHaveProperty('secret', 'rotated');
        });

        it('refuses a condition that no longer holds, without writing', async () => {
            const created: Subscription = await createSubscription();
            await subscriptionsOf().updateById(created.id, { plan: 'solo' });

            await expect(subscriptionsOf().updateById(created.id, { seats: 1 }, { where: { plan: 'team' } }))
                .rejects.toThrow(ConflictError);
            expect(await subscriptionsOf().findById(created.id)).toHaveProperty('seats', 12);
        });

        it('refuses an id that is not there', async () => {
            await expect(subscriptionsOf().updateById(UUIDUtilities.generate(), { plan: 'solo' }))
                .rejects.toThrow(NotFoundError);
        });

        it('hands back every row a bulk update wrote', async () => {
            const batch: string = UUIDUtilities.generate();
            await subscriptionsOf().createAll([
                { batch, holder: 'a', plan: 'team', seats: 1, renewedAt, suspended: false, secret: 'one' },
                { batch, holder: 'b', plan: 'team', seats: 2, renewedAt, suspended: false, secret: 'two' }
            ]);

            const updated: Subscription[] = await subscriptionsOf().updateAll(
                { batch },
                { plan: 'enterprise' },
                { returnUpdated: true }
            );

            // the filter matches on the column the write does not touch, and the one it does is read
            // off what came back - a write that reported the rows it did not change would show here
            expect(updated.map(u => u.plan)).toEqual(['enterprise', 'enterprise']);
            expect(updated.map(u => u.holder).sort()).toEqual(['a', 'b']);
            expect(updated.map(u => u.seats).sort()).toEqual([1, 2]);
        });

        it('counts the rows a bulk update wrote when nobody asked for them', async () => {
            const batch: string = UUIDUtilities.generate();
            await subscriptionsOf().createAll([
                { batch, holder: 'c', plan: 'team', seats: 1, renewedAt, suspended: false, secret: 'three' },
                { batch, holder: 'd', plan: 'solo', seats: 2, renewedAt, suspended: false, secret: 'four' }
            ]);

            const count: number = await subscriptionsOf().updateAll({ batch, plan: 'team' }, { suspended: true });

            expect(count).toBe(1);
            expect(await subscriptionsOf().count({ where: { batch, suspended: true } })).toBe(1);
        });

        it('hands a deleted row back the way a read does', async () => {
            const created: Subscription = await createSubscription();

            const deleted: Subscription = await subscriptionsOf().deleteById(created.id);

            // the row is on its way out and still goes through what a read goes through: a caller
            // handed it back reads it like any other entity
            expect(deleted.secret).toBe('kept');
            expect(Object.keys(deleted)).not.toContain('note');
            expect(deleted.holder).toBe('Ada');
        });

        it('hands the rows of a bulk delete back the same way', async () => {
            const batch: string = UUIDUtilities.generate();
            await subscriptionsOf().createAll([{ batch, holder: 'e', secret: 'five', note: 'hidden' }]);

            const deleted: Subscription[] = await subscriptionsOf().deleteAll({ batch }, { returnDeleted: true });

            expect(deleted.map(d => d.secret)).toEqual(['five']);
            expect(Object.keys(deleted[0] ?? {})).not.toContain('note');
        });

        it('counts a bulk delete without handing the rows back', async () => {
            const batch: string = UUIDUtilities.generate();
            await subscriptionsOf().createAll([
                { batch, holder: 'f', plan: 'team', seats: 1, renewedAt, suspended: false, secret: 'six' },
                { batch, holder: 'g', plan: 'solo', seats: 2, renewedAt, suspended: false, secret: 'seven' }
            ]);

            const count: number = await subscriptionsOf().deleteAll({ batch });

            expect(count).toBe(2);
            expect(await subscriptionsOf().count({ where: { batch } })).toBe(0);
        });

        it('resolves a relation the entity always reads', async () => {
            const { team }: TeamWithSeat = await createTeamWithSeat();

            const updated: Team = await teamsOf().updateById(team.id, { name: 'platform' });

            // a relation lives in rows beside this one, so a write cannot report it - the row is
            // read once the write has landed, and the entity comes back whole either way
            expect(updated.name).toBe('platform');
            expect(updated.seats.map(s => s.occupant)).toEqual(['Ada']);
        });

        it('resolves a relation the caller asks for', async () => {
            const { team, seat }: TeamWithSeat = await createTeamWithSeat();

            const updated: Seat = await seatsOf().updateById(
                seat.id,
                { occupant: 'Grace' },
                { relations: { team: true } }
            );

            // a seat reads no relation by default, so this is the caller's ask alone deciding that
            // the write is followed by a read
            expect(updated.occupant).toBe('Grace');
            expect(updated.team?.id).toBe(team.id);
        });

        it('resolves a relation a create asks for but did not name', async () => {
            const { team }: TeamWithSeat = await createTeamWithSeat();

            // the key rather than the row, which is all a create needs to write - so the relation is
            // not something the write has and could report, it is something only a read can answer
            const seat: Seat = await seatsOf().create(
                { occupant: 'Hedy', teamId: team.id },
                { relations: { team: true } }
            );

            expect(seat.teamId).toBe(team.id);
            expect(seat.team?.id).toBe(team.id);
        });

        it('keeps the column a relation is stored in, without resolving the relation', async () => {
            const { team, seat }: TeamWithSeat = await createTeamWithSeat();

            const updated: Seat = await seatsOf().updateById(seat.id, { occupant: 'Grace' });
            const read: Seat = await seatsOf().findById(seat.id);

            // the key is a column this entity declares, so it comes back like any other. The
            // relation it stands for is not asked for here, and is absent from both answers - the
            // two have to agree on that as much as on the key
            expect(updated.teamId).toBe(team.id);
            expect(updated.teamId).toBe(read.teamId);
            expect(updated.team).toBe(read.team);
        });

        it('hands a bulk update back with the relation the entity always reads', async () => {
            const { team }: TeamWithSeat = await createTeamWithSeat();

            const [updated]: Team[] = await teamsOf().updateAll(
                { id: team.id },
                { name: 'renamed' },
                { returnUpdated: true }
            );

            // one read for the whole batch rather than one per row, which is what a bulk write can
            // afford - and what makes the rows it hands back the rows a read of them would give
            expect(updated?.name).toBe('renamed');
            expect(updated?.seats.map(s => s.occupant)).toEqual(['Ada']);
        });

        it('resolves a relation a bulk update asks for', async () => {
            const { team, seat }: TeamWithSeat = await createTeamWithSeat();

            const [updated]: Seat[] = await seatsOf().updateAll(
                { id: seat.id },
                { occupant: 'Grace' },
                { returnUpdated: true, relations: { team: true } }
            );

            // a seat reads no relation by default, so the caller's ask alone decides it
            expect(updated?.occupant).toBe('Grace');
            expect(updated?.team?.id).toBe(team.id);
        });

        it('hands a bulk create back with the relation the entity always reads', async () => {
            const created: Team[] = await teamsOf().createAll([{ name: 'bulk' }]);

            // the create data names no seats at all, so an empty list is the read answering rather
            // than the write handing back what it was given
            expect(created.map(c => c.seats)).toEqual([[]]);
        });

        it('resolves a relation a bulk create asks for', async () => {
            const { team }: TeamWithSeat = await createTeamWithSeat();

            const created: Seat[] = await seatsOf().createAll(
                [{ occupant: 'Hedy', teamId: team.id }],
                { relations: { team: true } }
            );

            expect(created.map(c => c.team?.id)).toEqual([team.id]);
        });

        it('hands a bulk delete back with the relation the entity always reads', async () => {
            const team: Team = await teamsOf().create({ name: 'disbanding', seats: [] });

            const deleted: Team[] = await teamsOf().deleteAll({ id: team.id }, { returnDeleted: true });

            expect(deleted.map(d => d.seats)).toEqual([[]]);
        });

        it('resolves a relation a bulk delete asks for', async () => {
            const { team, seat }: TeamWithSeat = await createTeamWithSeat();

            const deleted: Seat[] = await seatsOf().deleteAll(
                { id: seat.id },
                { returnDeleted: true, relations: { team: true } }
            );

            // the rows are read before they go, so the relation is resolved on the way out rather
            // than looked for afterwards, when there is nothing left to look from
            expect(deleted.map(d => d.team?.id)).toEqual([team.id]);
        });

        it('writes a relation the update names', async () => {
            const { seat }: TeamWithSeat = await createTeamWithSeat();
            const other: Team = await teamsOf().create({ name: 'other', seats: [] });

            const updated: Seat = await seatsOf().updateById(
                seat.id,
                { team: other },
                { relations: { team: true } }
            );

            // a relation is not a column, so this is the write that cannot be one statement - it
            // still has to answer with the row as it now stands
            expect(updated.team?.id).toBe(other.id);
            expect(await seatsOf().findById(seat.id)).toHaveProperty('teamId', other.id);
        });
    });
}