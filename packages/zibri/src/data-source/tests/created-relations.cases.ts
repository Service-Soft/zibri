/* eslint-disable jsdoc/require-jsdoc */
import { describe, expect, it } from '@jest/globals';
import { type Relation } from 'typeorm';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * The cases every data source answers the same way about what creating a row hands back of the rows
 * created along with it. A file per data source runs them against repositories of its own.
 */

@Entity({ allowOrphan: true, allowDuplicate: true })
export class Shelf extends BaseEntity {
    @Property.string()
    label!: string;

    @Property.oneToMany({ target: () => Book, inverseSide: 'shelf' })
    books!: Book[];

    @Property.hasOne({ target: () => Plaque, inverseSide: 'shelf' })
    plaque?: Relation<Plaque>;
}

@Entity({ allowOrphan: true, allowDuplicate: true })
export class Book extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.manyToOne({ target: () => Shelf, joinColumn: 'shelfId', inverseSide: 'books' })
    shelf!: Shelf;

    @Property.string({ format: 'uuid', required: false })
    shelfId?: string;
}

@Entity({ allowOrphan: true, allowDuplicate: true })
export class Plaque extends BaseEntity {
    @Property.string()
    text!: string;

    @Property.belongsToOne({ target: () => Shelf, joinColumn: 'shelfId', inverseSide: 'plaque' })
    shelf!: Shelf;

    @Property.string({ format: 'uuid', required: false })
    shelfId?: string;
}

/**
 * The data a shelf is created from, with the rows created along with it.
 */
type ShelfCreateData = {
    label: string,
    books?: { title: string }[],
    plaque?: { text: string }
};

/**
 * Runs every case against the shelves of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param shelvesOf - Reads the repository, once the data source is started.
 */
export function describeCreatedRelations(dataSourceName: string, shelvesOf: () => Repository<Shelf, ShelfCreateData>): void {
    describe(`what creating a row hands back of the rows created with it, on ${dataSourceName}`, () => {
        it('hands back the rows of a to many relation as they were stored', async () => {
            const created: Shelf = await shelvesOf().create({ label: 'fiction', books: [{ title: 'Emma' }, { title: 'Dracula' }] });

            expect(created.books.map(b => b.title).sort()).toEqual(['Dracula', 'Emma']);
            expect(created.books.every(b => typeof b.id === 'string' && b.shelfId === created.id)).toBe(true);
        });

        it('hands back the row of a has one relation as it was stored', async () => {
            const created: Shelf = await shelvesOf().create({ label: 'poetry', plaque: { text: 'donated' } });

            expect(created.plaque).toEqual(expect.objectContaining({ text: 'donated', shelfId: created.id }));
            expect(typeof created.plaque?.id).toBe('string');
        });

        it('hands back the rows created inside a transaction, and finds them there before it commits', async () => {
            const transaction: Transaction = await shelvesOf().dataSource.startTransaction();
            try {
                const created: Shelf = await shelvesOf().create({ label: 'drafts', books: [{ title: 'Unfinished' }] }, { transaction });
                const read: Shelf = await shelvesOf().findById(created.id, { relations: ['books'], transaction });

                expect(created.books.map(b => b.title)).toEqual(['Unfinished']);
                expect(read.books.map(b => b.id)).toEqual(created.books.map(b => b.id));
            }
            finally {
                await transaction.rollback();
            }
        });

        it('hands back no relation the data did not create a row for', async () => {
            const created: Shelf = await shelvesOf().create({ label: 'empty' });

            expect(created.books).toBeUndefined();
            expect(created.plaque).toBeUndefined();
        });
    });
}