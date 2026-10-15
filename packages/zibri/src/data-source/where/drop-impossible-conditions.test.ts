/* eslint-disable unicorn/no-null */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { dropImpossibleConditions } from './drop-impossible-conditions.function';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property, PropertyMetadata } from '../../entity/decorators/property.decorator';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { WhereFilter } from '../models/where/where-filter.model';

@Entity({ tenant: 'shared', allowOrphan: true })
class Document extends BaseEntity {
    @Property.string({ format: 'uuid', required: false })
    ownerId: string | undefined | null;

    @Property.string()
    title!: string;

    @Property.oneToMany({ target: () => Revision, inverseSide: 'document' })
    revisions!: Revision[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
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
    let server: StartedTestServer | undefined;

    // a running application, in process: a refusal is a translated message, and translating needs
    // one to translate for
    beforeAll(async () => {
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })] });
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    });

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
        it('refuses `not` naming a value no row holds', () => {
            // every row differs from it, so narrowing would widen the filter to every row - how a
            // caller sees rows they asked not to see - and leaving it hands the store a value it
            // refuses, which a typed column answers with a failed query
            expect(() => drop({ ownerId: { not: 'garbage' } })).toThrow(BadRequestError);
        });

        it('refuses `notOneOf` for the same reason, even beside a value that is possible', () => {
            expect(() => drop({ ownerId: { notOneOf: [a, 'garbage'] } })).toThrow(BadRequestError);
        });

        it('leaves a negation of a possible value alone', () => {
            expect(drop({ ownerId: { not: a, notOneOf: [b, null] } })).toEqual([{ ownerId: { not: a, notOneOf: [b, null] } }]);
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

    describe('a filter reaching through a relation to one entity', () => {
        const revisionProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(Revision);
        const ghost: Document = Object.assign(new Document(), { id: 'garbage', title: 'ghost' });
        const real: Document = Object.assign(new Document(), { id: a, title: 'real' });

        function dropRevisions(...branches: WhereFilter<Revision>[]): WhereFilter<Revision>[] {
            return dropImpossibleConditions(branches, revisionProperties);
        }

        it('narrows a filter on the related entity by that entity\'s properties', () => {
            // the join reaches the target's uuid column, which a typed store refuses the value for
            expect(dropRevisions({ document: { where: { id: 'garbage' } } })).toEqual([]);
            expect(dropRevisions({ document: { where: [{ id: 'garbage' }, { ownerId: b }] } }))
                .toEqual([{ document: { where: [{ ownerId: b }] } }]);
        });

        it('judges the entities it compares against by their id', () => {
            expect(dropRevisions({ document: { is: ghost } })).toEqual([]);
            expect(dropRevisions({ document: { oneOf: [ghost, real] } })).toEqual([{ document: { oneOf: [real] } }]);
        });

        it('refuses a negation of an entity no row can be', () => {
            expect(() => dropRevisions({ document: { not: ghost } })).toThrow(BadRequestError);
            expect(() => dropRevisions({ document: { where: { ownerId: { not: 'garbage' } } } })).toThrow(/document\.ownerId/);
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