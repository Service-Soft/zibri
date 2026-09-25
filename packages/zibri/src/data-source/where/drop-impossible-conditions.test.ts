/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { dropImpossibleConditions } from './drop-impossible-conditions.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property, PropertyMetadata } from '../../entity/decorators/property.decorator';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { WhereFilter } from '../models/where/where-filter.model';

@Entity({ allowOrphan: true })
class Document extends BaseEntity {
    @Property.string({ format: 'uuid', required: false })
    ownerId: string | undefined | null;

    @Property.string()
    title!: string;

    @Property.oneToMany({ target: () => Revision, inverseSide: 'document' })
    revisions!: Revision[];
}

@Entity({ allowOrphan: true })
class Revision extends BaseEntity {
    @Property.manyToOne({ target: () => Document, joinColumn: 'documentId', inverseSide: 'revisions' })
    document!: Document;

    @Property.string({ format: 'uuid' })
    documentId!: string;
}

const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Document);

const a: string = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const b: string = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

function drop(...branches: WhereFilter<Document>[]): WhereFilter<Document>[] {
    return dropImpossibleConditions(branches, properties);
}

describe('dropImpossibleConditions', () => {

    describe('a value the property cannot hold', () => {
        it('drops the branch asking for it', () => {
            expect(drop({ ownerId: 'garbage' })).toEqual([]);
        });

        it('drops only the branch that asks for it', () => {
            expect(drop({ ownerId: 'garbage' }, { ownerId: a })).toEqual([{ ownerId: a }]);
        });

        it('drops the branch even when its other conditions are satisfiable', () => {
            // the conditions in one branch are an and, so one that nothing satisfies decides it
            expect(drop({ ownerId: 'garbage', title: 'readable' })).toEqual([]);
        });
    });

    describe('a property that declares no format', () => {
        it('is left alone whatever it is asked for', () => {
            expect(drop({ title: 'not-a-uuid' })).toEqual([{ title: 'not-a-uuid' }]);
        });
    });

    describe('a value the property can hold', () => {
        it('is left exactly as it was', () => {
            expect(drop({ ownerId: a })).toEqual([{ ownerId: a }]);
        });

        it('leaves null alone, which is a value the column holds', () => {
            expect(drop({ ownerId: null })).toEqual([{ ownerId: null }]);
        });
    });

    describe('a list of options', () => {
        it('keeps the options that are possible and drops the rest', () => {
            expect(drop({ ownerId: { oneOf: ['garbage', a] } })).toEqual([{ ownerId: { oneOf: [a] } }]);
        });

        it('drops the branch when no option survives', () => {
            expect(drop({ ownerId: { oneOf: ['garbage', 'nonsense'] } })).toEqual([]);
        });

        it('leaves the other keys of the same condition untouched', () => {
            const res: WhereFilter<Document>[] = drop({ ownerId: { oneOf: ['garbage', a, b], notOneOf: [b] } });

            expect(res).toEqual([{ ownerId: { oneOf: [a, b], notOneOf: [b] } }]);
        });

        it('treats an array on the property itself the same way, since it is an or', () => {
            expect(drop({ ownerId: ['garbage', a] })).toEqual([{ ownerId: [a] }]);
            expect(drop({ ownerId: ['garbage', 'nonsense'] })).toEqual([]);
        });
    });

    describe('negations', () => {
        it('leaves `not` alone, because every row satisfies it', () => {
            // narrowing this to "matches everything" would widen the filter, and a filter that got
            // wider is how a caller sees rows they asked not to see
            expect(drop({ ownerId: { not: 'garbage' } })).toEqual([{ ownerId: { not: 'garbage' } }]);
        });

        it('leaves `notOneOf` alone for the same reason', () => {
            expect(drop({ ownerId: { notOneOf: ['garbage'] } })).toEqual([{ ownerId: { notOneOf: ['garbage'] } }]);
        });
    });

    describe('the filter as a whole', () => {
        it('gives back nothing when every branch is impossible', () => {
            expect(drop({ ownerId: 'garbage' }, { ownerId: { oneOf: ['nonsense'] } })).toEqual([]);
        });

        it('leaves a filter naming no uuid property completely alone', () => {
            const where: WhereFilter<Document> = { title: 'unchanged' };

            expect(drop(where)).toEqual([where]);
        });

        it('does not mutate the filter it was given', () => {
            const where: WhereFilter<Document> = { ownerId: { oneOf: ['garbage', a] } };

            drop(where);

            expect(where).toEqual({ ownerId: { oneOf: ['garbage', a] } });
        });
    });

    describe('entities named through a relation', () => {
        it('drops a branch requiring the relation to include one nothing could be stored as', () => {
            // includes asks for a relation holding all of them, so an entity no row can be is a
            // requirement nothing satisfies. Reachable without anyone attacking anything: a list of
            // ids taken out of a url is the ordinary way to write this
            expect(drop({ revisions: { includes: [{ id: 'not-a-uuid' } as Revision] } })).toEqual([]);
        });

        it('keeps the branch when every entity it requires could exist', () => {
            const where: WhereFilter<Document> = { revisions: { includes: [{ id: a } as Revision] } };

            expect(drop(where)).toEqual([where]);
        });

        it('removes an impossible entity from an allow list and keeps the rest', () => {
            const res: WhereFilter<Document>[] = drop({
                revisions: { isIncludedIn: [{ id: 'not-a-uuid' } as Revision, { id: a } as Revision] }
            });

            expect(res).toEqual([{ revisions: { isIncludedIn: [{ id: a }] } }]);
        });

        it('leaves an allow list alone when nothing in it survives', () => {
            // emptying it would say "no related row is permitted", which is a different question
            // from the one that was asked, and narrowing must never be what changes an answer
            const where: WhereFilter<Document> = { revisions: { isIncludedIn: [{ id: 'not-a-uuid' } as Revision] } };

            expect(drop(where)).toEqual([where]);
        });

        it('leaves a relation filter that names no entity alone', () => {
            const where: WhereFilter<Document> = { revisions: { length: 2 } };

            expect(drop(where)).toEqual([where]);
        });
    });

    describe('the id, which every entity declares as a uuid', () => {
        it('drops a branch naming an id nothing could be stored under', () => {
            expect(drop({ id: 'not-a-uuid' })).toEqual([]);
        });

        it('keeps a well formed one', () => {
            expect(drop({ id: a })).toEqual([{ id: a }]);
        });
    });
});