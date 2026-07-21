import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { validateString } from './validate-string.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { StringPropertyMetadata } from '../../entity/models/string-property-metadata.model';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

enum Role {
    ADMIN = 'admin',
    USER = 'user'
}

// eslint-disable-next-line typescript/no-explicit-any
function meta(overrides: Partial<StringPropertyMetadata<any, any, any, any, any>> = {}): StringPropertyMetadata<any, any, any, any, any> {
    return {
        required: true,
        primary: false,
        type: 'string',
        unique: false,
        description: undefined,
        format: undefined,
        maxLength: undefined,
        minLength: undefined,
        regex: undefined,
        enum: undefined,
        default: undefined,
        excludeFromChangeSets: false,
        exclude: false,
        encryption: false,
        hash: false,
        ...overrides
    };
}

describe('validateString', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('returns no problems for a valid string', async () => {
        const problems: ValidationProblem[] = await validateString('name', 'Alice', meta(), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('returns IsRequiredValidationProblem when required and missing', async () => {
        const problems: ValidationProblem[] = await validateString('name', undefined, meta({ required: true }), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(IsRequiredValidationProblem);
    });

    it('returns no problems when not required and missing', async () => {
        const problems: ValidationProblem[] = await validateString('name', undefined, meta({ required: false }), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('returns no problems when missing but a default is configured', async () => {
        const problems: ValidationProblem[] = await validateString(
            'name',
            undefined,
            meta({ required: true, default: 'fallback' }),
            undefined,
            undefined
        );
        expect(problems).toEqual([]);
    });

    it('returns TypeMismatchValidationProblem for a non-string value', async () => {
        const problems: ValidationProblem[] = await validateString('name', 42, meta(), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(TypeMismatchValidationProblem);
    });

    describe('uuid format', () => {
        it('accepts a valid uuid v4', async () => {
            const problems: ValidationProblem[] = await validateString(
                'id',
                '123e4567-e89b-42d3-a456-426614174000',
                meta({ format: 'uuid' }),
                undefined,
                undefined
            );
            expect(problems).toEqual([]);
        });

        it('rejects a string with the wrong version digit', async () => {
            const problems: ValidationProblem[] = await validateString(
                'id',
                '123e4567-e89b-92d3-a456-426614174000',
                meta({ format: 'uuid' }),
                undefined,
                undefined
            );
            expect(problems).toHaveLength(1);
        });

        it('rejects a string with the wrong variant nibble', async () => {
            const problems: ValidationProblem[] = await validateString(
                'id',
                '123e4567-e89b-42d3-f456-426614174000',
                meta({ format: 'uuid' }),
                undefined,
                undefined
            );
            expect(problems).toHaveLength(1);
        });

        it('rejects a plain non-uuid string', async () => {
            const problems: ValidationProblem[] = await validateString('id', 'not-a-uuid', meta({ format: 'uuid' }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });
    });

    describe('email format', () => {
        it('accepts a valid email', async () => {
            const problems: ValidationProblem[] = await validateString(
                'email',
                'user@example.com',
                meta({ format: 'email' }),
                undefined,
                undefined
            );
            expect(problems).toEqual([]);
        });

        it('rejects a string with multiple @ signs', async () => {
            const problems: ValidationProblem[] = await validateString(
                'email',
                'a@b@example.com',
                meta({ format: 'email' }),
                undefined,
                undefined
            );
            expect(problems).toHaveLength(1);
        });

        it('rejects a string with no TLD', async () => {
            const problems: ValidationProblem[] = await validateString('email', 'user@localhost', meta({ format: 'email' }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });
    });

    it('validates against a custom regex', async () => {
        const digitsOnly: RegExp = /^\d+$/;
        await expect(validateString('code', '12345', meta({ regex: digitsOnly }), undefined, undefined)).resolves.toEqual([]);
        await expect(validateString('code', '123ab', meta({ regex: digitsOnly }), undefined, undefined)).resolves.toHaveLength(1);
    });

    describe('enum', () => {
        it('accepts a value matching one of the enum values', async () => {
            const problems: ValidationProblem[] = await validateString('role', Role.ADMIN, meta({ enum: Role }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('rejects a value not matching any enum value', async () => {
            // eslint-disable-next-line cspell/spellchecker
            const problems: ValidationProblem[] = await validateString('role', 'superadmin', meta({ enum: Role }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });
    });

    describe('minLength/maxLength', () => {
        it('rejects a string shorter than minLength', async () => {
            const problems: ValidationProblem[] = await validateString('name', 'ab', meta({ minLength: 3 }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });

        it('accepts a string exactly at minLength', async () => {
            const problems: ValidationProblem[] = await validateString('name', 'abc', meta({ minLength: 3 }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('treats minLength of 0 as no constraint (falsy short-circuit)', async () => {
            const problems: ValidationProblem[] = await validateString('name', '', meta({ minLength: 0 }), undefined, undefined);
            expect(problems).toEqual([]);
        });

        it('rejects a string longer than maxLength', async () => {
            const problems: ValidationProblem[] = await validateString('name', 'abcdef', meta({ maxLength: 5 }), undefined, undefined);
            expect(problems).toHaveLength(1);
        });

        it('accepts a string exactly at maxLength', async () => {
            const problems: ValidationProblem[] = await validateString('name', 'abcde', meta({ maxLength: 5 }), undefined, undefined);
            expect(problems).toEqual([]);
        });
    });
});