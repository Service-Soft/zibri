/* eslint-disable jsdoc-js/require-jsdoc */
import { describe, expect, it } from 'vitest';

import { type Relation } from '../../entity/models/relation.type.ts';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { Repository } from '../repository/repository.ts';

/**
 * The cases every data source answers the same way about filtering by the items of an array or the
 * rows of a relation: which items are allowed, which are required, and how many there are. A file per
 * data source runs them against repositories of its own.
 */

export class Credit {
    @Property.string()
    role!: string;

    @Property.string()
    name!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Playlist extends BaseEntity {
    /**
     * The rows one test wrote, so that what a filter finds is not mixed up with another test's rows.
     */
    @Property.string()
    batch!: string;

    @Property.string()
    name!: string;

    @Property.array({ items: { type: 'string' }, required: false })
    moods?: string[] | null;

    @Property.array({ items: { type: 'object', cls: () => Credit }, required: false })
    credits?: Credit[] | null;

    @Property.oneToMany({ target: () => Track, inverseSide: 'playlist' })
    tracks!: Track[];

    @Property.manyToMany({ target: () => Genre, inverseSide: 'playlists', joinTable: true })
    genres!: Genre[];
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Track extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.manyToOne({ target: () => Playlist, joinColumn: 'playlistId', inverseSide: 'tracks' })
    playlist!: Relation<Playlist>;

    @Property.string({ format: 'uuid', required: false })
    playlistId?: string;
}

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Genre extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.manyToMany({ target: () => Playlist, inverseSide: 'genres', joinTable: false })
    playlists!: Playlist[];
}

/**
 * The data a playlist is created from, with the rows of its relations.
 */
type PlaylistCreateData = {
    batch: string,
    name: string,
    moods?: string[] | null,
    credits?: Credit[] | null,
    tracks?: { title: string }[],
    genres?: Genre[]
};

/**
 * The data a genre is created from.
 */
type GenreCreateData = {
    name: string
};

/**
 * The repositories the cases run against.
 */
export type RelationAllowListRepositories = {
    /**
     * The playlists, which the cases filter.
     */
    playlists: Repository<Playlist, PlaylistCreateData>,
    /**
     * The genres, which a playlist names through a join table.
     */
    genres: Repository<Genre, GenreCreateData>
};

const ann: Credit = { role: 'vocals', name: 'ann' };

const ben: Credit = { role: 'drums', name: 'ben' };

const carl: Credit = { role: 'bass', name: 'carl' };

/**
 * The names of the given playlists, sorted, so that a filter's answer can be compared without an order.
 * @param playlists - The playlists.
 * @returns Their names.
 */
function namesOf(playlists: Playlist[]): string[] {
    return playlists.map(p => p.name).sort();
}

/**
 * Runs every case against the repositories of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoriesOf - Reads the repositories, once the data source is started.
 */
export function describeRelationAllowList(dataSourceName: string, repositoriesOf: () => RelationAllowListRepositories): void {
    /**
     * Creates a playlist whose arrays hold allowed items only, one whose arrays also hold one that is
     * not, one whose arrays are empty and one without arrays.
     * @returns Their batch.
     */
    async function createArrayPlaylists(): Promise<string> {
        const batch: string = UUIDUtilities.generate();
        await repositoriesOf().playlists.create({ batch, name: 'within', moods: ['calm'], credits: [ann] });
        await repositoriesOf().playlists.create({ batch, name: 'mixed', moods: ['calm', 'loud'], credits: [ann, ben] });
        await repositoriesOf().playlists.create({ batch, name: 'empty', moods: [], credits: [] });
        // eslint-disable-next-line unicorn/no-null
        await repositoriesOf().playlists.create({ batch, name: 'missing', moods: null, credits: null });
        return batch;
    }

    /**
     * Creates a playlist without tracks, one whose track is allowed and one with an allowed track and
     * one that is not.
     * @returns Their batch, and the allowed tracks.
     */
    async function createTrackedPlaylists(): Promise<{ batch: string, allowedTracks: Track[] }> {
        const batch: string = UUIDUtilities.generate();
        await repositoriesOf().playlists.create({ batch, name: 'empty' });
        const allowed: Playlist = await repositoriesOf().playlists.create({ batch, name: 'allowed', tracks: [{ title: 'A' }] });
        const mixed: Playlist = await repositoriesOf().playlists.create({ batch, name: 'mixed', tracks: [{ title: 'M' }, { title: 'B' }] });
        const allowedTracks: Track[] = [...allowed.tracks, ...mixed.tracks.filter(t => t.title === 'M')];
        return { batch, allowedTracks };
    }

    describe(`filtering by the items an array may hold, on ${dataSourceName}`, () => {
        it('finds the rows whose array holds allowed items only, and no empty or missing array', async () => {
            const batch: string = await createArrayPlaylists();

            const byMoods: Playlist[] = await repositoriesOf().playlists.findAll({
                where: { batch, moods: { isIncludedIn: ['calm', 'dark'] } }
            });
            const byCredits: Playlist[] = await repositoriesOf().playlists.findAll({
                where: { batch, credits: { isIncludedIn: [ann, carl] } }
            });

            expect(namesOf(byMoods)).toEqual(['within']);
            expect(namesOf(byCredits)).toEqual(['within']);
        });

        it('finds nothing when nothing is allowed', async () => {
            const batch: string = await createArrayPlaylists();

            const byMoods: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, moods: { isIncludedIn: [] } } });
            const byCredits: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, credits: { isIncludedIn: [] } } });

            expect(namesOf(byMoods)).toEqual([]);
            expect(namesOf(byCredits)).toEqual([]);
        });

        it('finds an empty array by its length alone, and a missing one by null alone', async () => {
            const batch: string = await createArrayPlaylists();

            const emptyMoods: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, moods: { length: 0 } } });
            // eslint-disable-next-line unicorn/no-null
            const missingMoods: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, moods: null } });
            const emptyCredits: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, credits: { length: 0 } } });
            // eslint-disable-next-line unicorn/no-null
            const missingCredits: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, credits: null } });

            expect(namesOf(emptyMoods)).toEqual(['empty']);
            expect(namesOf(missingMoods)).toEqual(['missing']);
            expect(namesOf(emptyCredits)).toEqual(['empty']);
            expect(namesOf(missingCredits)).toEqual(['missing']);
        });

        it('passes over a missing array whatever length or items are asked for', async () => {
            const batch: string = await createArrayPlaylists();

            const shortMoods: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, moods: { lengthLesserThan: 2 } } });
            const anyMoods: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, moods: { includes: [] } } });
            const shortCredits: Playlist[] = await repositoriesOf().playlists.findAll({
                where: { batch, credits: { lengthLesserThan: 2 } }
            });
            const anyCredits: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, credits: { includes: [] } } });

            expect(namesOf(shortMoods)).toEqual(['empty', 'within']);
            expect(namesOf(anyMoods)).toEqual(['empty', 'mixed', 'within']);
            expect(namesOf(shortCredits)).toEqual(['empty', 'within']);
            expect(namesOf(anyCredits)).toEqual(['empty', 'mixed', 'within']);
        });

        it('finds an empty array beside the allowed ones when both are asked for', async () => {
            const batch: string = await createArrayPlaylists();

            const found: Playlist[] = await repositoriesOf().playlists.findAll({
                where: [{ batch, moods: { isIncludedIn: ['calm'] } }, { batch, credits: { length: 0 } }]
            });

            expect(namesOf(found)).toEqual(['empty', 'within']);
        });
    });

    describe(`filtering by the related rows a row may have, on ${dataSourceName}`, () => {
        it('finds the rows whose related rows are all allowed, and no row without related rows', async () => {
            const { batch, allowedTracks } = await createTrackedPlaylists();

            const found: Playlist[] = await repositoriesOf().playlists.findAll({
                where: { batch, tracks: { isIncludedIn: allowedTracks } }
            });

            expect(namesOf(found)).toEqual(['allowed']);
        });

        it('finds nothing when nothing is allowed', async () => {
            const { batch } = await createTrackedPlaylists();

            const found: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, tracks: { isIncludedIn: [] } } });

            expect(namesOf(found)).toEqual([]);
        });

        it('finds nothing through a join table when nothing is allowed', async () => {
            const batch: string = UUIDUtilities.generate();
            const jazz: Genre = await repositoriesOf().genres.create({ name: 'jazz' });
            await repositoriesOf().playlists.create({ batch, name: 'empty' });
            await repositoriesOf().playlists.create({ batch, name: 'jazz', genres: [jazz] });

            const allowingJazz: Playlist[] = await repositoriesOf().playlists.findAll({
                where: { batch, genres: { isIncludedIn: [jazz] } }
            });
            const allowingNothing: Playlist[] = await repositoriesOf().playlists.findAll({
                where: { batch, genres: { isIncludedIn: [] } }
            });

            expect(namesOf(allowingJazz)).toEqual(['jazz']);
            expect(namesOf(allowingNothing)).toEqual([]);
        });

        it('answers an allow list of rows nothing could be stored as like one that allows nothing', async () => {
            const { batch } = await createTrackedPlaylists();
            const ghost: Track = Object.assign(new Track(), { id: 'not-a-uuid', title: 'ghost' });

            const found: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, tracks: { isIncludedIn: [ghost] } } });

            expect(namesOf(found)).toEqual([]);
        });

        it('finds a row without related rows by its length, alone or beside the allowed ones', async () => {
            const { batch, allowedTracks } = await createTrackedPlaylists();

            const withoutTracks: Playlist[] = await repositoriesOf().playlists.findAll({ where: { batch, tracks: { length: 0 } } });
            const allowedOrWithout: Playlist[] = await repositoriesOf().playlists.findAll({
                where: [{ batch, tracks: { isIncludedIn: allowedTracks } }, { batch, tracks: { length: 0 } }]
            });

            expect(namesOf(withoutTracks)).toEqual(['empty']);
            expect(namesOf(allowedOrWithout)).toEqual(['allowed', 'empty']);
        });
    });
}