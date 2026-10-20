import { describe, expect, it } from 'vitest';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { type Relation } from '../../entity/models/relation.type.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { FindAllOptions } from '../models/options/find-all-options.model.ts';
import { Repository } from '../repository/repository.ts';

/**
 * The cases every data source answers the same way about a relation of a relation - both reading one
 * and ordering by one. A file per data source runs them against repositories of its own.
 */

/**
 * The album whose title comes first, and whose artist comes last.
 */
const NOCTURNES: string = 'Nocturnes';

/**
 * The album whose title comes last, and whose artist comes first.
 */
const PRELUDES: string = 'Preludes';

/**
 * The track on {@link NOCTURNES}, which every nested case reads.
 */
const FROM_NOCTURNES: string = `from ${NOCTURNES}`;

/**
 * The track on {@link PRELUDES}, which is what makes the two orders disagree.
 */
const FROM_PRELUDES: string = `from ${PRELUDES}`;

/**
 * The far end of the chain, two relations away from a track.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Artist extends BaseEntity {
    /**
     * What decides the order of the cases that sort two relations down.
     */
    @Property.string()
    name!: string;

    /**
     * The albums of the artist, which is the to many side of the same relation an album names.
     */
    @Property.oneToMany({ target: () => Album, inverseSide: 'artist' })
    albums!: Album[];
}

/**
 * The middle of the chain: a track reaches it directly, an artist through it.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Album extends BaseEntity {
    /**
     * What decides the order of the cases that sort one relation down.
     */
    @Property.string()
    title!: string;

    /**
     * The artist it belongs to, which is the second level of every nested case.
     */
    @Property.manyToOne({ target: () => Artist, joinColumn: 'artistId', inverseSide: 'albums', required: false })
    artist?: Relation<Artist>;

    /**
     * The key that relation is stored as.
     */
    @Property.string({ format: 'uuid', required: false })
    artistId?: string;

    /**
     * The tracks on it, so that a to many relation can be asked for below a to one relation.
     */
    @Property.oneToMany({ target: () => Track, inverseSide: 'album' })
    tracks!: Track[];
}

/**
 * Where every case starts, so that each one reads from the near end of the chain.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Track extends BaseEntity {
    /**
     * The rows one test wrote, so that what a filter finds is not mixed up with another test's rows.
     */
    @Property.string()
    batch!: string;

    /**
     * What it is called, which is what the ordered cases read back.
     */
    @Property.string()
    title!: string;

    /**
     * The album it is on, which is the first level of every nested case.
     */
    @Property.manyToOne({ target: () => Album, joinColumn: 'albumId', inverseSide: 'tracks', required: false })
    album?: Relation<Album>;

    /**
     * The key that relation is stored as.
     */
    @Property.string({ format: 'uuid', required: false })
    albumId?: string;
}

/**
 * Runs every case against the catalog of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param artistsOf - Reads the artist repository, once the data source is started.
 * @param albumsOf - Reads the album repository, once the data source is started.
 * @param tracksOf - Reads the track repository, once the data source is started.
 */
export function describeNestedRelations(
    dataSourceName: string,
    artistsOf: () => Repository<Artist>,
    albumsOf: () => Repository<Album>,
    tracksOf: () => Repository<Track>
): void {

    /**
     * Writes one catalog of two artists, an album each and a track each.
     *
     * The two orderings it can be read in disagree on purpose: by album title it is Nocturnes before
     * Preludes, and by artist name it is Ada before Zoe, which puts the albums the other way round.
     * A sort that only ever reaches the first level answers both the same way, so the disagreement is
     * what tells the two levels apart.
     * @returns The batch the tracks were written under, which is what isolates them.
     */
    async function seedCatalog(): Promise<string> {
        const batch: string = UUIDUtilities.generate();
        const zoe: Artist = await artistsOf().create({ name: 'Zoe' });
        const ada: Artist = await artistsOf().create({ name: 'Ada' });
        const nocturnes: Album = await albumsOf().create({ title: NOCTURNES, artistId: zoe.id });
        const preludes: Album = await albumsOf().create({ title: PRELUDES, artistId: ada.id });
        await tracksOf().createAll([
            { batch, title: FROM_NOCTURNES, albumId: nocturnes.id },
            { batch, title: FROM_PRELUDES, albumId: preludes.id }
        ]);
        return batch;
    }

    /**
     * Reads one track of a batch, so that the nested cases have a single row to look at.
     * @param batch - The batch to read from.
     * @param relations - The relations to resolve on it.
     * @returns The track of that batch whose title comes first.
     */
    async function readOneTrack(batch: string, relations: FindAllOptions<Track>['relations']): Promise<Track> {
        return await tracksOf().findOne({ where: { batch, title: FROM_NOCTURNES }, relations });
    }

    describe(`a relation of a relation, on ${dataSourceName}`, () => {
        it('resolves a relation of a relation', async () => {
            const batch: string = await seedCatalog();

            const track: Track = await readOneTrack(batch, { album: { artist: true } });

            expect(track.album?.title).toBe(NOCTURNES);
            expect(track.album?.artist?.name).toBe('Zoe');
        });

        it('resolves nothing below the level that was asked for', async () => {
            const batch: string = await seedCatalog();

            const track: Track = await readOneTrack(batch, { album: true });

            // asking for a relation is asking for one read, and the rows beside the ones it names are
            // no more part of it than the rows beside the entity itself are
            expect(track.album?.title).toBe(NOCTURNES);
            expect(track.album?.artist).toBeUndefined();
        });

        it('resolves a to many relation below a to one relation', async () => {
            const batch: string = await seedCatalog();

            const track: Track = await readOneTrack(batch, { album: { tracks: true } });

            expect(track.album?.tracks.map(t => t.title)).toEqual([FROM_NOCTURNES]);
        });

        it('orders by a property of a relation', async () => {
            const batch: string = await seedCatalog();

            const tracks: Track[] = await tracksOf().findAll({
                where: { batch },
                relations: { album: true },
                order: { album: { title: 'ASC' } },
                take: 'all'
            });

            expect(tracks.map(t => t.title)).toEqual([FROM_NOCTURNES, FROM_PRELUDES]);
        });

        it('orders by a property two relations down', async () => {
            const batch: string = await seedCatalog();

            const tracks: Track[] = await tracksOf().findAll({
                where: { batch },
                relations: { album: { artist: true } },
                order: { album: { artist: { name: 'ASC' } } },
                take: 'all'
            });

            // the opposite of the album title order, which is the whole point of the two disagreeing
            expect(tracks.map(t => t.title)).toEqual([FROM_PRELUDES, FROM_NOCTURNES]);
        });

        it('does not hand back a relation only the order named', async () => {
            const batch: string = await seedCatalog();

            const tracks: Track[] = await tracksOf().findAll({
                where: { batch },
                order: { album: { title: 'DESC' } },
                take: 'all'
            });

            // ordering by a relation reads it, because there is no other way to compare by it - but
            // what comes back is what was asked for, and nothing here asked for the album
            expect(tracks.map(t => t.title)).toEqual([FROM_PRELUDES, FROM_NOCTURNES]);
            expect(tracks.map(t => t.album)).toEqual([undefined, undefined]);
        });

        it('does not hand back a relation only the filter named', async () => {
            const batch: string = await seedCatalog();

            const tracks: Track[] = await tracksOf().findAll({
                where: { batch, album: { where: { title: NOCTURNES } } },
                take: 'all'
            });

            // the same rule as the order: a relation is read because the filter cannot be answered
            // without it, and read is not the same as asked for
            expect(tracks.map(t => t.title)).toEqual([FROM_NOCTURNES]);
            expect(tracks.map(t => t.album)).toEqual([undefined]);
        });

        it('filters by either of two conditions on a relation, and one two relations down', async () => {
            const batch: string = await seedCatalog();

            // an or inside the relation's filter, beside a condition of the row's own that holds for
            // both. A store that ors only at the top level read the array as an object of indexes
            const either: Track[] = await tracksOf().findAll({
                where: { batch, album: { where: [{ title: NOCTURNES }, { title: PRELUDES }] } },
                order: { title: 'ASC' },
                take: 'all'
            });
            const byArtist: Track[] = await tracksOf().findAll({
                where: { batch, album: { where: { artist: { where: [{ name: 'Ada' }, { name: 'nobody' }] } } } },
                take: 'all'
            });

            expect(either.map(t => t.title)).toEqual([FROM_NOCTURNES, FROM_PRELUDES]);
            expect(byArtist.map(t => t.title)).toEqual([FROM_PRELUDES]);
        });

        it('orders by a relation before a column of its own', async () => {
            const batch: string = UUIDUtilities.generate();
            const album: Album = await albumsOf().create({ title: NOCTURNES });
            await tracksOf().createAll([
                { batch, title: 'second', albumId: album.id },
                { batch, title: 'first', albumId: album.id }
            ]);

            const tracks: Track[] = await tracksOf().findAll({
                where: { batch },
                order: { album: { title: 'ASC' }, title: 'ASC' },
                take: 'all'
            });

            // one album, so the first key decides nothing and the second decides everything
            expect(tracks.map(t => t.title)).toEqual(['first', 'second']);
        });
    });
}