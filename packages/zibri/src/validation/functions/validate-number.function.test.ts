import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validateNumber } from './validate-number.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { NumberFormat, NumberPropertyMetadata } from '../../entity/models/number-property-metadata.model.ts';
import { NumberUtilities } from '../../utilities/number.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model.ts';

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
        index: false,
        optimisticLocking: false,
        exclude: false,
        enum: undefined,
        format: 'number',
        ...overrides
    };
}

describe('validateNumber', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 30000);

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

        it('rejects a plain number by naming the type the format holds', async () => {
            const problems: ValidationProblem[] = await validateNumber('big', 42, meta({ format: 'bigint' }), undefined, undefined);
            expect(problems).toHaveLength(1);
            expect(problems[0]).toBeInstanceOf(TypeMismatchValidationProblem);
            expect(problems[0]?.message).toContain('bigint');
        });
    });

    describe('the value has to be what the format holds', () => {
        // the half no check at declaration time reaches: a property typed `number | null` compiles
        // to Object, so for those this is the only thing that can tell the two apart. Every pairing
        // rather than the interesting ones, because "which of these is refused" is the whole rule
        const values: [string, unknown][] = [
            ['a number', 7],
            ['a bigint', 7n],
            ['a BigNumber', NumberUtilities.new(7)],
            ['a string', '7']
        ];
        const accepted: Record<NumberFormat, string> = {
            number: 'a number',
            integer: 'a number',
            bigint: 'a bigint',
            bignumber: 'a BigNumber'
        };

        for (const format of ObjectUtilities.keys(accepted)) {
            for (const [name, value] of values) {
                const verb: string = accepted[format] === name ? 'accepts' : 'refuses';
                it(`${verb} ${name} for format "${format}"`, async () => {
                    const problems: ValidationProblem[] = await validateNumber('v', value, meta({ format }), undefined, undefined);

                    expect(problems).toHaveLength(accepted[format] === name ? 0 : 1);
                });
            }
        }
    });

    describe('bignumber format', () => {
        it('compares a bound against the number it holds rather than against the object', async () => {
            // a BigNumber is an object, so `property < meta.min` would compare what it stringifies
            // to - and a bound it is under would pass
            const problems: ValidationProblem[] = await validateNumber(
                'price',
                NumberUtilities.new(5),
                meta({ format: 'bignumber', min: 10 }),
                undefined,
                undefined
            );

            expect(problems).toHaveLength(1);
        });

        it('accepts a value exactly on the bound', async () => {
            const problems: ValidationProblem[] = await validateNumber(
                'price',
                NumberUtilities.new(10),
                meta({ format: 'bignumber', min: 10 }),
                undefined,
                undefined
            );

            expect(problems).toEqual([]);
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

        it('accepts every whole number a double holds exactly', async () => {
            const problems: ValidationProblem[] = await validateNumber(
                'count',
                -Number.MAX_SAFE_INTEGER,
                meta({ format: 'integer' }),
                undefined,
                undefined
            );
            expect(problems).toEqual([]);
        });

        it('rejects a whole number past what a double holds exactly', async () => {
            // 2^53 is whole, and also what 2^53 + 1 reads as, so it does not stand for one number
            const problems: ValidationProblem[] = await validateNumber('count', 2 ** 53, meta({ format: 'integer' }), undefined, undefined);
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