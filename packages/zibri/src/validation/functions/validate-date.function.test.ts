import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { validateDate } from './validate-date.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { DatePropertyMetadata } from '../../entity/models/date-property-metadata.model';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

function meta(overrides: Partial<DatePropertyMetadata> = {}): DatePropertyMetadata {
    return {
        required: true,
        type: 'date',
        description: undefined,
        after: undefined,
        before: undefined,
        default: undefined,
        exclude: false,
        excludeFromChangeSets: false,
        ...overrides
    };
}

describe('validateDate', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('returns no problems for a valid date within bounds', async () => {
        const problems: ValidationProblem[] = await validateDate('when', new Date('2024-06-01'), meta(), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('returns IsRequiredValidationProblem when required and missing', async () => {
        const problems: ValidationProblem[] = await validateDate('when', undefined, meta({ required: true }), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(IsRequiredValidationProblem);
    });

    it('returns no problems when not required and missing', async () => {
        const problems: ValidationProblem[] = await validateDate('when', undefined, meta({ required: false }), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('returns TypeMismatchValidationProblem for a non-Date value', async () => {
        const problems: ValidationProblem[] = await validateDate('when', '2024-06-01', meta(), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(TypeMismatchValidationProblem);
    });

    describe('before/after boundaries are exclusive', () => {
        it('rejects a value exactly equal to "before"', async () => {
            const boundary: Date = new Date('2024-01-01T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate('when', boundary, meta({ before: boundary }), undefined, undefined);
            expect(problems).toHaveLength(1);
            expect(problems[0].key).toBe('when');
        });

        it('accepts a value strictly before "before"', async () => {
            const boundary: Date = new Date('2024-01-01T00:00:00.000Z');
            const earlier: Date = new Date('2023-12-31T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate('when', earlier, meta({ before: boundary }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('rejects a value after "before"', async () => {
            const boundary: Date = new Date('2024-01-01T00:00:00.000Z');
            const later: Date = new Date('2024-01-02T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate('when', later, meta({ before: boundary }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });

        it('rejects a value exactly equal to "after"', async () => {
            const boundary: Date = new Date('2024-01-01T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate('when', boundary, meta({ after: boundary }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });

        it('accepts a value strictly after "after"', async () => {
            const boundary: Date = new Date('2024-01-01T00:00:00.000Z');
            const later: Date = new Date('2024-01-02T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate('when', later, meta({ after: boundary }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('applies both before and after when both are set', async () => {
            const after: Date = new Date('2024-01-01T00:00:00.000Z');
            const before: Date = new Date('2024-12-31T00:00:00.000Z');
            const within: Date = new Date('2024-06-01T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate('when', within, meta({ after, before }), undefined, undefined);
            expect(problems).toEqual([]);
        });
    });
});