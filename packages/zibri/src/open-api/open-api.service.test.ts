import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { type Relation } from 'typeorm';
import { createInMemoryDataSource } from 'zibri-testing';

import { Response } from './decorators/response.decorator';
import { OpenApiDefinition, OpenApiOperation, OpenApiReferenceObject, OpenApiSchemaObject } from './open-api.model';
import { type PaginationResult } from './pagination-result.model';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Auth } from '../auth/decorators/auth.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { XmlUtilities } from '../document/xml.utilities';
import { BaseEntity } from '../entity/base-entity.model';
import { Property } from '../entity/decorators/property.decorator';
import { type OneOf } from '../entity/models/one-of.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { HttpMethod } from '../http/http-method.enum';
import { HttpStatus } from '../http/http-status.enum';
import { KnownHeader } from '../http/known-header.enum';
import { MimeType } from '../http/mime-type.enum';
import { RedirectResponse } from '../http/redirect-response.model';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { HtmlResponse } from '../parsing/html/html-response.model';
import { XmlAttribute } from '../parsing/xml/xml-attribute.decorator';
import { XmlElement } from '../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../parsing/xml/xml-namespace.decorator';
import { XmlRoot } from '../parsing/xml/xml-root.decorator';
import { Body } from '../routing/decorators/body.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Param } from '../routing/decorators/param.decorator';
import { Post } from '../routing/decorators/post.decorator';
import { type RouterInterface } from '../routing/router.interface';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';

class Tag {
    @Property.string()
    label!: string;
}

class Item {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ regex: /^[a-z]+$/, enum: { BOOKS: 'books', TOYS: 'toys' } })
    category!: string;

    @Property.number({ min: 0, max: 1000 })
    price!: number;

    @Property.boolean()
    inStock!: boolean;

    @Property.date()
    createdAt!: Date;

    @Property.object({ cls: () => Tag, required: false })
    primaryTag?: Tag;

    @Property.array({ items: { type: 'string' } })
    labels!: string[];

    @Property.array({ items: { type: 'object', cls: () => Tag } })
    tags!: Tag[];
}

class CreateItemBody {
    @Property.string()
    name!: string;

    @Property.number({ required: false })
    quantity?: number;

    @Property.object({ cls: () => Tag })
    tag!: Tag;

    @Property.oneOf({
        shapes: { Tag: { type: 'object', cls: () => Tag }, Untagged: { type: 'string', enum: { untagged: 'untagged' } } },
        required: false,
        description: 'a tag, or none on purpose'
    })
    secondaryTag?: OneOf<{ Tag: Tag, Untagged: string }>;

    @Property.array({ items: { type: 'oneOf', shapes: { At: { type: 'date' }, Note: { type: 'string' } } }, required: false })
    schedule?: OneOf<{ At: Date, Note: string }>[];
}

// A bidirectional relation, deliberately not @Entity()-decorated/registered on a data source: the OpenAPI
// schema builder only reads @Property metadata off the class, same as validation.service.test.ts's approach.
class Pet extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => Owner, inverseSide: 'pet' })
    owner!: Relation<Owner>;
}

class Owner extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => Pet, inverseSide: 'owner' })
    pet!: Relation<Pet>;
}

// A genuine 3-hop cycle (A -> B -> C -> A) that the single-hop back-reference exclusion in
// getTargetClassForRelation cannot break (it only strips a direct back-edge to the entity one hop up, eg.
// NodeB's properties pointing at NodeA; it never sees NodeC pointing all the way back to NodeA), so resolving
// NodeC.next must legitimately hit the cycle guard.
class NodeC extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => NodeA, inverseSide: 'next' })
    next!: Relation<NodeA>;
}

class NodeB extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => NodeC, inverseSide: 'next' })
    next!: Relation<NodeC>;
}

class NodeA extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => NodeB, inverseSide: 'next' })
    next!: Relation<NodeB>;
}

class Player extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.manyToOne({ target: () => Team, inverseSide: 'players' })
    team!: Relation<Team>;
}

class Team extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Player, inverseSide: 'team' })
    players!: Relation<Player>[];
}

class PingResponse {
    @Property.boolean()
    ok!: boolean;
}

class OrderLine {
    @Property.string()
    name!: string;
}

@XmlRoot({ name: 'Order', namespace: 'urn:example:orders' })
class XmlOrder {
    @XmlAttribute('id')
    @Property.string()
    orderId!: string;

    @XmlElement('Line')
    @Property.array({ items: { type: 'object', cls: () => OrderLine } })
    lines!: OrderLine[];
}

@XmlNamespace('urn:example:header')
class XmlHeader {
    @Property.string()
    id!: string;
}

// no namespace of its own, so it is in the namespace of whichever document holds it
class XmlParty {
    @Property.string()
    name!: string;
}

@XmlRoot({
    name: 'Envelope',
    namespace: 'urn:example:envelope',
    prefixes: { e: 'urn:example:envelope', h: 'urn:example:header' }
})
class XmlEnvelope {
    @XmlAttribute()
    @Property.string()
    version!: string;

    @Property.object({ cls: () => XmlHeader })
    header!: XmlHeader;

    @XmlElement('Party')
    @Property.array({ items: { type: 'object', cls: () => XmlParty } })
    parties!: XmlParty[];
}

const envelope: XmlEnvelope = { version: '1', header: { id: 'h1' }, parties: [{ name: 'Ada' }] };

@Controller('/items')
class ItemController {
    @Auth.isLoggedIn()
    @Response.object(Item, { status: HttpStatus.OK })
    @Get('/:id')
    getOne(
        @Param.path('id', { type: 'string' })
        id: string,
        @Param.query('verbose', { type: 'boolean', required: false })
        verbose: boolean | undefined,
        @Param.header('x-request-id')
        requestId: string
    ): Item {
        void id;
        void verbose;
        void requestId;
        return {} as Item;
    }

    @Response.paginated(Item)
    @Get('/paginated')
    getPaginated(): PaginationResult<Item> {
        return {} as PaginationResult<Item>;
    }

    @Response.array(Item, { status: HttpStatus.OK })
    @Post('/')
    create(
        @Body(CreateItemBody)
        body: CreateItemBody
    ): Item[] {
        void body;
        return [];
    }

    @Response.file({ status: HttpStatus.OK })
    @Get('/download')
    download(): FileResponse {
        return FileResponse.fromStream({
            stream: FsUtilities.createReadStream('/dev/null' as FsPath),
            filename: 'item.txt',
            mimeType: 'text/plain'
        });
    }

    @Response.html({ status: HttpStatus.OK })
    @Get('/page')
    page(): HtmlResponse {
        return HtmlResponse.fromString('<h1>hi</h1>');
    }

    @Response.redirect()
    @Get('/elsewhere')
    elsewhere(): RedirectResponse {
        return RedirectResponse.to('https://example.com');
    }

    @Response.error(HttpStatus.BAD_REQUEST, { description: 'missing field' })
    @Response.error(HttpStatus.BAD_REQUEST, { description: 'invalid field' })
    @Response.object(Item, { status: HttpStatus.OK })
    @Get('/multi-status')
    multiStatus(): Item {
        return {} as Item;
    }

    @Auth.hasRole(['admin'])
    @Response.empty()
    @Get('/admin-only')
    adminOnly(): void { }

    @Auth.hasPlatformRole(['operator'])
    @Response.empty()
    @Get('/operator-only')
    operatorOnly(): void { }

    @Response.object(Owner, { status: HttpStatus.OK })
    @Get('/:id/owner')
    getOwner(
        @Param.path('id', { type: 'string' })
        id: string
    ): Owner {
        void id;
        return {} as Owner;
    }

    @Response.object(Team, { status: HttpStatus.OK })
    @Get('/:id/team')
    getTeam(
        @Param.path('id', { type: 'string' })
        id: string
    ): Team {
        void id;
        return {} as Team;
    }

    @Response.object(XmlOrder, { status: HttpStatus.OK, mimeTypes: [MimeType.JSON, MimeType.XML] })
    @Post('/orders')
    createOrder(
        @Body(XmlOrder, { type: MimeType.XML })
        order: XmlOrder
    ): XmlOrder {
        return order;
    }

    @Response.empty()
    @Post('/signed-orders')
    createSignedOrder(
        @Body({ type: MimeType.XML, raw: true })
        document: string
    ): void {
        void document;
    }

    @Response.object(XmlEnvelope, { status: HttpStatus.OK, mimeTypes: [MimeType.JSON, MimeType.XML] })
    @Get('/envelope')
    getEnvelope(): XmlEnvelope {
        return envelope;
    }

    @Response.object(NodeA, { status: HttpStatus.OK })
    @Get('/:id/chain')
    getChain(
        @Param.path('id', { type: 'string' })
        id: string
    ): NodeA {
        void id;
        return {} as NodeA;
    }
}

function schemaOf(value: OpenApiSchemaObject | OpenApiReferenceObject | undefined): OpenApiSchemaObject {
    assert(value && !('$ref' in value));
    return value;
}

// a route with no controller behind it, registered from a lifecycle hook the way AssetService
// registers /favicon.ico. It has to be an init hook rather than a line in beforeAll: the document is
// built once in afterAppInit, so a route registered after the app is up is not in it.
class ManualPingRoute implements OnAppInit {
    onAppInit(): void {
        const router: RouterInterface = inject(ZIBRI_DI_TOKENS.ROUTER);
        router.registerRoute({
            httpMethod: HttpMethod.GET,
            route: '/manual/ping',
            versions: 'all',
            openApi: {
                useInOpenApi: true,
                responses: [{ type: 'json', cls: PingResponse, isArray: false, status: HttpStatus.OK }],
                tags: ['Manual']
            },
            handler: () => ({ ok: true })
        });
    }
}

describe('OpenApiService', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let spec: OpenApiDefinition;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [ItemController],
            version: '1.0.0',
            // the document is built from declarations alone, so no store has to be running for it
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
            providers: [...defaultTestServerProviders, defineProvider({ token: ManualPingRoute, useClass: ManualPingRoute })]
        });
        baseUrl = await server.start();

        const res: globalThis.Response = await fetch(`${baseUrl}/explorer/spec/1.0.0`);
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        spec = await res.json();
    }, 25000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    /**
     * Looks up an operation in the fetched spec, asserting it exists.
     * @param path - The OpenAPI path key (with `{param}` placeholders).
     * @param method - The HTTP method key, eg. 'get' or 'post'.
     * @returns The operation object.
     */
    function op(path: string, method: 'get' | 'post'): OpenApiOperation {
        // eslint-disable-next-line typescript/typedef
        const pathItem = spec.paths?.[path];
        assert(pathItem);
        // eslint-disable-next-line typescript/typedef
        const operation = pathItem[method];
        assert(operation);
        return operation;
    }

    it('sets the openapi version, title and tags', () => {
        expect(spec.openapi).toBe('3.1.0');
        expect(spec.info.title).toContain('Explorer');
        expect(spec.tags).toEqual(expect.arrayContaining([{ name: 'ItemController' }]));
    });

    it('registers a security scheme per auth strategy', () => {
        expect(spec.components?.securitySchemes).toBeDefined();
        expect(Object.keys(spec.components?.securitySchemes ?? {}).length).toBeGreaterThan(0);
    });

    it('resolves path, query and header parameters with their types and required flags', () => {
        const operation: OpenApiOperation = op('/items/{id}', 'get');
        expect(operation.parameters).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', in: 'path', schema: expect.objectContaining({ type: 'string' }) }),
            expect.objectContaining({ name: 'verbose', in: 'query', required: false, schema: expect.objectContaining({ type: 'boolean' }) }),
            expect.objectContaining({ name: 'x-request-id', in: 'header', required: true })
        ]));
    });

    it('requires security for a route behind @Auth.isLoggedIn()', () => {
        const operation: OpenApiOperation = op('/items/{id}', 'get');
        expect(operation.security).toBeDefined();
        expect(operation.security?.length).toBeGreaterThan(0);
    });

    it('does not require security for a route without auth metadata', () => {
        const operation: OpenApiOperation = op('/items/download', 'get');
        expect(operation.security).toBeUndefined();
    });

    it('exposes allowed roles via x-roles for a route behind @Auth.hasRole()', () => {
        const operation: OpenApiOperation = op('/items/admin-only', 'get');
        expect(operation['x-roles']).toEqual(['admin']);
        expect(operation['x-platform-roles']).toBeUndefined();
    });

    it('exposes the roles of the user\'s own via x-platform-roles for a route behind @Auth.hasPlatformRole()', () => {
        const operation: OpenApiOperation = op('/items/operator-only', 'get');
        expect(operation['x-platform-roles']).toEqual(['operator']);
        expect(operation['x-roles']).toBeUndefined();
        expect(operation.security).toBeDefined();
    });

    it('resolves a hasOne relation schema, excluding the inverse back-reference key', () => {
        const operation: OpenApiOperation = op('/items/{id}/owner', 'get');
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const schema: OpenApiSchemaObject = schemaOf(operation.responses?.['200']?.content?.[MimeType.JSON]?.schema);
        expect(schema.properties?.['pet']).toMatchObject({
            type: 'object',
            properties: { name: { type: 'string' } }
        });
        // the inverse side ("owner") must be excluded to avoid an infinite back-reference
        expect(schemaOf(schema.properties?.['pet']).properties?.['owner']).toBeUndefined();
    });

    it('resolves a oneToMany relation as an array of the target entity schema', () => {
        const operation: OpenApiOperation = op('/items/{id}/team', 'get');
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const schema: OpenApiSchemaObject = schemaOf(operation.responses?.['200']?.content?.[MimeType.JSON]?.schema);
        expect(schema.properties?.['players']).toMatchObject({
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string' } } }
        });
        // the inverse side ("team") must be excluded to avoid an infinite back-reference
        expect(schemaOf(schemaOf(schema.properties?.['players']).items).properties?.['team']).toBeUndefined();
    });

    it('still omits a genuine multi-hop cycle (A -> B -> C -> A) that back-reference exclusion cannot break', () => {
        const operation: OpenApiOperation = op('/items/{id}/chain', 'get');
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const schema: OpenApiSchemaObject = schemaOf(operation.responses?.['200']?.content?.[MimeType.JSON]?.schema);
        const nodeB: OpenApiSchemaObject = schemaOf(schema.properties?.['next']);
        expect(nodeB.properties?.['name']).toMatchObject({ type: 'string' });
        const nodeC: OpenApiSchemaObject = schemaOf(nodeB.properties?.['next']);
        expect(nodeC.properties?.['name']).toMatchObject({ type: 'string' });
        // nodeC.next points back to NodeA, which is already on the recursion stack — genuinely circular
        const backToNodeA: OpenApiSchemaObject = schemaOf(nodeC.properties?.['next']);
        expect(backToNodeA).toEqual({ type: 'object', description: 'Circular reference omitted' });
    });

    it('builds a response schema with primitive, enum, regex, nested object and array properties', () => {
        const operation: OpenApiOperation = op('/items/{id}', 'get');
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const schema: OpenApiSchemaObject = schemaOf(operation.responses?.['200']?.content?.[MimeType.JSON]?.schema);
        expect(schema.type).toBe('object');
        expect(schema.properties?.['category']).toMatchObject({ type: 'string', enum: ['books', 'toys'] });
        expect(schemaOf(schema.properties?.['category']).pattern).toBeTruthy();
        expect(schema.properties?.['price']).toMatchObject({ type: 'number', minimum: 0, maximum: 1000 });
        expect(schema.properties?.['primaryTag']).toMatchObject({ type: 'object', properties: { label: { type: 'string' } } });
        expect(schema.properties?.['labels']).toMatchObject({ type: 'array', items: { type: 'string' } });
        // Tag is also described by primaryTag right before, which is no cycle
        expect(schema.properties?.['tags']).toMatchObject({ type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } });
    });

    it('describes a property with what openapi defines, and nothing only the framework reads', () => {
        const operation: OpenApiOperation = op('/items/{id}', 'get');
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const schema: OpenApiSchemaObject = schemaOf(operation.responses?.['200']?.content?.[MimeType.JSON]?.schema);

        // `primary` is a storage fact, and a regex is a pattern without the slashes that delimit it
        expect(schema.properties?.['id']).toStrictEqual({ type: 'string', format: 'uuid' });
        expect(schema.properties?.['category']).toStrictEqual({ type: 'string', pattern: '^[a-z]+$', enum: ['books', 'toys'] });
        expect(schema.properties?.['price']).toStrictEqual({ type: 'number', format: 'double', minimum: 0, maximum: 1000 });
        expect(schema.properties?.['inStock']).toStrictEqual({ type: 'boolean' });
    });

    it('describes a parameter without repeating its name inside its schema', () => {
        const operation: OpenApiOperation = op('/items/{id}', 'get');
        const parameterSchemas: unknown[] = (operation.parameters ?? []).map(p => 'schema' in p ? p.schema : undefined);

        for (const parameterSchema of parameterSchemas) {
            expect(parameterSchema).not.toHaveProperty('name');
            expect(parameterSchema).not.toHaveProperty('required');
        }
    });

    it('builds an array response schema for @Response.array()', () => {
        const operation: OpenApiOperation = op('/items/', 'post');
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const schema: OpenApiSchemaObject = schemaOf(operation.responses?.['200']?.content?.[MimeType.JSON]?.schema);
        expect(schema.type).toBe('array');
        expect(schemaOf(schema.items).type).toBe('object');
    });

    it('builds an items/totalAmount envelope schema for @Response.paginated()', () => {
        const operation: OpenApiOperation = op('/items/paginated', 'get');
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const schema: OpenApiSchemaObject = schemaOf(operation.responses?.['200']?.content?.[MimeType.JSON]?.schema);
        expect(schema.type).toBe('object');
        expect(schema.properties?.['totalAmount']).toMatchObject({ type: 'integer', format: 'int64' });
        const items: OpenApiSchemaObject = schemaOf(schema.properties?.['items']);
        expect(items.type).toBe('array');
        expect(schemaOf(items.items).type).toBe('object');
    });

    it('builds no content for @Response.empty(), under the status it defaults to', () => {
        const operation: OpenApiOperation = op('/items/admin-only', 'get');
        // 204 rather than 200: a route that returns nothing says so, and the document has to agree
        // with what the router actually answers
        expect(operation.responses?.['204']).toBeDefined();
        // eslint-disable-next-line typescript/no-unsafe-member-access
        expect(operation.responses?.['204']?.content).toBeUndefined();
    });

    it('builds a request body schema with a nested object property and a required list', () => {
        const operation: OpenApiOperation = op('/items/', 'post');
        assert(operation.requestBody && !('$ref' in operation.requestBody));
        const schema: OpenApiSchemaObject = schemaOf(operation.requestBody.content[MimeType.JSON]?.schema);
        expect(schema.required).toEqual(expect.arrayContaining(['name', 'tag']));
        expect(schema.required).not.toContain('quantity');
        expect(schema.properties?.['tag']).toMatchObject({ type: 'object', properties: { label: { type: 'string' } } });
    });

    it('describes a value of several named shapes as exactly one of them, told apart by its name', () => {
        const operation: OpenApiOperation = op('/items/', 'post');
        assert(operation.requestBody && !('$ref' in operation.requestBody));
        const schema: OpenApiSchemaObject = schemaOf(operation.requestBody.content[MimeType.JSON]?.schema);

        expect(schema.properties?.['secondaryTag']).toEqual({
            description: 'a tag, or none on purpose',
            discriminator: { propertyName: 'shape' },
            oneOf: [
                {
                    type: 'object',
                    properties: {
                        shape: { type: 'string', enum: ['Tag'] },
                        value: expect.objectContaining({ type: 'object', properties: { label: expect.objectContaining({ type: 'string' }) } })
                    },
                    required: ['shape', 'value']
                },
                {
                    type: 'object',
                    properties: {
                        shape: { type: 'string', enum: ['Untagged'] },
                        value: expect.objectContaining({ type: 'string', enum: ['untagged'] })
                    },
                    required: ['shape', 'value']
                }
            ]
        });
        expect(schema.required).not.toContain('secondaryTag');
        expect(schema.properties?.['schedule']).toMatchObject({
            type: 'array',
            items: {
                discriminator: { propertyName: 'shape' },
                oneOf: [
                    { properties: { shape: { enum: ['At'] }, value: { type: 'string', format: 'date-time' } } },
                    { properties: { shape: { enum: ['Note'] }, value: { type: 'string' } } }
                ]
            }
        });
    });

    it('describes a response that can be json or xml under both, the xml one naming its root', () => {
        const operation: OpenApiOperation = op('/items/orders', 'post');
        // eslint-disable-next-line typescript/typedef, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
        const content = operation.responses?.['200']?.content;
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const json: OpenApiSchemaObject = schemaOf(content?.[MimeType.JSON]?.schema);
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const xml: OpenApiSchemaObject = schemaOf(content?.[MimeType.XML]?.schema);

        expect(json.xml).toBeUndefined();
        expect(xml.xml).toEqual({ name: 'Order', namespace: 'urn:example:orders' });
        expect(xml.properties?.['orderId']).toMatchObject({ type: 'string', xml: { name: 'id', attribute: true } });
        expect(xml.properties?.['lines']).toMatchObject({ type: 'array', items: { xml: { name: 'Line' } } });
    });

    it('names the namespace of every element a prefixed root puts in one, as the document is written', async () => {
        const operation: OpenApiOperation = op('/items/envelope', 'get');
        // eslint-disable-next-line typescript/typedef, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
        const content = operation.responses?.['200']?.content;
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const json: OpenApiSchemaObject = schemaOf(content?.[MimeType.JSON]?.schema);
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const xml: OpenApiSchemaObject = schemaOf(content?.[MimeType.XML]?.schema);
        const envelopeNamespace: { namespace: string, prefix: string } = { namespace: 'urn:example:envelope', prefix: 'e' };
        const header: OpenApiSchemaObject = schemaOf(xml.properties?.['header']);
        const parties: OpenApiSchemaObject = schemaOf(xml.properties?.['parties']);

        expect(xml.xml).toEqual({ name: 'Envelope', ...envelopeNamespace });
        // an attribute is in no namespace
        expect(xml.properties?.['version']).toMatchObject({ xml: { name: 'version', attribute: true } });
        expect(xml.properties?.['version']).not.toHaveProperty('xml.namespace');
        // declared by the root, so in the root's namespace, while what it holds is in the header's
        expect(header.xml).toEqual(envelopeNamespace);
        expect(schemaOf(header.properties?.['id']).xml).toEqual({ namespace: 'urn:example:header', prefix: 'h' });
        // a list is its items repeated, and a model without a namespace is in the document's
        expect(parties.xml).toBeUndefined();
        expect(schemaOf(parties.items).xml).toEqual({ name: 'Party', ...envelopeNamespace });
        expect(schemaOf(schemaOf(parties.items).properties?.['name']).xml).toEqual(envelopeNamespace);
        // the json schema describes the same model and is left as it is
        expect(schemaOf(json.properties?.['header']).xml).toBeUndefined();
        expect(schemaOf(schemaOf(json.properties?.['header']).properties?.['id']).xml).toBeUndefined();

        // and it is what the document actually holds
        expect(await XmlUtilities.generateFrom(XmlEnvelope, envelope)).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<e:Envelope xmlns:e="urn:example:envelope" xmlns:h="urn:example:header" version="1">',
            '<e:header><h:id>h1</h:id></e:header>',
            '<e:Party><e:name>Ada</e:name></e:Party>',
            '</e:Envelope>'
        ].join(''));
    });

    it('describes an xml request body as the document of its model', () => {
        const operation: OpenApiOperation = op('/items/orders', 'post');
        assert(operation.requestBody && !('$ref' in operation.requestBody));

        const schema: OpenApiSchemaObject = schemaOf(operation.requestBody.content[MimeType.XML]?.schema);

        expect(schema.xml).toEqual({ name: 'Order', namespace: 'urn:example:orders' });
        expect(schema.properties?.['orderId']).toMatchObject({ xml: { name: 'id', attribute: true } });
    });

    it('describes an xml request body declared raw as a document of text', () => {
        const operation: OpenApiOperation = op('/items/signed-orders', 'post');
        assert(operation.requestBody && !('$ref' in operation.requestBody));

        expect(schemaOf(operation.requestBody.content[MimeType.XML]?.schema)).toMatchObject({ type: 'string' });
    });

    it('builds a binary schema for a file response', () => {
        const operation: OpenApiOperation = op('/items/download', 'get');
        // eslint-disable-next-line typescript/typedef, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
        const content = operation.responses?.['200']?.content;
        // eslint-disable-next-line typescript/no-unsafe-member-access
        expect(content?.[MimeType.OCTET_STREAM]?.schema).toEqual({ type: 'string', format: 'binary' });
    });

    it('builds an html schema for an html response', () => {
        const operation: OpenApiOperation = op('/items/page', 'get');
        // eslint-disable-next-line typescript/typedef, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access
        const content = operation.responses?.['200']?.content;
        // eslint-disable-next-line typescript/no-unsafe-member-access
        expect(content?.[MimeType.HTML]?.schema).toEqual({ type: 'string', format: 'html' });
    });

    it('describes a redirect response by its status and location, without content', () => {
        const operation: OpenApiOperation = op('/items/elsewhere', 'get');
        expect(operation.responses?.['303']).toEqual({
            description: '',
            content: undefined,
            headers: { [KnownHeader.LOCATION]: { schema: { type: 'string', format: 'uri' } } }
        });
    });

    it('merges multiple responses declared for the same status into a oneOf schema', () => {
        const operation: OpenApiOperation = op('/items/multi-status', 'get');
        // eslint-disable-next-line typescript/typedef, typescript/no-unsafe-assignment
        const badRequest = operation.responses?.['400'];
        // eslint-disable-next-line typescript/strict-boolean-expressions
        assert(badRequest && !('$ref' in badRequest));
        // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
        const schema: OpenApiSchemaObject = schemaOf(badRequest.content?.[MimeType.JSON]?.schema);
        expect(schema.oneOf).toBeDefined();
    });

    it('includes a manually registered route marked useInOpenApi: true', () => {
        const operation: OpenApiOperation = op('/manual/ping', 'get');
        expect(operation.tags).toEqual(['Manual']);
        // eslint-disable-next-line typescript/no-unsafe-member-access
        expect(operation.responses?.['200']?.content?.[MimeType.JSON]?.schema).toMatchObject({
            type: 'object',
            properties: { ok: { type: 'boolean' } }
        });
    });

    it('returns 404 for an unknown version', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/explorer/spec/9.9.9`);
        expect(res.status).toBe(404);
    });

    it('serves the explorer HTML page', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/explorer`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        const html: string = await res.text();
        expect(html).toContain('swagger-ui-init.js');
    });

    it('serves the generated swagger-ui-init.js referencing the registered version', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/explorer/swagger-ui-init.js`);
        expect(res.status).toBe(200);
        const js: string = await res.text();
        expect(js).toContain('/explorer/spec/1.0.0');
    });

    it('serves the generated custom.js', async () => {
        const res: globalThis.Response = await fetch(`${baseUrl}/explorer/custom.js`);
        expect(res.status).toBe(200);
        const js: string = await res.text();
        expect(js).toContain('zibri-openapi-logo');
    });
});