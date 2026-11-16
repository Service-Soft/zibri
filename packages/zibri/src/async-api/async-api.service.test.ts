import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { io, Socket } from 'socket.io-client';
import { createInMemoryDataSource } from 'zibri-testing';

import { AsyncApiDefinition, AsyncApiMessage, AsyncApiServer } from './async-api.model';
import { $ts } from '../localization/translate.function';
import { AsyncApiExplorerOperation, AsyncApiExplorerTag } from './explorer/async-api-explorer-operation.model';
import { AsyncApiExplorerUtilities } from './explorer/async-api-explorer.utilities';
import { TestTimeouts } from '../__testing__/constants';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Auth } from '../auth/decorators/auth.decorator';
import { AuthStrategyInterface } from '../auth/strategies/auth-strategy.interface';
import { CredentialEntity } from '../auth/strategies/credential-entity.model';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { defineProvider, DiProvider } from '../di/models/di-provider.model';
import { Property } from '../entity/decorators/property.decorator';
import { MimeType } from '../http/mime-type.enum';
import { Response } from '../open-api/decorators/response.decorator';
import { OpenApiExplorerUtilities } from '../open-api/explorer/open-api-explorer.utilities';
import { OpenApiSecuritySchemeObject } from '../open-api/open-api.model';
import { XmlRoot } from '../parsing/xml/xml-root.decorator';
import { Ms } from '../utilities/ms';
import { WebsocketBody } from '../websocket/decorators/websocket-body.decorator';
import { WebsocketController } from '../websocket/decorators/websocket-controller.decorator';
import { WebsocketRoute } from '../websocket/decorators/websocket-route.decorator';
import { WebsocketMessage } from '../websocket/models/websocket-message.model';
import { WebsocketOptionsInput } from '../websocket/models/websocket-options.model';

class ChatMessage {
    @Property.string()
    text!: string;
}

@XmlRoot({ name: 'Note', namespace: 'urn:example:notes' })
class Note {
    @Property.string()
    title!: string;
}

@WebsocketController({ allowOrphan: true, eventPrefix: 'chat:' })
class ChatWebsocketController {
    @Response.object(ChatMessage)
    @WebsocketRoute('send')
    send(@WebsocketBody(ChatMessage) message: ChatMessage): ChatMessage {
        return message;
    }

    @Response.object(Note)
    @WebsocketRoute('note')
    note(@WebsocketBody(Note, { type: MimeType.XML }) note: Note): Note {
        return note;
    }

    @Auth.isLoggedIn()
    @WebsocketRoute('history')
    history(): ChatMessage[] {
        return [];
    }
}

/**
 * A strategy that accepts the tokens of an OAuth2 provider, for the scheme it names. It recognizes no
 * request, as only its scheme is looked at.
 */
class ProviderTokenAuthStrategy implements AuthStrategyInterface<string, JwtUser> {

    readonly name: string = 'provider-token';

    readonly credentialEntities: CredentialEntity[] = [];

    // the extension beside the flows is what AsyncAPI has no place for
    readonly securityScheme: OpenApiSecuritySchemeObject = {
        type: 'oauth2',
        flows: {
            clientCredentials: {
                tokenUrl: 'https://auth.example.com/token',
                scopes: { 'tasks:read': 'Read the tasks' }
            },
            authorizationCode: {
                authorizationUrl: 'https://auth.example.com/authorize',
                tokenUrl: 'https://auth.example.com/token',
                scopes: {}
            },
            'x-provider': { name: 'example' }
        }
    };

    hasCredential(): boolean {
        return false;
    }

    // eslint-disable-next-line typescript/require-await
    async resolveUser(): Promise<undefined> {
        return undefined;
    }

    // eslint-disable-next-line typescript/require-await
    async resolveAuthenticatedAt(): Promise<undefined> {
        return undefined;
    }

    // eslint-disable-next-line typescript/require-await
    async resolveExpiresAt(): Promise<undefined> {
        return undefined;
    }
}

const websocketOptions: WebsocketOptionsInput = {
    messageRetentionInMs: Ms.DAY,
    timeoutInMs: 5000,
    handlerTimeoutInMs: 5000,
    isAllowedToConnect: () => true
};

const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders,
    defineProvider({ token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT, useValue: websocketOptions })
];

describe('AsyncApiService', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let definition: AsyncApiDefinition;
    const clients: Socket[] = [];

    beforeAll(async () => {
        server = await startTestServer({
            version: '1.0.0',
            websocketControllers: [ChatWebsocketController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true })],
            providers
        });
        baseUrl = await server.start();
        const res: globalThis.Response = await fetch(`${baseUrl}/explorer/asyncapi/1.0.0`);
        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        definition = await res.json();
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        for (const client of clients.splice(0)) {
            client.disconnect();
        }
    });

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    async function connectClient(): Promise<Socket> {
        return await new Promise<Socket>((resolve, reject) => {
            const socket: Socket = io(baseUrl);
            clients.push(socket);
            socket.once('connect', () => resolve(socket));
            socket.once('connect_error', reject);
        });
    }

    function operation(address: string): AsyncApiExplorerOperation {
        const found: AsyncApiExplorerOperation | undefined = AsyncApiExplorerUtilities.resolveTags(definition)
            .flatMap(tag => tag.operations)
            .find(candidate => candidate.address === address);
        if (found == undefined) {
            throw new Error(`no operation on ${address}`);
        }
        return found;
    }

    function exampleOf(message: AsyncApiMessage | undefined, direction: 'request' | 'response'): unknown {
        if (message?.payload == undefined) {
            throw new Error('a message without a payload');
        }
        return JSON.parse(OpenApiExplorerUtilities.resolveContentExample(definition, MimeType.JSON, { schema: message.payload }, direction));
    }

    it('describes every websocket event as a channel the application receives on, with the server a client connects to', () => {
        expect(definition.asyncapi).toBe('3.0.0');
        expect(definition.info).toEqual({ title: expect.any(String), version: '1.0.0' });
        expect(Object.values(definition.channels ?? {}).map(channel => channel.address)
            .sort())
            .toEqual(['chat:history', 'chat:note', 'chat:send', 'ws:replay-incomplete']);
        expect(definition.servers?.['application']).toMatchObject({ protocol: expect.stringMatching(/^wss?$/), pathname: '/socket.io' });
    });

    it('groups the operations by controller, and names what a client logs in with where an event requires a login', () => {
        const tags: AsyncApiExplorerTag[] = AsyncApiExplorerUtilities.resolveTags(definition);
        const schemes: string[] = Object.keys(definition.components?.securitySchemes ?? {});

        expect(tags.map(tag => tag.name)).toEqual(['ChatWebsocketController', 'Reconnecting']);
        expect(operation('chat:send')).toMatchObject({ action: 'receive', securitySchemes: [] });
        expect(operation('chat:history').securitySchemes).toEqual(schemes);
        expect(schemes.length).toBeGreaterThan(0);
        expect(operation('ws:replay-incomplete')).toMatchObject({ action: 'send', replies: [] });
    });

    it('builds an example of a message the route accepts, and answers it the way the answer is described', async () => {
        const send: AsyncApiExplorerOperation = operation('chat:send');
        const socket: Socket = await connectClient();

        const answer: WebsocketMessage = await socket.timeout(5000).emitWithAck('chat:send', exampleOf(send.messages[0], 'request')) as WebsocketMessage;

        expect(answer).toMatchObject({ ok: true, status: 200, data: { text: 'string' } });
        // the answer has every field the example of the described answer has
        const described: Record<string, unknown> = exampleOf(send.replies[0], 'response') as Record<string, unknown>;
        expect(Object.keys(answer)).toEqual(expect.arrayContaining(Object.keys(described)));
        expect(described['data']).toEqual({ text: 'string' });
    }, 15000);

    it('builds an example of a message with an xml body as the text of its document, which the route reads', async () => {
        const note: AsyncApiExplorerOperation = operation('chat:note');
        const example: unknown = exampleOf(note.messages[0], 'request');
        const socket: Socket = await connectClient();

        const answer: WebsocketMessage = await socket.timeout(5000).emitWithAck('chat:note', example) as WebsocketMessage;

        expect(example).toMatchObject({
            body: '<?xml version="1.0" encoding="UTF-8"?>\n<Note xmlns="urn:example:notes">\n    <title>string</title>\n</Note>'
        });
        expect(answer).toMatchObject({ ok: true, data: { title: 'string' } });
    }, 15000);

    it('answers with a 404 for a version the application does not have', async () => {
        expect((await fetch(`${baseUrl}/explorer/asyncapi/9.9.9`)).status).toBe(404);
    });
});

describe('AsyncApiService with the servers an application names', () => {
    it('names them instead of the application itself', async () => {
        // a factory, as $ts needs the application started
        const servers: () => Record<string, AsyncApiServer> = () => ({
            production: { host: 'api.example.com', protocol: 'wss', pathname: '/socket.io', description: $ts`Production` }
        });
        const server: StartedTestServer = await startTestServer({
            version: '1.0.0',
            websocketControllers: [ChatWebsocketController],
            // orphan allowed, since the suite above boots a server of its own while this class exists
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true })],
            providers: [...providers, defineProvider({ token: ZIBRI_DI_TOKENS.ASYNC_API_SERVERS, useFactory: servers })]
        });
        try {
            const baseUrl: string = await server.start();
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const definition: AsyncApiDefinition = await (await fetch(`${baseUrl}/explorer/asyncapi/1.0.0`)).json();

            expect(definition.servers).toEqual(servers());
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});

describe('AsyncApiService with an oauth2 strategy', () => {
    it('names each flow of its scheme, with the description of each scope', async () => {
        const server: StartedTestServer = await startTestServer({
            version: '1.0.0',
            websocketControllers: [ChatWebsocketController],
            authStrategies: [JwtAuthStrategy, ProviderTokenAuthStrategy],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true })],
            providers
        });
        try {
            const baseUrl: string = await server.start();
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const definition: AsyncApiDefinition = await (await fetch(`${baseUrl}/explorer/asyncapi/1.0.0`)).json();

            expect(definition.components?.securitySchemes?.['provider-token']).toEqual({
                type: 'oauth2',
                flows: {
                    clientCredentials: { tokenUrl: 'https://auth.example.com/token', availableScopes: { 'tasks:read': 'Read the tasks' } },
                    authorizationCode: {
                        authorizationUrl: 'https://auth.example.com/authorize',
                        tokenUrl: 'https://auth.example.com/token',
                        availableScopes: {}
                    }
                }
            });
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});