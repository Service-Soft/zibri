import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { validateBoolean } from './validate-boolean.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { BooleanPropertyMetadata } from '../../entity/models/boolean-property-metadata.model';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

function meta(overrides: Partial<BooleanPropertyMetadata> = {}): BooleanPropertyMetadata {
    return {
        required: true,
        type: 'boolean',
        description: undefined,
        default: undefined,
        exclude: false,
        excludeFromChangeSets: false,
        ...overrides
    };
}

describe('validateBoolean', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('returns no problems for a valid boolean value', async () => {
        const problems: ValidationProblem[] = await validateBoolean('flag', true, meta(), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('returns IsRequiredValidationProblem when required and missing', async () => {
        const problems: ValidationProblem[] = await validateBoolean('flag', undefined, meta({ required: true }), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(IsRequiredValidationProblem);
        expect(problems[0].key).toBe('flag');
    });

    it('returns no problems when not required and missing', async () => {
        const problems: ValidationProblem[] = await validateBoolean('flag', undefined, meta({ required: false }), undefined, undefined);
        expect(problems).toEqual([]);
    });

    it('returns no problems when missing but a default is configured, even if required', async () => {
        const problems: ValidationProblem[] = await validateBoolean(
            'flag',
            undefined,
            meta({ required: true, default: false }),
            undefined,
            undefined
        );
        expect(problems).toEqual([]);
    });

    it('resolves an async required function using the entity and context', async () => {
        const problems: ValidationProblem[] = await validateBoolean(
            'flag',
            undefined,
            // eslint-disable-next-line typescript/require-await
            meta({ required: async () => true }),
            undefined,
            { some: 'entity' }
        );
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(IsRequiredValidationProblem);
    });

    it('returns TypeMismatchValidationProblem for a non-boolean value', async () => {
        const problems: ValidationProblem[] = await validateBoolean('flag', 'yes', meta(), undefined, undefined);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toBeInstanceOf(TypeMismatchValidationProblem);
    });

    it('prefixes the key with the parent key when nested', async () => {
        const problems: ValidationProblem[] = await validateBoolean('flag', undefined, meta({ required: true }), 'parent', undefined);
        expect(problems[0].key).toBe('parent.flag');
    });
});