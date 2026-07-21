import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { type Relation } from 'typeorm';

import { ValidationService } from './validation.service';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Property } from '../entity/decorators/property.decorator';
import { ValidationError } from '../error-handling/errors/validation.error';
import { MimeType } from '../http/mime-type.enum';
import { BodyMetadata } from '../routing/decorators/body.decorator';
import { HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing/decorators/param.decorator';
import { createHeaderParamMetadata, createPathParamMetadata, createQueryParamMetadata } from '../routing/param-metdata.helpers';
import { NumberUtilities } from '../utilities/number.utilities';

class Nested {
    @Property.string()
    label!: string;
}

// Deliberately not @Entity()-decorated or registered on a data source: ValidationService only
// reads @Property metadata off the class, it never persists these, so no real entity/schema is needed.
class Parent extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => Nested, required: false })
    nested: Nested | undefined;

    @Property.hasOne({ target: () => Child, inverseSide: 'parent' })
    child!: Relation<Child>;
}

class Child extends BaseEntity {
    @Property.hasOne({ target: () => Parent, inverseSide: 'child' })
    parent!: Relation<Parent>;
}

class SimpleModel {
    @Property.string()
    name!: string;
}

class WithNested {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => Nested, required: false })
    nested: Nested | undefined;
}

// eslint-disable-next-line typescript/no-explicit-any
function bodyMeta(overrides: Record<string, any> = {}): BodyMetadata {
    return {
        modelClass: SimpleModel,
        type: MimeType.JSON,
        isArray: false,
        allowAdditionalProperties: false,
        required: true,
        description: undefined,
        index: 0,
        maxSize: NumberUtilities.new(100),
        ...overrides
    };
}

describe('ValidationService', () => {
    let server: StartedTestServer;
    let validationService: ValidationService;

    beforeAll(async () => {
        server = await startTestServer({});
        validationService = inject(ValidationService);
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    describe('validatePathParam / validateQueryParam / validateHeaderParam', () => {
        it('resolves without throwing for valid path params', async () => {
            const meta: PathParamMetadata = createPathParamMetadata('id', { type: 'string' });
            await expect(validationService.validatePathParam('abc', meta)).resolves.toBeUndefined();
        });

        it('throws a ValidationError for an invalid path param', async () => {
            const meta: PathParamMetadata = createPathParamMetadata('id', { type: 'number' });
            await expect(validationService.validatePathParam('not-a-number', meta)).rejects.toThrow(ValidationError);
        });

        it('resolves without throwing for valid query params', async () => {
            const meta: QueryParamMetadata = createQueryParamMetadata('limit', { type: 'number' });
            await expect(validationService.validateQueryParam(10, meta)).resolves.toBeUndefined();
        });

        it('throws a ValidationError for an invalid query param', async () => {
            const meta: QueryParamMetadata = createQueryParamMetadata('limit', { type: 'number', required: true });
            await expect(validationService.validateQueryParam(undefined, meta)).rejects.toThrow(ValidationError);
        });

        it('resolves without throwing for a valid header param', async () => {
            const meta: HeaderParamMetadata = createHeaderParamMetadata('x-request-id', { type: 'string' });
            await expect(validationService.validateHeaderParam('abc-123', meta)).resolves.toBeUndefined();
        });

        it('throws a ValidationError for an invalid header param', async () => {
            const meta: HeaderParamMetadata = createHeaderParamMetadata('x-request-id', { type: 'string' });
            await expect(validationService.validateHeaderParam(42, meta)).rejects.toThrow(ValidationError);
        });
    });

    describe('validateBody', () => {
        it('resolves for a matching body', async () => {
            await expect(validationService.validateBody({ name: 'Alice' }, bodyMeta())).resolves.toBeUndefined();
        });

        it('rejects an undefined body when required', async () => {
            await expect(
                validationService.validateBody(undefined, bodyMeta({ required: true }))
            ).rejects.toThrow(ValidationError);
        });

        it('resolves for an undefined body when not required', async () => {
            await expect(
                validationService.validateBody(undefined, bodyMeta({ required: false }))
            ).resolves.toBeUndefined();
        });

        it('rejects unknown keys by default', async () => {
            await expect(
                validationService.validateBody({ name: 'Alice', extra: 'nope' }, bodyMeta())
            ).rejects.toThrow(ValidationError);
        });

        it('allows unknown keys when allowAdditionalProperties is true', async () => {
            await expect(
                validationService.validateBody({ name: 'Alice', extra: 'fine' }, bodyMeta({ allowAdditionalProperties: true }))
            ).resolves.toBeUndefined();
        });

        it('rejects a relation property present on the model with RelationsNotAllowedValidationProblem', async () => {
            await expect(
                validationService.validateBody(
                    { name: 'Alice', child: { id: 'x' } },
                    bodyMeta({ modelClass: Parent, allowAdditionalProperties: true })
                )
            ).rejects.toThrow(/relations are not allowed/);
        });

        it('validates a nested object property recursively', async () => {
            await expect(
                validationService.validateBody(
                    { name: 'Alice', nested: { label: 42 } },
                    bodyMeta({ modelClass: WithNested })
                )
            ).rejects.toThrow(ValidationError);
        });

        it('accepts a valid nested object property', async () => {
            await expect(
                validationService.validateBody(
                    { name: 'Alice', nested: { label: 'ok' } },
                    bodyMeta({ modelClass: WithNested })
                )
            ).resolves.toBeUndefined();
        });

        describe('array bodies', () => {
            it('rejects a non-array value when isArray is true', async () => {
                await expect(
                    validationService.validateBody({ name: 'Alice' }, bodyMeta({ isArray: true }))
                ).rejects.toThrow(ValidationError);
            });

            it('validates each item of an array body', async () => {
                await expect(
                    validationService.validateBody([{ name: 'Alice' }, { name: 42 }], bodyMeta({ isArray: true }))
                ).rejects.toThrow(ValidationError);
            });

            it('accepts a valid array body', async () => {
                await expect(
                    validationService.validateBody([{ name: 'Alice' }, { name: 'Bob' }], bodyMeta({ isArray: true }))
                ).resolves.toBeUndefined();
            });
        });

        describe('form-data bodies', () => {
            it('wraps form-data bodies in a Temp class requiring value + tempFolder', async () => {
                await expect(
                    validationService.validateBody(
                        { value: { name: 'Alice' }, tempFolder: '/tmp/upload' },
                        bodyMeta({ type: MimeType.FORM_DATA, cleanupAfterMs: 1000 })
                    )
                ).resolves.toBeUndefined();
            });

            it('rejects a form-data body missing tempFolder', async () => {
                await expect(
                    validationService.validateBody(
                        { value: { name: 'Alice' } },
                        bodyMeta({ type: MimeType.FORM_DATA, cleanupAfterMs: 1000 })
                    )
                ).rejects.toThrow(ValidationError);
            });
        });
    });

    describe('validateWebsocketRequest', () => {
        it('resolves for an empty request', async () => {
            await expect(validationService.validateWebsocketRequest({})).resolves.toBeUndefined();
        });

        it('resolves for a request with query/headers/params/body', async () => {
            await expect(
                validationService.validateWebsocketRequest({
                    query: { a: '1' },
                    headers: { 'x-request-id': 'abc' },
                    params: { id: '1' },
                    body: { anything: true }
                })
            ).resolves.toBeUndefined();
        });

        it('rejects an unknown top-level key', async () => {
            await expect(validationService.validateWebsocketRequest({ notAField: true })).rejects.toThrow(ValidationError);
        });
    });
});