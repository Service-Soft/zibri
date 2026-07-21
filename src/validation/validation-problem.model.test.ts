import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { IsRequiredValidationProblem,
    MaxFileSizeValidationProblem,
    MimeTypeMismatchValidationProblem,
    RelationsNotAllowedValidationProblem,
    TypeMismatchValidationProblem } from './validation-problem.model';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { BaseEntity } from '../entity/base-entity.model';
import { BelongsToOnePropertyMetadata } from '../entity/models/belongs-to-one-property-metadata.model';
import { HasOnePropertyMetadata } from '../entity/models/has-one-property-metadata.model';
import { ManyToManyPropertyMetadata } from '../entity/models/many-to-many-property-metadata.model';
import { ManyToOnePropertyMetadata } from '../entity/models/many-to-one-property-metadata.model';
import { OneToManyPropertyMetadata } from '../entity/models/one-to-many-property-metadata.model';
import { Relation } from '../entity/models/relation.enum';
import { MimeType } from '../http/mime-type.enum';

class TargetEntity extends BaseEntity {}

describe('validation problems', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('IsRequiredValidationProblem carries the key and an "is required" message', () => {
        const problem: IsRequiredValidationProblem = new IsRequiredValidationProblem('name');
        expect(problem.key).toBe('name');
        expect(problem.message).toContain('required');
    });

    it('TypeMismatchValidationProblem mentions the expected type', () => {
        const problem: TypeMismatchValidationProblem = new TypeMismatchValidationProblem('age', 'number');
        expect(problem.key).toBe('age');
        expect(problem.message).toContain('number');
    });

    it('MaxFileSizeValidationProblem mentions the max size', () => {
        const problem: MaxFileSizeValidationProblem = new MaxFileSizeValidationProblem('file', '5mb');
        expect(problem.key).toBe('file');
        expect(problem.message).toContain('5mb');
    });

    it('MimeTypeMismatchValidationProblem uses singular phrasing for a single allowed type', () => {
        const problem: MimeTypeMismatchValidationProblem = new MimeTypeMismatchValidationProblem('file', [MimeType.PDF]);
        expect(problem.message).toContain(MimeType.PDF);
        expect(problem.message).not.toContain('one of');
    });

    it('MimeTypeMismatchValidationProblem lists all types when multiple are allowed', () => {
        const problem: MimeTypeMismatchValidationProblem = new MimeTypeMismatchValidationProblem(
            'file',
            [MimeType.PDF, MimeType.PNG]
        );
        expect(problem.message).toContain('one of');
        expect(problem.message).toContain(MimeType.PDF);
        expect(problem.message).toContain(MimeType.PNG);
    });

    describe('RelationsNotAllowedValidationProblem example generation', () => {
        it('produces an object-shaped example for many-to-one relations, using the target entity name', () => {
            const metadata: ManyToOnePropertyMetadata<BaseEntity> = {
                type: Relation.MANY_TO_ONE,
                target: () => TargetEntity,
                inverseSide: 'id',
                joinColumn: 'targetId',
                cascade: false,
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: false
            };
            const problem: RelationsNotAllowedValidationProblem = new RelationsNotAllowedValidationProblem('target', metadata, 'target');

            expect(problem.message).toContain('TargetEntityCreateDto');
            expect(problem.message).toContain('@Property.object');
            expect(problem.message).not.toContain('targetCreateDto');
        });

        it('produces an object-shaped example for has-one relations', () => {
            const metadata: HasOnePropertyMetadata<BaseEntity> = {
                type: Relation.HAS_ONE,
                target: () => TargetEntity,
                inverseSide: 'id',
                cascade: false,
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: false
            };
            const problem: RelationsNotAllowedValidationProblem = new RelationsNotAllowedValidationProblem('target', metadata, 'target');

            expect(problem.message).toContain('TargetEntityCreateDto');
            expect(problem.message).toContain('@Property.object');
        });

        it('produces an object-shaped example for belongs-to-one relations', () => {
            const metadata: BelongsToOnePropertyMetadata<BaseEntity> = {
                type: Relation.BELONGS_TO_ONE,
                target: () => TargetEntity,
                inverseSide: 'id',
                joinColumn: 'targetId',
                cascade: false,
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: false
            };
            const problem: RelationsNotAllowedValidationProblem = new RelationsNotAllowedValidationProblem('target', metadata, 'target');

            expect(problem.message).toContain('TargetEntityCreateDto');
            expect(problem.message).toContain('@Property.object');
        });

        it('produces an array-shaped example for one-to-many relations, using the target entity name', () => {
            const metadata: OneToManyPropertyMetadata<BaseEntity> = {
                type: Relation.ONE_TO_MANY,
                target: () => TargetEntity,
                inverseSide: 'id',
                cascade: false,
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: false
            };
            const problem: RelationsNotAllowedValidationProblem = new RelationsNotAllowedValidationProblem('targets', metadata, 'targets');

            expect(problem.message).toContain('TargetEntityCreateDto[]');
            expect(problem.message).toContain('@Property.array');
            expect(problem.message).not.toContain('targetsCreateDto');
        });

        it('produces an array-shaped example for many-to-many relations', () => {
            const metadata: ManyToManyPropertyMetadata<BaseEntity> = {
                type: Relation.MANY_TO_MANY,
                target: () => TargetEntity,
                inverseSide: 'id',
                joinTable: true,
                persistence: true,
                cascade: false,
                required: true,
                description: undefined,
                exclude: false,
                excludeFromChangeSets: false
            };
            const problem: RelationsNotAllowedValidationProblem = new RelationsNotAllowedValidationProblem('targets', metadata, 'targets');

            expect(problem.message).toContain('TargetEntityCreateDto[]');
            expect(problem.message).toContain('@Property.array');
        });
    });
});