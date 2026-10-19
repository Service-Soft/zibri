/* eslint-disable jsdoc/require-jsdoc */
import { afterEach, describe, expect, it } from '@jest/globals';
import { type Relation } from 'typeorm';

import { ChangeSetType } from '../../change-sets/models/change-set-type.enum';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { scopeFor } from '../../entity/models/entity-scope.model';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about what saving and deleting a row does with
 * the rows of its one to many and has one relations. A file per data source runs them against
 * repositories of its own.
 */

/**
 * The keeper the scope of a pet restricts to, set by the case about it. Undefined otherwise, which
 * the scope then does not restrict.
 */
let actingKeeper: string | undefined;

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Household extends BaseEntity {
    @Property.string()
    name!: string;

    // the default cascade: inserts, updates and removes
    @Property.oneToMany({ target: () => Resident, inverseSide: 'household' })
    residents!: Resident[];

    // inserts only, so a pet given with an id is linked and nothing else of it is written
    @Property.oneToMany({ target: () => Pet, inverseSide: 'household', cascade: ['insert'] })
    pets!: Pet[];

    @Property.hasOne({ target: () => Doorplate, inverseSide: 'household' })
    doorplate?: Relation<Doorplate>;

    // an entity with change sets and a soft delete, which its own repository writes
    @Property.oneToMany({ target: () => Guest, inverseSide: 'household' })
    guests!: Guest[];

    // a soft deleting entity not removed along with the household
    @Property.oneToMany({ target: () => Lodger, inverseSide: 'household', cascade: ['insert', 'update'] })
    lodgers!: Lodger[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Resident extends BaseEntity {
    @Property.string()
    name!: string;

    // what one row of an update can give and another leave alone, or empty
    @Property.string({ required: false })
    nickname?: string | null;

    @Property.manyToOne({ target: () => Household, joinColumn: 'householdId', inverseSide: 'residents' })
    household!: Household;

    // required, so a resident left out of the list has nothing to be unlinked to and is deleted
    @Property.string({ format: 'uuid' })
    householdId!: string;

    @Property.oneToMany({ target: () => Chore, inverseSide: 'resident' })
    chores!: Chore[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Chore extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.manyToOne({ target: () => Resident, joinColumn: 'residentId', inverseSide: 'chores' })
    resident!: Resident;

    @Property.string({ format: 'uuid' })
    residentId!: string;
}

@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: { restrictedTo: scopeFor<Pet>(() => actingKeeper == undefined ? undefined : { keeper: actingKeeper }) }
})
export class Pet extends BaseEntity {
    @Property.string()
    name!: string;

    // what the scope restricts by
    @Property.string({ required: false })
    keeper?: string;

    @Property.manyToOne({ target: () => Household, joinColumn: 'householdId', inverseSide: 'pets', required: false })
    household?: Household;

    // optional, so a pet left out of the list is unlinked rather than deleted
    @Property.string({ format: 'uuid', required: false })
    householdId?: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Doorplate extends BaseEntity {
    @Property.string()
    text!: string;

    @Property.belongsToOne({ target: () => Household, joinColumn: 'householdId', inverseSide: 'doorplate' })
    household!: Household;

    @Property.string({ format: 'uuid' })
    householdId!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Guest extends SoftDeleteEntity {
    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Household, joinColumn: 'householdId', inverseSide: 'guests' })
    household!: Household;

    @Property.string({ format: 'uuid' })
    householdId!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Trip extends SoftDeleteEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Stop, inverseSide: 'trip' })
    stops!: Stop[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Stop extends SoftDeleteEntity {
    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Trip, joinColumn: 'tripId', inverseSide: 'stops' })
    trip!: Trip;

    @Property.string({ format: 'uuid' })
    tripId!: string;

    @Property.oneToMany({ target: () => Ticket, inverseSide: 'stop' })
    tickets!: Ticket[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Ticket extends SoftDeleteEntity {
    @Property.string()
    seat!: string;

    @Property.manyToOne({ target: () => Stop, joinColumn: 'stopId', inverseSide: 'tickets' })
    stop!: Stop;

    @Property.string({ format: 'uuid' })
    stopId!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Lodger extends SoftDeleteEntity {
    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Household, joinColumn: 'householdId', inverseSide: 'lodgers' })
    household!: Household;

    @Property.string({ format: 'uuid' })
    householdId!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Folder extends BaseEntity {
    @Property.string()
    name!: string;

    // pointing at a row of the same entity, and not removed along with it
    @Property.oneToMany({ target: () => Folder, inverseSide: 'parent', cascade: ['insert', 'update'] })
    children!: Folder[];

    @Property.manyToOne({ target: () => Folder, joinColumn: 'parentId', inverseSide: 'children', required: false })
    parent?: Folder;

    @Property.string({ format: 'uuid', required: false })
    parentId?: string;
}

/**
 * The entities of the cases, for the data sources running them.
 */
export const ownedRelationEntities: Newable<BaseEntity>[] = [
    Household,
    Resident,
    Chore,
    Pet,
    Doorplate,
    Guest,
    Trip,
    Stop,
    Ticket,
    Lodger,
    Folder
];

/**
 * The repositories the cases run against.
 */
export type OwnedRelationRepositories = {
    households: Repository<Household>,
    residents: Repository<Resident>,
    chores: Repository<Chore>,
    pets: Repository<Pet>,
    doorplates: Repository<Doorplate>,
    guests: SoftDeleteRepository<Guest>,
    changeSets: Repository<ChangeSet>,
    trips: SoftDeleteRepository<Trip>,
    stops: SoftDeleteRepository<Stop>,
    tickets: SoftDeleteRepository<Ticket>,
    lodgers: SoftDeleteRepository<Lodger>,
    folders: Repository<Folder>
};

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoriesOf - Reads the repositories, once the data source is started.
 */
export function describeOwnedRelations(dataSourceName: string, repositoriesOf: () => OwnedRelationRepositories): void {
    describe(`what saving and deleting a row does with the rows of its to many and has one relations, on ${dataSourceName}`, () => {
        afterEach(() => {
            actingKeeper = undefined;
        });

        it('creates rows two levels down along with their owner', async () => {
            const household: Household = await repositoriesOf().households.create({
                name: 'two levels',
                residents: [{ name: 'Ada', chores: [{ title: 'dishes' }, { title: 'laundry' }] }]
            });

            const residents: Resident[] = await repositoriesOf().residents.findAll({
                where: { householdId: household.id },
                relations: ['chores']
            });
            expect(residents.map(r => r.name)).toEqual(['Ada']);
            expect(residents[0]?.chores.map(c => c.title).sort()).toEqual(['dishes', 'laundry']);
        });

        it('updates a row of a relation that cascades updates', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'updates', residents: [{ name: 'Ada' }] });
            const [ada] = household.residents;

            await repositoriesOf().households.updateById(household.id, { residents: [{ id: ada?.id, name: 'Ada L.' }] });

            expect((await repositoriesOf().residents.findById(ada?.id ?? '')).name).toBe('Ada L.');
        });

        it('updates the rows of a relation given with their ids, each with its own values', async () => {
            const household: Household = await repositoriesOf().households.create({
                name: 'each',
                residents: [{ name: 'Ada', nickname: 'A' }, { name: 'Bob', nickname: 'B' }]
            });
            const ada: Resident | undefined = household.residents.find(r => r.name === 'Ada');
            const bob: Resident | undefined = household.residents.find(r => r.name === 'Bob');

            await repositoriesOf().households.updateById(household.id, {
                // eslint-disable-next-line unicorn/no-null
                residents: [{ id: ada?.id, name: 'Ada L.' }, { id: bob?.id, nickname: null }]
            });

            const updatedAda: Resident = await repositoriesOf().residents.findById(ada?.id ?? '');
            const updatedBob: Resident = await repositoriesOf().residents.findById(bob?.id ?? '');
            expect([updatedAda.name, updatedAda.nickname]).toEqual(['Ada L.', 'A']);
            expect([updatedBob.name, updatedBob.nickname ?? undefined]).toEqual(['Bob', undefined]);
        });

        it('links a row given with its id to a relation that does not cascade updates, and writes nothing else of it', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'links' });
            const rex: Pet = await repositoriesOf().pets.create({ name: 'Rex' });

            await repositoriesOf().households.updateById(household.id, { pets: [{ id: rex.id, name: 'Max' }] });

            const read: Pet = await repositoriesOf().pets.findById(rex.id);
            expect(read.householdId).toBe(household.id);
            expect(read.name).toBe('Rex');
        });

        it('deletes a row left out of a to many relation whose foreign key is required', async () => {
            const household: Household = await repositoriesOf().households.create({
                name: 'required key',
                residents: [{ name: 'Ada' }, { name: 'Grace' }]
            });
            const ada: Resident | undefined = household.residents.find(r => r.name === 'Ada');

            await repositoriesOf().households.updateById(household.id, { residents: [{ id: ada?.id }] });

            const residents: Resident[] = await repositoriesOf().residents.findAll({ where: { householdId: household.id } });
            expect(residents.map(r => r.name)).toEqual(['Ada']);
            expect(await repositoriesOf().residents.count({ where: { name: 'Grace', householdId: household.id } })).toBe(0);
        });

        it('unlinks a row left out of a to many relation whose foreign key is optional', async () => {
            const household: Household = await repositoriesOf().households.create({
                name: 'optional key',
                pets: [{ name: 'Rex' }, { name: 'Bella' }]
            });
            const rex: Pet | undefined = household.pets.find(p => p.name === 'Rex');
            const bella: Pet | undefined = household.pets.find(p => p.name === 'Bella');

            await repositoriesOf().households.updateById(household.id, { pets: [{ id: rex?.id }] });

            expect((await repositoriesOf().pets.findById(rex?.id ?? '')).householdId).toBe(household.id);
            const unlinked: Pet = await repositoriesOf().pets.findById(bella?.id ?? '');
            expect(unlinked.householdId == undefined).toBe(true);
        });

        it('empties a to many relation given as an empty list', async () => {
            const household: Household = await repositoriesOf().households.create({
                name: 'emptied',
                residents: [{ name: 'Ada' }, { name: 'Grace' }]
            });

            await repositoriesOf().households.updateById(household.id, { residents: [] });

            expect(await repositoriesOf().residents.count({ where: { householdId: household.id } })).toBe(0);
        });

        it('creates a row given with an id no row has yet, when the write allows ids', async () => {
            const id: string = UUIDUtilities.generate();

            const household: Household = await repositoriesOf().households.create(
                { name: 'chosen ids', residents: [{ id, name: 'Ada' }] },
                { allowId: true }
            );

            expect((await repositoriesOf().residents.findById(id)).householdId).toBe(household.id);
        });

        it('gives every row an update matches its own rows of a relation', async () => {
            const batch: string = `batch-${UUIDUtilities.generate()}`;
            const [first, second] = await repositoriesOf().households.createAll([
                { name: batch, residents: [{ name: 'Ada' }] },
                { name: batch, residents: [{ name: 'Grace' }] }
            ]);

            await repositoriesOf().households.updateAll({ name: batch }, { residents: [{ name: 'Linus' }] });

            const firstResidents: Resident[] = await repositoriesOf().residents.findAll({ where: { householdId: first?.id } });
            const secondResidents: Resident[] = await repositoriesOf().residents.findAll({ where: { householdId: second?.id } });
            expect(firstResidents.map(r => r.name)).toEqual(['Linus']);
            expect(secondResidents.map(r => r.name)).toEqual(['Linus']);
            expect(firstResidents[0]?.id).not.toBe(secondResidents[0]?.id);
        });

        it('refuses an update giving a row by its id to more rows than one', async () => {
            const batch: string = `batch-${UUIDUtilities.generate()}`;
            const [first] = await repositoriesOf().households.createAll([
                { name: batch, residents: [{ name: 'Ada' }] },
                { name: batch }
            ]);
            const [ada] = first?.residents ?? [];

            await expect(repositoriesOf().households.updateAll({ name: batch }, { residents: [{ id: ada?.id }] })).rejects.toThrow();

            expect((await repositoriesOf().residents.findById(ada?.id ?? '')).householdId).toBe(first?.id);
        });

        it('leaves the rows of a relation alone that the data does not name', async () => {
            const household: Household = await repositoriesOf().households.create({
                name: 'untouched',
                residents: [{ name: 'Ada' }],
                doorplate: { text: 'No. 1' }
            });

            await repositoriesOf().households.updateById(household.id, { name: 'renamed' });

            expect(await repositoriesOf().residents.count({ where: { householdId: household.id } })).toBe(1);
            expect(await repositoriesOf().doorplates.count({ where: { householdId: household.id } })).toBe(1);
        });

        it('replaces the row of a has one relation, deleting the one before it', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'replaced', doorplate: { text: 'No. 1' } });
            const before: string | undefined = household.doorplate?.id;

            await repositoriesOf().households.updateById(household.id, { doorplate: { text: 'No. 2' } });

            const doorplates: Doorplate[] = await repositoriesOf().doorplates.findAll({ where: { householdId: household.id } });
            expect(doorplates.map(d => d.text)).toEqual(['No. 2']);
            expect(await repositoriesOf().doorplates.count({ where: { id: before } })).toBe(0);
        });

        it('deletes the rows of its to many and has one relations along with a row, two levels down', async () => {
            const household: Household = await repositoriesOf().households.create({
                name: 'deleted',
                residents: [{ name: 'Ada', chores: [{ title: 'dishes' }] }],
                doorplate: { text: 'No. 1' }
            });
            const ada: Resident | undefined = household.residents[0];

            await repositoriesOf().households.deleteById(household.id);

            expect(await repositoriesOf().residents.count({ where: { householdId: household.id } })).toBe(0);
            expect(await repositoriesOf().chores.count({ where: { residentId: ada?.id } })).toBe(0);
            expect(await repositoriesOf().doorplates.count({ where: { householdId: household.id } })).toBe(0);
        });

        it('refuses to link a row the caller may not see, and writes nothing of the save', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'scoped' });
            const strangers: Pet = await repositoriesOf().pets.create({ name: 'Rex', keeper: 'someone else' });
            actingKeeper = 'me';

            await expect(repositoriesOf().households.updateById(household.id, { name: 'renamed', pets: [{ id: strangers.id }] }))
                .rejects
                .toThrow(NotFoundError);

            actingKeeper = undefined;
            expect((await repositoriesOf().households.findById(household.id)).name).toBe('scoped');
            expect((await repositoriesOf().pets.findById(strangers.id)).householdId == undefined).toBe(true);
        });

        it('records the change sets of a row created along with its owner', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'recorded', guests: [{ name: 'Ada' }] });
            const [ada] = household.guests;

            expect(await repositoriesOf().changeSets.count({ where: { changeSetEntityId: ada?.id } })).toBe(1);
        });

        it('records the change set of a row updated along with its owner', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'renamed guest', guests: [{ name: 'Ada' }] });
            const [ada] = household.guests;

            await repositoriesOf().households.updateById(household.id, { guests: [{ id: ada?.id, name: 'Ada L.' }] });

            const changeSets: ChangeSet[] = await repositoriesOf().changeSets.findAll({ where: { changeSetEntityId: ada?.id } });
            expect(changeSets.map(c => c.type)).toEqual([ChangeSetType.CREATE, ChangeSetType.UPDATE]);
            expect(changeSets[1]?.changes.map(c => [c.key, c.previousValue, c.newValue])).toEqual([['name', 'Ada', 'Ada L.']]);
        });

        it('soft deletes a row left out of a relation whose entity soft deletes', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'soft', guests: [{ name: 'Ada' }] });
            const [ada] = household.guests;

            await repositoriesOf().households.updateById(household.id, { guests: [] });

            expect(await repositoriesOf().guests.count({ where: { householdId: household.id } })).toBe(0);
            const marked: Guest = await repositoriesOf().guests.findById(ada?.id ?? '', { deleted: 'include' });
            expect(marked.deleted).toBe(true);
        });

        it('deletes the rows of an entity that soft deletes for good along with their owner', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'gone', guests: [{ name: 'Ada' }] });

            await repositoriesOf().households.deleteById(household.id);

            expect(await repositoriesOf().guests.count({ where: { householdId: household.id }, deleted: 'include' })).toBe(0);
        });

        it('soft deletes the rows of its relations along with a row that soft deletes, and theirs in turn', async () => {
            const trip: Trip = await repositoriesOf().trips.create({ name: 'soft', stops: [{ name: 'Rome', tickets: [{ seat: '1A' }] }] });
            const [rome] = trip.stops;

            await repositoriesOf().trips.deleteById(trip.id);

            expect(await repositoriesOf().stops.count({ where: { tripId: trip.id } })).toBe(0);
            expect(await repositoriesOf().stops.count({ where: { tripId: trip.id }, deleted: 'only' })).toBe(1);
            expect(await repositoriesOf().tickets.count({ where: { stopId: rome?.id }, deleted: 'only' })).toBe(1);
        });

        it('restores the rows deleted along with a row, and not the ones deleted on their own before', async () => {
            const trip: Trip = await repositoriesOf().trips.create({
                name: 'restored',
                stops: [{ name: 'Rome', tickets: [{ seat: '1A' }] }, { name: 'Paris' }]
            });
            const rome: Stop | undefined = trip.stops.find(s => s.name === 'Rome');
            const paris: Stop | undefined = trip.stops.find(s => s.name === 'Paris');
            await repositoriesOf().stops.deleteById(paris?.id ?? '');
            await repositoriesOf().trips.deleteById(trip.id);

            await repositoriesOf().trips.updateById(trip.id, { deleted: false }, { deleted: 'only' });

            const stops: Stop[] = await repositoriesOf().stops.findAll({ where: { tripId: trip.id } });
            expect(stops.map(s => s.name)).toEqual(['Rome']);
            expect(await repositoriesOf().tickets.count({ where: { stopId: rome?.id } })).toBe(1);
            expect(await repositoriesOf().stops.count({ where: { id: paris?.id }, deleted: 'only' })).toBe(1);
        });

        it('deletes the rows of its relations for good along with a row that soft deletes, when it is hard deleted', async () => {
            const trip: Trip = await repositoriesOf().trips.create({ name: 'hard', stops: [{ name: 'Rome', tickets: [{ seat: '1A' }] }] });
            const [rome] = trip.stops;

            await repositoriesOf().trips.deleteById(trip.id, { hardDelete: true });

            expect(await repositoriesOf().stops.count({ where: { tripId: trip.id }, deleted: 'include' })).toBe(0);
            expect(await repositoriesOf().tickets.count({ where: { stopId: rome?.id }, deleted: 'include' })).toBe(0);
        });

        it('refuses to delete a row that rows of a relation not removing them point at, and deletes nothing', async () => {
            const household: Household = await repositoriesOf().households.create({
                name: 'kept',
                residents: [{ name: 'Ada' }],
                pets: [{ name: 'Rex' }]
            });

            await expect(repositoriesOf().households.deleteById(household.id)).rejects.toThrow(ConflictError);

            expect(await repositoriesOf().households.count({ where: { id: household.id } })).toBe(1);
            expect(await repositoriesOf().residents.count({ where: { householdId: household.id } })).toBe(1);
        });

        it('refuses to delete a row that a soft deleted row points at', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'lodged', lodgers: [{ name: 'Ada' }] });
            const [ada] = household.lodgers;
            await repositoriesOf().lodgers.deleteById(ada?.id ?? '');

            await expect(repositoriesOf().households.deleteById(household.id)).rejects.toThrow(ConflictError);
        });

        it('deletes rows that point at each other in one delete', async () => {
            const parent: Folder = await repositoriesOf().folders.create({ name: 'parent', children: [{ name: 'child' }] });
            const [child] = parent.children;

            await expect(repositoriesOf().folders.deleteById(parent.id)).rejects.toThrow(ConflictError);
            expect(await repositoriesOf().folders.deleteAll({ id: { oneOf: [parent.id, child?.id ?? ''] } })).toBe(2);
        });

        it('deletes the change sets of a row deleted for good, and keeps those of one soft deleted', async () => {
            const household: Household = await repositoriesOf().households.create({
                name: 'recorded',
                guests: [{ name: 'Ada' }, { name: 'Bob' }]
            });
            const ada: Guest | undefined = household.guests.find(g => g.name === 'Ada');
            const bob: Guest | undefined = household.guests.find(g => g.name === 'Bob');

            await repositoriesOf().guests.deleteById(ada?.id ?? '', { hardDelete: true });
            await repositoriesOf().guests.deleteById(bob?.id ?? '');

            expect(await repositoriesOf().changeSets.count({ where: { changeSetEntityId: ada?.id } })).toBe(0);
            expect(await repositoriesOf().changeSets.count({ where: { changeSetEntityId: bob?.id } })).toBeGreaterThan(0);
        });

        it('deletes the change sets of the rows deleted along with their owner', async () => {
            const household: Household = await repositoriesOf().households.create({ name: 'gone', guests: [{ name: 'Ada' }] });
            const [ada] = household.guests;

            await repositoriesOf().households.deleteById(household.id);

            expect(await repositoriesOf().changeSets.count({ where: { changeSetEntityId: ada?.id } })).toBe(0);
        });
    });
}