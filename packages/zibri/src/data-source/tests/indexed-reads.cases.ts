import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { DataSourceInterface, IsolationLevel } from '../data-sources/data-source.interface';
import { Where } from '../models/where/where-filter.model';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * The cases every data source answers the same way about a filter naming an index declaration: a store
 * may read only the rows the index keeps under the values the filter names, and has to find the same
 * rows as one reading the whole table, however the rows got there. A file per data source runs them.
 */

@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, indexes: [['batch', 'status']] })
export class IndexedNote extends BaseEntity {
    /**
     * Groups the notes of one case, so the cases do not read each other's rows.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    @Property.string()
    status!: string;

    @Property.string()
    label!: string;
}

/**
 * What the cases read and write through.
 */
export type IndexedReadsFixture = {
    /**
     * The repository of the notes.
     */
    repository: Repository<IndexedNote>,
    /**
     * The data source holding them, to start transactions on.
     */
    dataSource: DataSourceInterface
};

/**
 * Defines the cases for one data source.
 * @param dataSourceName - The name of the data source, for the test names.
 * @param fixtureOf - Resolves what the cases read and write through, once the server runs.
 */
export function describeIndexedReads(dataSourceName: string, fixtureOf: () => IndexedReadsFixture): void {
    async function labelsOf(where: Where<IndexedNote>, transaction?: Transaction): Promise<string[]> {
        const found: IndexedNote[] = await fixtureOf().repository.findAll({ where, transaction });
        return found.map(note => note.label).sort();
    }

    async function createNotes(batch: string, notes: Pick<IndexedNote, 'status' | 'label'>[]): Promise<IndexedNote[]> {
        return await fixtureOf().repository.createAll(notes.map(note => ({ batch, ...note })));
    }

    describe(`a filter naming an index declaration, on ${dataSourceName}`, () => {
        it('finds the rows written before and after the first read by it, and none of another batch', async () => {
            const batch: string = UUIDUtilities.generate();
            await createNotes(UUIDUtilities.generate(), [{ status: 'open', label: 'other' }]);
            await createNotes(batch, [{ status: 'open', label: 'a' }, { status: 'closed', label: 'b' }]);
            expect(await labelsOf({ batch })).toEqual(['a', 'b']);

            await createNotes(batch, [{ status: 'open', label: 'c' }]);

            expect(await labelsOf({ batch })).toEqual(['a', 'b', 'c']);
            expect(await labelsOf({ batch, status: 'open' })).toEqual(['a', 'c']);
        });

        it('finds a row under the value it was changed to, and no longer under the one it held', async () => {
            const batch: string = UUIDUtilities.generate();
            const note: IndexedNote = await fixtureOf().repository.create({ batch, status: 'open', label: 'a' });
            expect(await labelsOf({ batch, status: 'open' })).toEqual(['a']);

            await fixtureOf().repository.updateById(note.id, { status: 'closed' });

            expect(await labelsOf({ batch, status: 'open' })).toEqual([]);
            expect(await labelsOf({ batch, status: 'closed' })).toEqual(['a']);
        });

        it('finds no row that was deleted', async () => {
            const batch: string = UUIDUtilities.generate();
            const note: IndexedNote = await fixtureOf().repository.create({ batch, status: 'open', label: 'a' });
            await createNotes(batch, [{ status: 'open', label: 'b' }]);
            expect(await labelsOf({ batch })).toEqual(['a', 'b']);

            await fixtureOf().repository.deleteById(note.id);

            expect(await labelsOf({ batch })).toEqual(['b']);
        });

        it('finds what a transaction wrote inside it, and outside of it once it commits', async () => {
            const batch: string = UUIDUtilities.generate();
            const moved: IndexedNote = await fixtureOf().repository.create({ batch, status: 'open', label: 'moved' });
            const removed: IndexedNote = await fixtureOf().repository.create({ batch, status: 'open', label: 'removed' });
            expect(await labelsOf({ batch, status: 'open' })).toEqual(['moved', 'removed']);

            const transaction: Transaction = await fixtureOf().dataSource.startTransaction();
            await fixtureOf().repository.create({ batch, status: 'open', label: 'created' }, { transaction });
            await fixtureOf().repository.updateById(moved.id, { status: 'closed' }, { transaction });
            await fixtureOf().repository.deleteById(removed.id, { transaction });

            expect(await labelsOf({ batch, status: 'open' }, transaction)).toEqual(['created']);
            expect(await labelsOf({ batch, status: 'closed' }, transaction)).toEqual(['moved']);
            expect(await labelsOf({ batch, status: 'open' })).toEqual(['moved', 'removed']);

            await transaction.commit();

            expect(await labelsOf({ batch, status: 'open' })).toEqual(['created']);
            expect(await labelsOf({ batch, status: 'closed' })).toEqual(['moved']);
        });

        it('finds nothing a transaction wrote once it is rolled back', async () => {
            const batch: string = UUIDUtilities.generate();
            const note: IndexedNote = await fixtureOf().repository.create({ batch, status: 'open', label: 'a' });

            const transaction: Transaction = await fixtureOf().dataSource.startTransaction();
            await fixtureOf().repository.create({ batch, status: 'open', label: 'created' }, { transaction });
            await fixtureOf().repository.updateById(note.id, { status: 'closed' }, { transaction });
            await transaction.rollback();

            expect(await labelsOf({ batch, status: 'open' })).toEqual(['a']);
            expect(await labelsOf({ batch, status: 'closed' })).toEqual([]);
        });

        it('reads as of the first statement of a transaction reading as of one moment', async () => {
            const batch: string = UUIDUtilities.generate();
            await createNotes(batch, [{ status: 'open', label: 'a' }]);

            const transaction: Transaction = await fixtureOf().dataSource
                .startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
            try {
                expect(await labelsOf({ batch, status: 'open' }, transaction)).toEqual(['a']);
                await createNotes(batch, [{ status: 'open', label: 'later' }]);

                expect(await labelsOf({ batch, status: 'open' }, transaction)).toEqual(['a']);
                expect(await labelsOf({ batch, status: 'open' })).toEqual(['a', 'later']);
            }
            finally {
                await transaction.rollback();
            }
        });

        it('finds the rows of several branches, and of a list of values or a condition on an indexed property', async () => {
            const batch: string = UUIDUtilities.generate();
            await createNotes(batch, [
                { status: 'open', label: 'a' },
                { status: 'closed', label: 'b' },
                { status: 'archived', label: 'c' }
            ]);

            expect(await labelsOf([{ batch, status: 'open' }, { batch, status: 'archived' }])).toEqual(['a', 'c']);
            expect(await labelsOf({ batch, status: { oneOf: ['open', 'closed'] } })).toEqual(['a', 'b']);
            expect(await labelsOf({ batch, status: { not: 'open' } })).toEqual(['b', 'c']);
            // a branch naming no index makes the whole filter one an index cannot answer
            expect(await labelsOf([{ batch, status: 'open' }, { label: 'c', batch }])).toEqual(['a', 'c']);
        });

        it('compares the values exactly', async () => {
            const batch: string = UUIDUtilities.generate();
            await createNotes(batch, [{ status: 'Open', label: 'a' }, { status: 'open ', label: 'b' }, { status: 'open:x', label: 'c' }]);

            expect(await labelsOf({ batch, status: 'open' })).toEqual([]);
            expect(await labelsOf({ batch, status: 'Open' })).toEqual(['a']);
            expect(await labelsOf({ batch, status: 'open:x' })).toEqual(['c']);
        });
    });
}