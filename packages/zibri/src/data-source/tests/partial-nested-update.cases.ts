/* eslint-disable jsdoc/require-jsdoc */
import { describe, expect, it } from '@jest/globals';
import { type Relation } from 'typeorm';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about an object an update gives: it is merged
 * into the stored one, as deep as the objects go, on every path an update takes. A file per data
 * source runs them against repositories of its own.
 */

export class Point {
    @Property.number()
    lat!: number;

    @Property.number()
    lng!: number;
}

export class Location {
    @Property.string()
    street!: string;

    @Property.string()
    number!: string;

    @Property.string({ required: false })
    note?: string | null;

    @Property.object({ cls: () => Point, required: false })
    point?: Point | null;

    @Property.array({ items: { type: 'string' }, required: false })
    lines?: string[] | null;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Venue extends BaseEntity {
    /**
     * The rows one test wrote, so that what an update matches is not mixed up with another test's rows.
     */
    @Property.string()
    batch!: string;

    @Property.string()
    name!: string;

    @Property.object({ cls: () => Location, required: false })
    location?: Location | null;

    @Property.string({ encryption: true, required: false })
    doorCode?: string;

    @Property.manyToOne({ target: () => Organizer, joinColumn: 'organizerId', inverseSide: 'venues', required: false })
    organizer?: Relation<Organizer>;

    @Property.string({ format: 'uuid', required: false })
    organizerId?: string;

    @Property.manyToMany({ target: () => Label, inverseSide: 'venues', joinTable: true })
    labels!: Label[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Organizer extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Venue, inverseSide: 'organizer' })
    venues!: Venue[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Label extends BaseEntity {
    @Property.string()
    text!: string;

    @Property.manyToMany({ target: () => Venue, inverseSide: 'labels', joinTable: false })
    venues!: Venue[];
}

/**
 * The repositories the cases run against.
 */
export type PartialNestedUpdateRepositories = {
    /**
     * The venues, which the cases update.
     */
    venues: Repository<Venue>,
    /**
     * The organizers, which own venues and filter them through a relation.
     */
    organizers: Repository<Organizer>,
    /**
     * The labels, which a venue names through a join table.
     */
    labels: Repository<Label>
};

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoriesOf - Reads the repositories, once the data source is started.
 */
export function describePartialNestedUpdate(dataSourceName: string, repositoriesOf: () => PartialNestedUpdateRepositories): void {
    const main: Location = { street: 'Main', number: '1', note: 'back door', point: { lat: 1, lng: 2 }, lines: ['a', 'b'] };

    /**
     * Creates a venue at the main location, in a batch no other test uses.
     * @param location - Where the venue is, the main location unless given.
     * @returns The venue.
     */
    async function createVenue(location: Location | null = main): Promise<Venue> {
        return await repositoriesOf().venues.create({ batch: UUIDUtilities.generate(), name: 'hall', location });
    }

    /**
     * Reads where a venue is, as it is stored.
     * @param id - The id of the venue.
     * @returns Its location.
     */
    async function storedLocation(id: string): Promise<Location | null | undefined> {
        return (await repositoriesOf().venues.findById(id)).location;
    }

    describe(`an object an update gives, on ${dataSourceName}`, () => {
        it('changes what updateById names and keeps the rest', async () => {
            const venue: Venue = await createVenue();

            const res: Venue = await repositoriesOf().venues.updateById(venue.id, { location: { number: '42' } });

            expect(res.location).toEqual({ ...main, number: '42' });
            expect(await storedLocation(venue.id)).toEqual({ ...main, number: '42' });
        });

        it('merges an object inside the object as deep as it goes', async () => {
            const venue: Venue = await createVenue();

            await repositoriesOf().venues.updateById(venue.id, { location: { point: { lat: 9 } } });

            expect(await storedLocation(venue.id)).toEqual({ ...main, point: { lat: 9, lng: 2 } });
        });

        it('replaces an array inside the object whole', async () => {
            const venue: Venue = await createVenue();

            await repositoriesOf().venues.updateById(venue.id, { location: { lines: ['c'] } });

            expect(await storedLocation(venue.id)).toEqual({ ...main, lines: ['c'] });
        });

        it('stores null for a property of the object given as null', async () => {
            const venue: Venue = await createVenue();

            // eslint-disable-next-line unicorn/no-null
            await repositoriesOf().venues.updateById(venue.id, { location: { note: null } });

            // eslint-disable-next-line unicorn/no-null
            expect(await storedLocation(venue.id)).toEqual({ ...main, note: null });
        });

        it('stores null for the object given as null', async () => {
            const venue: Venue = await createVenue();

            // eslint-disable-next-line unicorn/no-null
            await repositoriesOf().venues.updateById(venue.id, { location: null });

            expect(await storedLocation(venue.id)).toBeNull();
        });

        it('stores the object as given where the row holds none', async () => {
            // eslint-disable-next-line unicorn/no-null
            const venue: Venue = await createVenue(null);

            await repositoriesOf().venues.updateById(venue.id, { location: { street: 'Side', number: '2' } });

            expect(await storedLocation(venue.id)).toEqual({ street: 'Side', number: '2' });
        });

        it('merges into what each row holds when updateAll matches several', async () => {
            const batch: string = UUIDUtilities.generate();
            const first: Venue = await repositoriesOf().venues.create({ batch, name: 'first', location: main });
            const second: Venue = await repositoriesOf().venues.create({
                batch,
                name: 'second',
                location: { street: 'Side', number: '2' }
            });

            const note: string = 'ring twice';
            await repositoriesOf().venues.updateAll({ batch }, { location: { note } });

            expect(await storedLocation(first.id)).toEqual({ ...main, note });
            expect(await storedLocation(second.id)).toEqual({ street: 'Side', number: '2', note });
        });

        it('merges when updateAll filters through a relation', async () => {
            const organizer: Organizer = await repositoriesOf().organizers.create({ name: UUIDUtilities.generate() });
            const venue: Venue = await repositoriesOf().venues.create({
                batch: UUIDUtilities.generate(),
                name: 'hall',
                location: main,
                organizerId: organizer.id
            });

            await repositoriesOf().venues.updateAll({ organizer: { where: { name: organizer.name } } }, { location: { number: '7' } });

            expect(await storedLocation(venue.id)).toEqual({ ...main, number: '7' });
        });

        it('merges when updateAll gives a relation as well', async () => {
            const venue: Venue = await createVenue();
            const label: Label = await repositoriesOf().labels.create({ text: 'loud' });

            await repositoriesOf().venues.updateAll({ batch: venue.batch }, { location: { number: '8' }, labels: [label] });

            const stored: Venue = await repositoriesOf().venues.findById(venue.id, { relations: ['labels'] });
            expect(stored.location).toEqual({ ...main, number: '8' });
            expect(stored.labels.map(l => l.id)).toEqual([label.id]);
        });

        it('merges when updateAll writes an encrypted value of each row its own', async () => {
            const venue: Venue = await createVenue();

            await repositoriesOf().venues.updateAll({ batch: venue.batch }, { location: { number: '9' }, doorCode: '1234' });

            const stored: Venue = await repositoriesOf().venues.findById(venue.id);
            expect(stored.location).toEqual({ ...main, number: '9' });
            expect(stored.doorCode).toBe('1234');
        });

        it('merges into a related row an update gives by its id', async () => {
            const organizer: Organizer = await repositoriesOf().organizers.create({ name: UUIDUtilities.generate() });
            const venue: Venue = await repositoriesOf().venues.create({
                batch: UUIDUtilities.generate(),
                name: 'hall',
                location: main,
                organizerId: organizer.id
            });

            await repositoriesOf().organizers.updateById(organizer.id, { venues: [{ id: venue.id, location: { number: '10' } }] });

            expect(await storedLocation(venue.id)).toEqual({ ...main, number: '10' });
        });
    });
}