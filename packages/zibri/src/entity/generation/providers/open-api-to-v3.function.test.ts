import { describe, expect, it } from 'vitest';

import { OpenApiConvertUtilities } from './open-api-convert.utilities.ts';
import { OpenApiDefinition } from '../../../open-api/open-api.model.ts';

describe('OpenApiConvertUtilities.toV3', () => {
    it('throws when given a non-object document', async () => {
        await expect(OpenApiConvertUtilities.toV3(undefined)).rejects.toThrow('Invalid OpenAPI document');
        await expect(OpenApiConvertUtilities.toV3('not a spec')).rejects.toThrow('Invalid OpenAPI document');
        await expect(OpenApiConvertUtilities.toV3(42)).rejects.toThrow('Invalid OpenAPI document');
    });

    it('throws when given an array', async () => {
        await expect(OpenApiConvertUtilities.toV3([])).rejects.toThrow('Invalid OpenAPI document');
    });

    it('converts a swagger 2.0 document to openapi 3.1', async () => {
        const spec: unknown = {
            swagger: '2.0',
            info: { title: 'legacy', version: '1.0' },
            paths: {
                '/pets': {
                    get: {
                        responses: {
                            200: { description: 'ok' }
                        }
                    }
                }
            },
            definitions: {
                Pet: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' }
                    }
                }
            }
        };

        const res: OpenApiDefinition = await OpenApiConvertUtilities.toV3(spec);

        expect(res.openapi).toBe('3.1.0');
        expect(res.info).toEqual({ title: 'legacy', version: '1.0' });
        expect(res.paths?.['/pets']?.get).toBeDefined();
        expect(res.components?.schemas?.['Pet']).toBeDefined();
    });

    it('passes an openapi 3.1 document through unchanged', async () => {
        const spec: OpenApiDefinition = {
            openapi: '3.1.0',
            info: { title: 'test', version: '1.0' },
            paths: {}
        };

        const res: OpenApiDefinition = await OpenApiConvertUtilities.toV3(spec);

        expect(res).toBe(spec);
    });

    it('upgrades an openapi 3.0 document to 3.1 while preserving the rest of the spec', async () => {
        const spec: OpenApiDefinition = {
            openapi: '3.0.3',
            info: { title: 'test', version: '1.0' },
            paths: {
                '/pets': {
                    get: {
                        responses: {
                            200: { description: 'ok' }
                        }
                    }
                }
            }
        };

        const res: OpenApiDefinition = await OpenApiConvertUtilities.toV3(spec);

        expect(res.openapi).toBe('3.1.0');
        expect(res.info).toEqual(spec.info);
        expect(res.paths).toEqual(spec.paths);
    });

    it('throws for an unsupported openapi version', async () => {
        const spec: unknown = {
            openapi: '2.0.0',
            info: { title: 'test', version: '1.0' },
            paths: {}
        };

        await expect(OpenApiConvertUtilities.toV3(spec)).rejects.toThrow('Unsupported OpenAPI version');
    });

    it('throws when neither "swagger" nor a recognizable "openapi" field is present', async () => {
        await expect(OpenApiConvertUtilities.toV3({ info: { title: 'test', version: '1.0' } })).rejects.toThrow('Unsupported OpenAPI version');
    });
});