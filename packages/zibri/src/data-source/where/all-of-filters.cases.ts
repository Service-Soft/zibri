import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about a filter key that names several values. A
 * file per data source runs them against a repository of its own.
 */

/**
 * What a note carries beside its own columns, stored as one json value.
 */
export class NoteMeta {
    /**
     * What the note is filed under.
     */
    @Property.string()
    label!: string;
}

/**
 * A note, which is filtered by its title, when it was written and what it is filed under.
 */
@Entity({ allowOrphan: true, allowDuplicate: true })
export class Note extends BaseEntity {
    /**
     * Groups the notes of one test, so the cases do not read each other's rows.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    /**
     * What the note is called.
     */
    @Property.string()
    title!: string;

    /**
     * When it was written.
     */
    @Property.date()
    writtenAt!: Date;

    /**
     * What it carries beside its own columns.
     */
    @Property.object({ cls: () => NoteMeta })
    meta!: NoteMeta;
}

/**
 * A note as it is created, which is the entity without what the framework fills in.
 */
type NoteData = Omit<Note, keyof BaseEntity>;

const early: Date = new Date('2026-01-15T00:00:00.000Z');

const middle: Date = new Date('2026-06-15T00:00:00.000Z');

const late: Date = new Date('2026-12-15T00:00:00.000Z');

const rent2026: string = 'rent 2026';

const power2026: string = 'power 2026';

/**
 * Runs the cases against one data source.
 * @param dataSourceName - The name of the data source, for the test names.
 * @param notesOf - The repository to run them against.
 */
export function describeAllOfFilters(dataSourceName: string, notesOf: () => Repository<Note>): void {
    /**
     * Creates the given notes under a batch of their own.
     * @param data - The notes, without their batch.
     * @returns The batch they were created under.
     */
    async function createBatch(...data: Omit<NoteData, 'batch'>[]): Promise<string> {
        const batch: string = UUIDUtilities.generate();
        for (const note of data) {
            await notesOf().create({ ...note, batch });
        }
        return batch;
    }

    describe(`a filter key that names several values, on ${dataSourceName}`, () => {
        it('requires every pattern of a like', async () => {
            const batch: string = await createBatch(
                { title: rent2026, writtenAt: middle, meta: { label: rent2026 } },
                { title: 'rent 2025', writtenAt: middle, meta: { label: 'rent 2025' } },
                { title: power2026, writtenAt: middle, meta: { label: power2026 } }
            );

            const found: Note[] = await notesOf().findAll({ where: { batch, title: { like: ['rent%', '%2026'] } } });

            expect(found.map(n => n.title)).toEqual([rent2026]);
        });

        it('requires every pattern of an iLike', async () => {
            const batch: string = await createBatch(
                { title: 'Rent 2026', writtenAt: middle, meta: { label: 'Rent 2026' } },
                { title: 'Rent 2025', writtenAt: middle, meta: { label: 'Rent 2025' } }
            );

            const found: Note[] = await notesOf().findAll({ where: { batch, title: { iLike: ['rent%', '%2026'] } } });

            expect(found.map(n => n.title)).toEqual(['Rent 2026']);
        });

        it('requires every search of a fuzzyLike', async () => {
            const batch: string = await createBatch(
                { title: 'invoice', writtenAt: middle, meta: { label: 'invoice' } },
                { title: 'reminder', writtenAt: middle, meta: { label: 'reminder' } }
            );

            const found: Note[] = await notesOf().findAll({
                // eslint-disable-next-line cspell/spellchecker
                where: { batch, title: { fuzzyLike: [{ value: 'invoce' }, { value: 'invoice' }] } }
            });

            expect(found.map(n => n.title)).toEqual(['invoice']);
        });

        // the application orders text, and every data source is held to that order - on postgres by
        // the collation its text columns are created with. 'B' is the lower byte and the later
        // letter, so a store ordering what it holds rather than what it means answers the other way
        it('orders text alphabetically rather than by the bytes it is written with', async () => {
            const batch: string = await createBatch(
                { title: 'alpha', writtenAt: middle, meta: { label: 'alpha' } },
                { title: 'Bravo', writtenAt: middle, meta: { label: 'Bravo' } },
                { title: 'charlie', writtenAt: middle, meta: { label: 'charlie' } }
            );

            const ordered: Note[] = await notesOf().findAll({ where: { batch }, order: { title: 'ASC' } });
            expect(ordered.map(n => n.title)).toEqual(['alpha', 'Bravo', 'charlie']);

            const after: Note[] = await notesOf().findAll({ where: { batch, title: { after: 'alpha' } } });
            expect(after.map(n => n.title).sort()).toEqual(['Bravo', 'charlie']);
        });

        it('compares a date against the bound it is given', async () => {
            const batch: string = await createBatch(
                { title: 'early', writtenAt: early, meta: { label: 'early' } },
                { title: 'middle', writtenAt: middle, meta: { label: 'middle' } },
                { title: 'late', writtenAt: late, meta: { label: 'late' } }
            );

            const found: Note[] = await notesOf().findAll({ where: { batch, writtenAt: { after: middle } } });

            expect(found.map(n => n.title)).toEqual(['late']);
        });

        it('requires every pattern inside a stored object as well', async () => {
            const batch: string = await createBatch(
                { title: 'a', writtenAt: middle, meta: { label: rent2026 } },
                { title: 'b', writtenAt: middle, meta: { label: 'rent 2025' } }
            );

            const found: Note[] = await notesOf().findAll({
                where: { batch, meta: { where: { label: { like: ['rent%', '%2026'] } } } }
            });

            expect(found.map(n => n.title)).toEqual(['a']);
        });

        it('reads a single value under the same key the way it always did', async () => {
            const batch: string = await createBatch(
                { title: rent2026, writtenAt: middle, meta: { label: rent2026 } },
                { title: power2026, writtenAt: middle, meta: { label: power2026 } }
            );

            const found: Note[] = await notesOf().findAll({ where: { batch, title: { like: 'rent%' } } });

            expect(found.map(n => n.title)).toEqual([rent2026]);
        });
    });
}