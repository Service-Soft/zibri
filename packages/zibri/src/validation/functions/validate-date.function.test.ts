import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { validateDate } from './validate-date.function';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { DatePropertyMetadata } from '../../entity/models/date-property-metadata.model';
import { Ms } from '../../utilities/ms';
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
        index: false,
        optimisticLocking: false,
        ...overrides
    };
}

describe('validateDate', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        // in memory: nothing here reads a table, and the suite runs without a container
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

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
        const boundary: Date = new Date('2024-01-01T00:00:00.000Z');

        it('rejects a value exactly equal to "before"', async () => {
            const problems: ValidationProblem[] = await validateDate('when', boundary, meta({ before: () => boundary }), undefined, undefined);
            expect(problems).toHaveLength(1);
            expect(problems[0]?.key).toBe('when');
            expect(problems[0]?.code).toBe('before');
        });

        it('accepts a value strictly before "before"', async () => {
            const earlier: Date = new Date('2023-12-31T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate('when', earlier, meta({ before: () => boundary }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('rejects a value after "before"', async () => {
            const later: Date = new Date('2024-01-02T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate('when', later, meta({ before: () => boundary }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });

        it('rejects a value exactly equal to "after"', async () => {
            const problems: ValidationProblem[] = await validateDate('when', boundary, meta({ after: () => boundary }), undefined, undefined);
            expect(problems).toHaveLength(1);
            expect(problems[0]?.code).toBe('after');
        });

        it('accepts a value strictly after "after"', async () => {
            const later: Date = new Date('2024-01-02T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate('when', later, meta({ after: () => boundary }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('applies both before and after when both are set', async () => {
            const within: Date = new Date('2024-06-01T00:00:00.000Z');
            const problems: ValidationProblem[] = await validateDate(
                'when',
                within,
                meta({ after: () => boundary, before: () => new Date('2024-12-31T00:00:00.000Z') }),
                undefined,
                undefined
            );
            expect(problems).toEqual([]);
        });
    });

    it('asks a bound each time a value is validated, so "in the future" moves with the clock', async () => {
        const inTheFuture: DatePropertyMetadata = meta({ after: () => new Date() });
        expect(await validateDate('when', new Date(Date.now() + Ms.HOUR), inTheFuture, undefined, undefined)).toEqual([]);
        expect(await validateDate('when', new Date(Date.now() - Ms.SECOND), inTheFuture, undefined, undefined)).toHaveLength(1);
    });

    it('gives a bound the object the date is on, and takes no bound when it returns nothing', async () => {
        const beforeEnd: DatePropertyMetadata = meta({ before: (booking: { endsAt?: Date }) => booking.endsAt });
        const startsAt: Date = new Date('2024-06-01T00:00:00.000Z');

        const problems: ValidationProblem[] = await validateDate(
            'startsAt', startsAt, beforeEnd, undefined, { endsAt: new Date('2024-05-01T00:00:00.000Z') }
        );
        expect(problems).toEqual([expect.objectContaining({ key: 'startsAt', code: 'before' })]);
        expect(await validateDate('startsAt', startsAt, beforeEnd, undefined, {})).toEqual([]);
    });
});