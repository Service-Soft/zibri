import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { type Relation } from 'typeorm';

import { Repository } from './repository';
import { createTestDataSource, defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';

// ==================== ENTITIES ====================

@Entity()
class Parent extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Child, inverseSide: 'parent' })
    children!: Child[];
}

@Entity()
class Child extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Parent, inverseSide: 'children', joinColumn: 'parentId' })
    parent!: Parent;

    @Property.string({ format: 'uuid' })
    parentId!: string;
}

@Entity()
class Author extends BaseEntity {
    @Property.string()
    name!: string;

    // Non-owning side (joinTable: false)
    @Property.manyToMany({ target: () => Book, inverseSide: 'authors', joinTable: false })
    books!: Book[];
}

@Entity()
class Book extends BaseEntity { // redeclare to add inverse (real code would be in one place)
    @Property.string()
    title!: string;

    // Owning side (joinTable: true)
    @Property.manyToMany({ target: () => Author, inverseSide: 'books', joinTable: true })
    authors!: Author[];
}

@Entity()
class Reader extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => Bookmark, inverseSide: 'reader' })
    bookmark!: Relation<Bookmark>;
}

@Entity()
class Bookmark extends BaseEntity {
    @Property.string()
    page!: string;

    @Property.belongsToOne({ target: () => Reader, inverseSide: 'bookmark', joinColumn: 'readerId' })
    reader!: Reader;

    @Property.string({ format: 'uuid' })
    readerId!: string;
}

// ==================== TEST ====================

let server: StartedTestServer;
let authorRepo: Repository<Author>;
let bookRepo: Repository<Book>;
let readerRepo: Repository<Reader>;
let bookmarkRepo: Repository<Bookmark>;
let parentRepo: Repository<Parent>;
let childRepo: Repository<Child>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, Author, Book, Reader, Bookmark, Parent, Child]
            })
        ]
    });
    authorRepo = inject(repositoryTokenFor(Author));
    bookRepo = inject(repositoryTokenFor(Book));
    readerRepo = inject(repositoryTokenFor(Reader));
    bookmarkRepo = inject(repositoryTokenFor(Bookmark));
    parentRepo = inject(repositoryTokenFor(Parent));
    childRepo = inject(repositoryTokenFor(Child));
}, 15000);

afterAll(async () => {
    await server.shutdown();
});

beforeEach(async () => {
    await bookmarkRepo.deleteAll({});
    await readerRepo.deleteAll({});
    await bookRepo.deleteAll({});
    await authorRepo.deleteAll({});
    await parentRepo.deleteAll({});
    await childRepo.deleteAll({});
});

// ==================== TESTS ====================

describe('Repository relation pitfalls', () => {

    describe('many-to-many assignment from non-owning side', () => {
        it('should NOT silently ignore assignment on inverse side', async () => {
            const author: Author = await authorRepo.create({ name: 'Jane' });
            const book1: Book = await bookRepo.create({ title: 'Book 1' });
            const book2: Book = await bookRepo.create({ title: 'Book 2' });

            // Assign books from the NON-OWNING side (Author.books)
            await authorRepo.updateById(author.id, { books: [book1, book2] });

            // Re-fetch with relations to see if the junction table was updated
            const fetchedAuthor: Author = await authorRepo.findById(author.id, { relations: ['books'] });
            expect(fetchedAuthor.books.length).toBe(2); // ❌ will FAIL currently – proves the bug
        });
    });

    describe('updateAll – existing many-to-many relations data leak', () => {
        it('should replace old relations, not leave them dangling', async () => {
            const author: Author = await authorRepo.create({ name: 'Mark' });
            const book1: Book = await bookRepo.create({ title: 'Old' });
            const book2: Book = await bookRepo.create({ title: 'New' });

            // Assign initial books (owning side, works correctly)
            await bookRepo.updateById(book1.id, { authors: [author] });
            await bookRepo.updateById(book2.id, { authors: [author] });

            // Verify author has both books
            const before: Author = await authorRepo.findById(author.id, { relations: ['books'] });
            expect(before.books.length).toBe(2);

            // Now use updateAll to set only book2 (should remove book1)
            await authorRepo.updateAll({ id: author.id }, { books: [book2] });

            const after: Author = await authorRepo.findById(author.id, { relations: ['books'] });
            expect(after.books.length).toBe(1); // ❌ will FAIL if data leak exists
            expect(after.books[0].id).toBe(book2.id);
        });
    });

    describe('hasOne – assignment on inverse side ignored', () => {
        it('should not silently ignore assignment on hasOne side', async () => {
            const reader: Reader = await readerRepo.create({ name: 'Alice' });
            const bookmark: Bookmark = await bookmarkRepo.create({ page: 'p42', readerId: reader.id });

            // Attempt to set reader.bookmark from the non-owning side
            await readerRepo.updateById(reader.id, { bookmark: bookmark });

            const fetched: Reader = await readerRepo.findById(reader.id, { relations: ['bookmark'] });
            expect(fetched.bookmark).not.toBeNull(); // ❌ will FAIL currently – proves the bug
            expect(fetched.bookmark.id).toBe(bookmark.id);
        });
    });

    describe('deleting owning side (Book) should cascade to junction table', () => {
        it('removes the junction rows, author sees empty books', async () => {
            const author: Author = await authorRepo.create({ name: 'Orwell' });
            const book: Book = await bookRepo.create({ title: '1984', authors: [author] });

            await bookRepo.deleteById(book.id);

            const fetchedAuthor: Author = await authorRepo.findById(author.id, { relations: ['books'] });
            expect(fetchedAuthor.books.length).toBe(0); // junction rows removed
        });
    });

    describe('deleting inverse side (Author) without manual detach', () => {
        it('should either succeed (clean cascade) or throw FK violation (known limitation)', async () => {
            const author: Author = await authorRepo.create({ name: 'Hemingway' });
            const book: Book = await bookRepo.create({ title: 'Old Man', authors: [author] });

            // Deleting the author — TypeORM cleans up the junction table automatically
            await authorRepo.deleteById(author.id);

            // The book still exists …
            const fetchedBook: Book = await bookRepo.findById(book.id, { relations: ['authors'] });
            expect(fetchedBook).toBeDefined();
            // … but its authors array is now empty (junction rows deleted)
            expect(fetchedBook.authors.length).toBe(0);
        });
    });

    describe('one-to-many / many-to-one deletion', () => {
        let parent: Parent;
        let child1: Child;
        let child2: Child;

        beforeEach(async () => {
            parent = await parentRepo.create({ name: 'Parent' });
            child1 = await childRepo.create({ name: 'Child 1', parentId: parent.id });
            child2 = await childRepo.create({ name: 'Child 2', parentId: parent.id });
        });

        it('deleting the parent cascades and removes children', async () => {
            await parentRepo.deleteById(parent.id);

            // Both children should be gone
            const found1: Child | undefined = await childRepo.findOne({ where: { id: child1.id } }, false);
            const found2: Child | undefined = await childRepo.findOne({ where: { id: child2.id } }, false);
            expect(found1).toBeUndefined();
            expect(found2).toBeUndefined();
        });

        it('deleting a child does NOT delete the parent or other children', async () => {
            await childRepo.deleteById(child1.id);

            const parentAfter: Parent = await parentRepo.findById(parent.id, { relations: ['children'] });
            expect(parentAfter.children).toHaveLength(1);
            expect(parentAfter.children[0].id).toBe(child2.id);

            const deletedChild: Child | undefined = await childRepo.findOne({ where: { id: child1.id } }, false);
            expect(deletedChild).toBeUndefined();
        });
    });
});