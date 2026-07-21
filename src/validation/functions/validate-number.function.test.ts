import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { validateNumber } from './validate-number.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { NumberPropertyMetadata } from '../../entity/models/number-property-metadata.model';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

enum Size {
    SMALL = 1,
    LARGE = 2
}

function meta(overrides: Partial<NumberPropertyMetadata> = {}): NumberPropertyMetadata {
    return {
        required: true,
        primary: false,
        unique: false,
        type: 'number',
        description: undefined,
        min: undefined,
        max: undefined,
        default: undefined,
        excludeFromChangeSets: false,
        exclude: false,
        enum: undefined,
        format: undefined,
        ...overrides
    };
}

describe('validateNumber', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('returns no problems for a valid number', async () => {
        const problems: ValidationProblem[] = await validateNumber('age', 42, meta(), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('returns IsRequiredValidationProblem when required and missing', async () => {
        const problems: ValidationProblem[] = await validateNumber('age', undefined, meta({ required: true }), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(IsRequiredValidationProblem);
    });

    it('returns no problems when not required and missing', async () => {
        const problems: ValidationProblem[] = await validateNumber('age', undefined, meta({ required: false }), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('returns TypeMismatchValidationProblem for a non-number value on a plain number field', async () => {
        const problems: ValidationProblem[] = await validateNumber('age', '42', meta(), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(TypeMismatchValidationProblem);
    });

    describe('bigint format', () => {
        it('accepts an actual bigint value', async () => {
            const problems: ValidationProblem[] = await validateNumber('big', 42n, meta({ format: 'bigint' }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('rejects a plain number with a BigIntString type mismatch, not a generic number mismatch', async () => {
            const problems: ValidationProblem[] = await validateNumber('big', 42, meta({ format: 'bigint' }), undefined, undefined);
            expect(problems).toHaveLength(1);
            expect(problems[0]).toBeInstanceOf(TypeMismatchValidationProblem);
            expect(problems[0].message).toContain('BigIntString');
        });
    });

    describe('integer format', () => {
        it('accepts an integer value', async () => {
            const problems: ValidationProblem[] = await validateNumber('count', 5, meta({ format: 'integer' }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('rejects a non-integer number', async () => {
            const problems: ValidationProblem[] = await validateNumber('count', 5.5, meta({ format: 'integer' }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });
    });

    describe('min/max boundaries are inclusive', () => {
        it('accepts a value exactly equal to min', async () => {
            const problems: ValidationProblem[] = await validateNumber('age', 18, meta({ min: 18 }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('rejects a value below min', async () => {
            const problems: ValidationProblem[] = await validateNumber('age', 17, meta({ min: 18 }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });

        it('accepts a value exactly equal to max', async () => {
            const problems: ValidationProblem[] = await validateNumber('age', 65, meta({ max: 65 }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('rejects a value above max', async () => {
            const problems: ValidationProblem[] = await validateNumber('age', 66, meta({ max: 65 }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });
    });

    describe('enum', () => {
        it('accepts a value matching one of the enum values', async () => {
            const problems: ValidationProblem[] = await validateNumber('size', Size.SMALL, meta({ enum: Size }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('rejects a value not matching any enum value', async () => {
            const problems: ValidationProblem[] = await validateNumber('size', 99, meta({ enum: Size }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });
    });
});