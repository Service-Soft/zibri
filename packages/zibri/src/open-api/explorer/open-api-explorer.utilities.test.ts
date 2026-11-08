import { describe, expect, it } from '@jest/globals';

import { OpenApiExplorerTag } from './open-api-explorer-operation.model';
import { OpenApiExplorerUtilities } from './open-api-explorer.utilities';
import { OpenApiDefinition, OpenApiSchemaObject } from '../open-api.model';

// a document written by hand, as an application overriding createOpenApiDefinition hands one over: with references,
// which the documents zibri builds never hold
const definition: OpenApiDefinition = {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    tags: [{ name: 'pets', description: 'The pets' }, { name: 'unused' }],
    security: [{ token: [] }],
    components: {
        securitySchemes: {
            token: { type: 'http', scheme: 'bearer' },
            alias: { $ref: '#/components/securitySchemes/token' }
        },
        parameters: {
            petId: { name: 'petId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        },
        schemas: {
            Pet: {
                type: 'object',
                required: ['name'],
                properties: {
                    id: { type: 'string', readOnly: true },
                    name: { type: 'string', example: 'Rex' },
                    password: { type: 'string', writeOnly: true },
                    kind: { type: ['string', 'null'], enum: ['dog', 'cat', null] },
                    parent: { $ref: '#/components/schemas/Pet' },
                    tags: { type: 'array', items: { $ref: '#/components/schemas/Tag' }, xml: { wrapped: true, name: 'tags' } },
                    born: { type: 'string', format: 'date' }
                },
                xml: { name: 'pet' }
            },
            Tag: { type: 'object', properties: { label: { type: 'string', xml: { attribute: true } } }, xml: { name: 'tag' } },
            Loop: { $ref: '#/components/schemas/Loop' }
        }
    },
    paths: {
        '/pets/{petId}': {
            parameters: [
                { $ref: '#/components/parameters/petId' },
                { name: 'verbose', in: 'query', schema: { type: 'boolean' }, description: 'of the path' }
            ],
            get: {
                tags: ['pets'],
                parameters: [{ name: 'verbose', in: 'query', schema: { type: 'boolean', default: true }, description: 'of the operation' }],
                responses: {
                    default: { description: 'Something went wrong' },
                    200: { description: 'The pet', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } }
                }
            },
            put: {
                tags: ['pets'],
                security: [],
                requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
                responses: { 204: { description: 'Saved' } }
            }
        },
        '/health': {
            get: { responses: { 200: { description: 'Up' } } }
        }
    }
};

describe('OpenApiExplorerUtilities', () => {
    it('groups the operations by tag, the listed ones first, and those without one under default', () => {
        const tags: OpenApiExplorerTag[] = OpenApiExplorerUtilities.resolveTags(definition);

        expect(tags.map(tag => [tag.name, tag.description, tag.operations.map(operation => operation.id)])).toEqual([
            ['pets', 'The pets', ['pets-get--pets-petId-', 'pets-put--pets-petId-']],
            ['default', undefined, ['default-get--health']]
        ]);
    });

    it('takes the parameters of the path, an operation\'s own of the same name in their place', () => {
        const [pets] = OpenApiExplorerUtilities.resolveTags(definition);

        expect(pets?.operations[0]?.parameters).toEqual([
            { name: 'verbose', in: 'query', schema: { type: 'boolean', default: true }, description: 'of the operation' },
            { name: 'petId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
        ]);
    });

    it('names the schemes of an operation from the document, and none where it says so itself', () => {
        const [pets] = OpenApiExplorerUtilities.resolveTags(definition);

        expect(pets?.operations.map(operation => operation.securitySchemes)).toEqual([['token'], []]);
        expect(OpenApiExplorerUtilities.resolveSecuritySchemes(definition)).toEqual([
            { name: 'token', scheme: { type: 'http', scheme: 'bearer' } },
            { name: 'alias', scheme: { type: 'http', scheme: 'bearer' } }
        ]);
    });

    it('orders the responses by status, default last', () => {
        const [pets] = OpenApiExplorerUtilities.resolveTags(definition);

        expect(pets?.operations[0]?.responses.map(response => response.status)).toEqual(['200', 'default']);
    });

    it('names the type of a schema', () => {
        const pet: OpenApiSchemaObject = OpenApiExplorerUtilities.resolveSchema(definition, { $ref: '#/components/schemas/Pet' });
        const typeOf: (key: string) => string = key => OpenApiExplorerUtilities.resolveTypeName(definition, pet.properties?.[key] ?? {});

        expect(OpenApiExplorerUtilities.resolveTypeName(definition, { $ref: '#/components/schemas/Pet' })).toBe('Pet');
        expect(typeOf('kind')).toBe('string | null');
        expect(typeOf('tags')).toBe('Tag[]');
        expect(typeOf('born')).toBe('string (date)');
    });

    it('builds an example of a request without what is read only, and stops where a schema refers to itself', () => {
        const example: unknown = OpenApiExplorerUtilities.resolveExample(definition, { $ref: '#/components/schemas/Pet' }, 'request');

        expect(example).toEqual({
            name: 'Rex',
            password: 'string',
            kind: 'dog',
            tags: [{ label: 'string' }],
            born: new Date().toISOString().slice(0, 10)
        });
    });

    it('builds an example of a response without what is write only', () => {
        const example: unknown = OpenApiExplorerUtilities.resolveExample(definition, { $ref: '#/components/schemas/Pet' }, 'response');

        expect(example).toMatchObject({ id: 'string', name: 'Rex' });
        expect(example).not.toHaveProperty('password');
    });

    it('builds an xml example, a wrapped list inside an element of its own and an attribute on its element', () => {
        const example: string = OpenApiExplorerUtilities.resolveXmlExample(definition, { $ref: '#/components/schemas/Pet' });

        expect(example).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<pet>',
            '    <name>Rex</name>',
            '    <password>string</password>',
            '    <kind>dog</kind>',
            '    <tags>',
            '        <tag label="string"/>',
            '    </tags>',
            `    <born>${new Date().toISOString().slice(0, 10)}</born>`,
            '</pet>'
        ].join('\n'));
    });

    it('takes the example a media type or a parameter states over one built from the schema', () => {
        expect(OpenApiExplorerUtilities.resolveContentExample(definition, 'application/json', { example: { name: 'Bella' } }, 'request'))
            .toBe('{\n  "name": "Bella"\n}');
        expect(OpenApiExplorerUtilities.resolveContentExample(definition, 'text/plain', { examples: { first: { value: 'hello' } } }, 'request'))
            .toBe('hello');
        expect(OpenApiExplorerUtilities.resolveParameterValue(definition, { name: 'ids', in: 'query', example: ['a', 'b'] })).toBe('a,b');
        expect(OpenApiExplorerUtilities.resolveParameterValue(definition, { name: 'verbose', in: 'query', schema: { type: 'boolean', default: true } }))
            .toBe('true');
    });

    it('names a reference the document cannot resolve, and one that refers to itself', () => {
        expect(() => OpenApiExplorerUtilities.resolveSchema(definition, { $ref: '#/components/schemas/Missing' }))
            .toThrow('The OpenAPI document refers to "#/components/schemas/Missing", which is none of its components.schemas.');
        expect(() => OpenApiExplorerUtilities.resolveSchema(definition, { $ref: 'https://example.com/pet.json' }))
            .toThrow('The OpenAPI document refers to "https://example.com/pet.json", which is none of its components.schemas.');
        expect(() => OpenApiExplorerUtilities.resolveSchema(definition, { $ref: '#/components/schemas/Loop' }))
            .toThrow('The OpenAPI document refers from "#/components/schemas/Loop" to itself');
    });
});
