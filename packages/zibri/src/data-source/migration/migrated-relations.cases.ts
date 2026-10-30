import { describe, expect, it } from '@jest/globals';

import { Migration } from './migration.model';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Transaction } from '../transaction/transaction.model';

/**
 * An author of the books.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'related_author' })
export class RelatedAuthor extends BaseEntity {
    /**
     * Their name.
     */
    @Property.string()
    name!: string;

    /**
     * The books they wrote.
     */
    @Property.oneToMany({ target: () => RelatedBook, inverseSide: 'author' })
    books!: RelatedBook[];
}

/**
 * A book, written by one author, in any number of genres.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'related_book' })
export class RelatedBook extends BaseEntity {
    /**
     * Its title.
     */
    @Property.string()
    title!: string;

    /**
     * The author.
     */
    @Property.manyToOne({ target: () => RelatedAuthor, joinColumn: 'authorId', inverseSide: 'books' })
    author!: RelatedAuthor;

    /**
     * The key the author is stored as.
     */
    @Property.string({ format: 'uuid' })
    authorId!: string;

    /**
     * Its genres, a relation the book owns.
     */
    @Property.manyToMany({ target: () => RelatedGenre, inverseSide: 'books', joinTable: true })
    genres!: RelatedGenre[];
}

/**
 * A genre of the books.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, tableName: 'related_genre' })
export class RelatedGenre extends BaseEntity {
    /**
     * Its name.
     */
    @Property.string()
    name!: string;

    /**
     * The books in it.
     */
    @Property.manyToMany({ target: () => RelatedBook, inverseSide: 'genres', joinTable: false })
    books!: RelatedBook[];
}

/**
 * The entities the cases store.
 */
export const relatedEntities: Newable<BaseEntity>[] = [RelatedAuthor, RelatedBook, RelatedGenre];

/**
 * Builds the migration creating the tables of the entities, written out the way a generated one
 * writes them: by their table names, with their columns and none of their relations.
 * @param dataSourceClass - The data source it belongs to.
 * @returns The migration.
 */
export function createRelatedTablesMigration(dataSourceClass: Newable<DataSourceInterface>): Newable<Migration> {
    /**
     * Creates the tables of the authors, books and genres.
     */
    @Injectable()
    class CreateRelatedTablesMigration extends Migration {
        /**
         * The version of the application that ships it.
         */
        version: SemVerVersion = '0.0.1';

        constructor() {
            super(dataSourceClass);
        }

        override async up(transaction: Transaction): Promise<void> {
            await this.dataSource.createEntity({
                entity: { tableName: 'related_author' },
                properties: { name: { type: 'string' } },
                transaction
            });
            await this.dataSource.createEntity({
                entity: { tableName: 'related_book' },
                properties: { title: { type: 'string' }, authorId: { type: 'string', format: 'uuid' } },
                transaction
            });
            await this.dataSource.createEntity({
                entity: { tableName: 'related_genre' },
                properties: { name: { type: 'string' } },
                transaction
            });
        }

        override async down(transaction: Transaction): Promise<void> {
            for (const tableName of ['related_genre', 'related_book', 'related_author']) {
                await this.dataSource.removeEntity({ entity: { tableName }, transaction });
            }
        }
    }
    return CreateRelatedTablesMigration;
}

/**
 * Builds the migration removing what the books' genres hold, which the entities go on declaring.
 * @param dataSourceClass - The data source it belongs to.
 * @returns The migration.
 */
export function createRemoveGenresMigration(dataSourceClass: Newable<DataSourceInterface>): Newable<Migration> {
    /**
     * Removes the genres of every book.
     */
    @Injectable()
    class RemoveGenresMigration extends Migration {
        /**
         * The version of the application that ships it.
         */
        version: SemVerVersion = '0.0.2';

        constructor() {
            super(dataSourceClass);
        }

        override async up(transaction: Transaction): Promise<void> {
            await this.dataSource.removeRelationFromEntity({
                entity: { tableName: 'related_book' },
                relation: { name: 'genres', target: { tableName: 'related_genre' }, inverseSide: 'books' },
                transaction
            });
        }

        // eslint-disable-next-line typescript/require-await
        override async down(): Promise<void> {
            throw new Error('Not needed for these cases.');
        }
    }
    return RemoveGenresMigration;
}

/**
 * What the cases run against.
 */
type MigratedRelationsTarget = {
    /**
     * Reads the data source, started with the migration creating the tables.
     */
    dataSourceOf: () => DataSourceInterface,
    /**
     * Starts the application again, with the migration removing the genres as well.
     */
    restartRemovingGenres: () => Promise<void>
};

/**
 * Runs every case against the relations of entities a migration created from written-out properties.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param target - The data source, and how to start it again.
 */
export function describeMigratedRelations(dataSourceName: string, target: MigratedRelationsTarget): void {
    // part of evaluation round 2, 02 §S14: a migration that writes out what it creates, as a generated
    // one does, created no relations - only creating an entity from what it declares did
    describe(`the relations of entities a migration created from written-out properties, on ${dataSourceName}`, () => {
        it('are stored and read from both sides', async () => {
            const dataSource: DataSourceInterface = target.dataSourceOf();
            const author: RelatedAuthor = await dataSource.getRepository(RelatedAuthor).create({ name: 'Ada' });
            const genres: RelatedGenre[] = await dataSource.getRepository(RelatedGenre).createAll([{ name: 'poetry' }, { name: 'math' }]);
            await dataSource.getRepository(RelatedBook).create({ title: 'Notes', authorId: author.id, genres });

            const book: RelatedBook = await dataSource.getRepository(RelatedBook)
                .findOne({ where: { title: 'Notes' }, relations: ['author', 'genres'] });
            const written: RelatedAuthor = await dataSource.getRepository(RelatedAuthor)
                .findOne({ where: { name: 'Ada' }, relations: ['books'] });
            expect([book.author.name, book.genres.map(g => g.name).sort()]).toStrictEqual(['Ada', ['math', 'poetry']]);
            expect(written.books.map(b => b.title)).toStrictEqual(['Notes']);
        });

        // last, since it starts the application again
        it('hold nothing once a migration removed one the entities go on declaring', async () => {
            await target.restartRemovingGenres();

            const book: RelatedBook = await target.dataSourceOf().getRepository(RelatedBook)
                .findOne({ where: { title: 'Notes' }, relations: ['genres'] });
            const genres: RelatedGenre[] = await target.dataSourceOf().getRepository(RelatedGenre)
                .findAll({ limit: 'all', relations: ['books'] });
            expect(book.genres).toStrictEqual([]);
            expect(genres.map(g => g.books.length)).toStrictEqual([0, 0]);
        });
    });
}