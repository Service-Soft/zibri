import { AsyncApiServiceInterface } from './async-api-service.interface';
import { AsyncApiChannel, AsyncApiDefinition, AsyncApiOAuthFlow, AsyncApiOperation, AsyncApiReference, AsyncApiSecurityScheme, AsyncApiServer } from './async-api.model';
import { ZibriApplication } from '../application/application';
import { type AuthServiceInterface } from '../auth/auth-service.interface';
import { ResolvedAuthMetadata } from '../auth/models/resolved-auth-metadata.model';
import { type RouteAuthServiceInterface } from '../auth/route-auth-service.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { OnAppStart } from '../global/on-app-start.interface';
import { RouteRegistry } from '../global/route-registry/route.registry';
import { HttpStatus } from '../http/http-status.enum';
import { MimeType } from '../http/mime-type.enum';
import { $ts } from '../localization/translate.function';
import { OpenApiSchemaUtilities } from '../open-api/open-api-schema.utilities';
import { isOpenApiReferenceObject, OpenApiContentObject, OpenApiOAuthFlowObject, OpenApiReferenceObject, OpenApiResponse, OpenApiResponseObject, OpenApiSchemaObject, OpenApiSecuritySchemeObject } from '../open-api/open-api.model';
import { BodyMetadata } from '../routing/decorators/body-metadata.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { Version } from '../versioning/version.model';
import { type VersioningServiceInterface } from '../versioning/versioning-service.interface';
import { WebsocketControllerData } from '../websocket/decorators/websocket-controller.decorator';
import { WebsocketControllerRouteConfiguration } from '../websocket/models/websocket-controller-route-configuration.model';
import { WebsocketEvent } from '../websocket/models/websocket-event.enum';
/**
 * The flows of an `oauth2` scheme, which OpenAPI and AsyncAPI name alike.
 */
type OAuthFlowName = 'implicit' | 'password' | 'clientCredentials' | 'authorizationCode';

/**
 * Every flow an `oauth2` scheme may have.
 */
const OAUTH_FLOW_NAMES: OAuthFlowName[] = ['implicit', 'password', 'clientCredentials', 'authorizationCode'];

/**
 * The key of the server of the document.
 */
const SERVER_KEY: string = 'application';

/**
 * The key the message a client sends has in its channel.
 */
const REQUEST_MESSAGE_KEY: string = 'request';

/**
 * The key the answer to it has in its channel.
 */
const REPLY_MESSAGE_KEY: string = 'reply';

/**
 * Default AsyncAPI service of Zibri: describes the websocket routes of each version.
 */
@Injectable({ register: 'onUse' })
export class AsyncApiService implements AsyncApiServiceInterface, OnAppStart {
    /**
     * The document per version, built once every init hook has run, as the open api documents are.
     */
    private readonly definitions: Map<string, AsyncApiDefinition> = new Map();

    private get routeAuthService(): RouteAuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROUTE_AUTH_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.VERSIONING_SERVICE)
        private readonly versioningService: VersioningServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.ASYNC_API_SERVERS)
        private readonly servers: Record<string, AsyncApiServer> | undefined
    ) { }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppStart(app: ZibriApplication): Promise<void> {
        for (const version of this.versioningService.getVersions()) {
            this.definitions.set(version.value, await this.createAsyncApiDefinition(app, version));
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findAsyncApiDefinition(version: string): AsyncApiDefinition | undefined {
        return this.definitions.get(version);
    }

    // the type of the interface, so a service extending this one may build it asynchronously, such as by
    // awaiting what this one builds
    // eslint-disable-next-line jsdoc/require-jsdoc
    async createAsyncApiDefinition(app: ZibriApplication, version: Version): Promise<AsyncApiDefinition> {
        const channels: Record<string, AsyncApiChannel> = {};
        const operations: Record<string, AsyncApiOperation> = {};
        const securitySchemes: Record<string, AsyncApiSecurityScheme> = this.resolveSecuritySchemes();
        const security: AsyncApiReference[] = ObjectUtilities.keys(securitySchemes)
            .map(name => ({ $ref: `#/components/securitySchemes/${name}` }));

        for (const controllerClass of [...app.options.websocketControllers].sort((a, b) => a.name.localeCompare(b.name))) {
            const controllerData: WebsocketControllerData | undefined = MetadataUtilities.getWebsocketControllerData(controllerClass);
            if (controllerData == undefined) {
                continue;
            }
            for (const route of MetadataUtilities.getWebsocketControllerRoutes(controllerClass)) {
                if (!this.versioningService.matchesVersion(route.versions ?? controllerData.versions, version)) {
                    continue;
                }
                const event: string = `${controllerData.eventPrefix}${route.event}`;
                const channelKey: string = this.resolveUniqueKey(channels, event);
                channels[channelKey] = {
                    address: event,
                    messages: {
                        [REQUEST_MESSAGE_KEY]: {
                            name: event,
                            contentType: MimeType.JSON,
                            payload: this.resolveRequestPayload(MetadataUtilities.getRouteBody(controllerClass, route.controllerMethod))
                        },
                        [REPLY_MESSAGE_KEY]: {
                            name: WebsocketEvent.RESPONSE,
                            contentType: MimeType.JSON,
                            description: 'What the event is answered with: through the acknowledgement of the message, or as an event '
                                + `${WebsocketEvent.RESPONSE} to a client that sends none.`,
                            payload: this.resolveReplyPayload(MetadataUtilities.getRouteResponses(controllerClass, route.controllerMethod))
                        }
                    }
                };
                const channel: AsyncApiReference = { $ref: `#/channels/${channelKey}` };
                operations[this.resolveUniqueKey(operations, `${controllerClass.name}_${route.controllerMethod}`)] = {
                    action: 'receive',
                    channel,
                    messages: [{ $ref: `#/channels/${channelKey}/messages/${REQUEST_MESSAGE_KEY}` }],
                    reply: { channel, messages: [{ $ref: `#/channels/${channelKey}/messages/${REPLY_MESSAGE_KEY}` }] },
                    tags: [{ name: controllerClass.name }],
                    ...await this.resolveOperationAuth(controllerClass, route, security)
                };
            }
        }

        const definition: AsyncApiDefinition = {
            asyncapi: '3.0.0',
            info: { title: app.options.name, version: version.value },
            defaultContentType: MimeType.JSON,
            channels,
            operations,
            components: { securitySchemes }
        };
        // a version without websocket routes is described as having none, without a server to connect to
        if (!ObjectUtilities.keys(operations).length) {
            return definition;
        }
        this.addReplayIncomplete(channels, operations);
        return { ...definition, servers: this.servers ?? { [SERVER_KEY]: this.resolveServer(app, security) } };
    }

    /**
     * The server a client connects to: the application, at the path of the websocket service.
     * @param app - The application.
     * @param security - What a client may connect with.
     * @returns The server.
     */
    private resolveServer(app: ZibriApplication, security: AsyncApiReference[]): AsyncApiServer {
        const url: URL = new URL(app.options.baseUrl);
        return {
            host: url.host,
            protocol: url.protocol === 'https:' ? 'wss' : 'ws',
            pathname: inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE).getPath?.(),
            // eslint-disable-next-line stylistic/max-len
            description: $ts`A socket.io server. A client names the version in the handshake, in the version header or query parameter, and logs in with the credentials of the handshake or of each message.`,
            security: security.length ? security : undefined
        };
    }

    /**
     * Adds the event a reconnecting client is sent instead of the messages it missed, when they cannot all be sent.
     * @param channels - The channels of the document.
     * @param operations - The operations of the document.
     */
    private addReplayIncomplete(channels: Record<string, AsyncApiChannel>, operations: Record<string, AsyncApiOperation>): void {
        const key: string = this.resolveUniqueKey(channels, WebsocketEvent.REPLAY_INCOMPLETE);
        channels[key] = {
            address: WebsocketEvent.REPLAY_INCOMPLETE,
            description: 'Sent to a reconnecting client instead of the messages it missed, when they cannot all be sent.',
            messages: {
                [REQUEST_MESSAGE_KEY]: {
                    name: WebsocketEvent.REPLAY_INCOMPLETE,
                    contentType: MimeType.JSON,
                    payload: this.buildEnvelope({
                        type: 'object',
                        description: 'Reload the state, and continue from this seq.',
                        properties: { seq: { type: 'integer' } },
                        required: ['seq']
                    })
                }
            }
        };
        operations[this.resolveUniqueKey(operations, 'replayIncomplete')] = {
            action: 'send',
            channel: { $ref: `#/channels/${key}` },
            messages: [{ $ref: `#/channels/${key}/messages/${REQUEST_MESSAGE_KEY}` }],
            tags: [{ name: 'Reconnecting' }]
        };
    }

    /**
     * The security an operation takes, and the permissions it requires.
     * @param controllerClass - The websocket controller.
     * @param route - The route.
     * @param security - Every scheme of the document.
     * @returns The fields of the operation.
     */
    private async resolveOperationAuth(
        controllerClass: Newable<unknown>,
        route: WebsocketControllerRouteConfiguration,
        security: AsyncApiReference[]
    ): Promise<Pick<AsyncApiOperation, 'security' | 'x-permission' | 'x-platform-permission'>> {
        const { hasPermission, hasPlatformPermission }: ResolvedAuthMetadata = RouteRegistry.get(
            controllerClass,
            route.controllerMethod
        ).auth.metadata;
        return {
            // a route following `defaultAuth` requires a login without a decorator saying so, see the open api service
            security: await this.routeAuthService.requiresAuthentication(controllerClass, route.controllerMethod) && security.length
                ? security
                : undefined,
            'x-permission': hasPermission?.permission,
            'x-platform-permission': hasPlatformPermission?.permission
        };
    }

    /**
     * What a client sends with an event: the body the route declares, and the headers and query of the message.
     * @param body - The body the route declares, if it takes one.
     * @returns The schema of the message.
     */
    private resolveRequestPayload(body: BodyMetadata | undefined): OpenApiSchemaObject {
        const content: OpenApiContentObject | undefined = OpenApiSchemaUtilities.resolveRequestBody(body)?.content;
        const json: OpenApiSchemaObject | OpenApiReferenceObject | undefined = content?.[MimeType.JSON]?.schema;
        const xml: OpenApiSchemaObject | OpenApiReferenceObject | undefined = content?.[MimeType.XML]?.schema;
        // an xml body travels as the text of its document, inside the json of the message
        const xmlText: OpenApiSchemaObject | undefined = xml == undefined
            ? undefined
            : { type: 'string', contentMediaType: MimeType.XML, contentSchema: xml };
        const bodySchema: OpenApiSchemaObject | OpenApiReferenceObject | undefined = xmlText ?? json;
        return {
            type: 'object',
            properties: {
                ...bodySchema == undefined ? {} : { body: bodySchema },
                headers: {
                    type: 'object',
                    description: 'Headers of the message, such as the credentials it is sent with',
                    additionalProperties: { type: 'string' }
                },
                query: { type: 'object', description: 'Query parameters of the message', additionalProperties: { type: 'string' } }
            },
            ...bodySchema == undefined || body?.required === false ? {} : { required: ['body'] }
        };
    }

    /**
     * What the application answers an event with: what the route returns when it succeeds, as its `@Response`
     * decorators declare, and the error it fails with otherwise.
     * @param responses - What the route declares.
     * @returns The schema of the answer.
     */
    private resolveReplyPayload(responses: OpenApiResponse[]): OpenApiSchemaObject {
        const declared: OpenApiResponseObject[] = ObjectUtilities.entries(OpenApiSchemaUtilities.resolveResponses(responses) ?? {})
            // a response that names no status is under `default`, and an error always names one
            .filter(([status]) => status.startsWith('2') || status === 'default')
            .flatMap(([, response]) => isOpenApiReferenceObject(response) ? [] : [response]);
        const data: (OpenApiSchemaObject | OpenApiReferenceObject)[] = declared.flatMap(response => {
            const schema: OpenApiSchemaObject | OpenApiReferenceObject | undefined = response.content?.[MimeType.JSON]?.schema;
            return schema == undefined ? [] : [schema];
        });
        const errorResponse: OpenApiResponseObject | OpenApiReferenceObject | undefined = OpenApiSchemaUtilities
            .resolveResponses([{ type: 'error', status: HttpStatus.BAD_REQUEST }])?.[`${HttpStatus.BAD_REQUEST}`];
        const errorSchema: OpenApiSchemaObject | OpenApiReferenceObject | undefined = errorResponse == undefined
            || isOpenApiReferenceObject(errorResponse)
            ? undefined
            : errorResponse.content?.[MimeType.JSON]?.schema;
        const error: OpenApiSchemaObject | OpenApiReferenceObject = errorSchema ?? { type: 'object' };
        return {
            oneOf: [
                this.buildEnvelope(data.length > 1 ? { oneOf: data } : data[0] ?? {}),
                {
                    type: 'object',
                    title: 'error',
                    properties: { ok: { const: false }, status: { type: 'integer' }, error },
                    required: ['ok', 'status', 'error']
                }
            ]
        };
    }

    /**
     * The message the application sends, holding what it sends as `data`.
     * @param data - The schema of what it sends.
     * @returns The schema of the message.
     */
    private buildEnvelope(data: OpenApiSchemaObject | OpenApiReferenceObject): OpenApiSchemaObject {
        return {
            type: 'object',
            title: 'ok',
            properties: {
                ok: { const: true },
                status: { type: 'integer' },
                seq: { type: 'integer', description: 'The number of the message, which a reconnecting client sends as its offset' },
                data
            },
            required: ['ok', 'status', 'data']
        };
    }

    /**
     * The scheme of each registered auth strategy, in the terms of AsyncAPI.
     * @returns The schemes, by the name of their strategy.
     */
    private resolveSecuritySchemes(): Record<string, AsyncApiSecurityScheme> {
        const res: Record<string, AsyncApiSecurityScheme> = {};
        for (const strategy of this.authService.strategies.map(s => inject(s))) {
            res[strategy.name] = this.toAsyncApiSecurityScheme(strategy.securityScheme);
        }
        return res;
    }

    private toAsyncApiSecurityScheme(scheme: OpenApiSecuritySchemeObject): AsyncApiSecurityScheme {
        const description: string | undefined = scheme.description;
        switch (scheme.type) {
            case 'http': {
                return { type: 'http', description, scheme: scheme.scheme, bearerFormat: scheme.bearerFormat };
            }
            case 'apiKey': {
                const location: 'query' | 'header' | 'cookie' = scheme.in === 'query' || scheme.in === 'cookie' ? scheme.in : 'header';
                return { type: 'httpApiKey', description, name: scheme.name, in: location };
            }
            case 'mutualTLS': {
                return { type: 'X509', description };
            }
            case 'openIdConnect': {
                return { type: 'openIdConnect', description, openIdConnectUrl: scheme.openIdConnectUrl };
            }
            case 'oauth2': {
                const flows: Record<string, AsyncApiOAuthFlow> = {};
                for (const name of OAUTH_FLOW_NAMES) {
                    const flow: OpenApiOAuthFlowObject | undefined = scheme.flows?.[name];
                    if (flow == undefined) {
                        continue;
                    }
                    flows[name] = {
                        authorizationUrl: flow.authorizationUrl,
                        tokenUrl: flow.tokenUrl,
                        refreshUrl: flow.refreshUrl,
                        availableScopes: flow.scopes
                    };
                }
                return { type: 'oauth2', description, flows };
            }
        }
    }

    /**
     * A key the document can name a part with, which AsyncAPI allows letters, digits, `_` and `-` in.
     * @param taken - The parts of the same kind already named.
     * @param name - What the part is called, such as the event.
     * @returns The key, with a number appended when another part has it already.
     */
    private resolveUniqueKey(taken: Record<string, unknown>, name: string): string {
        const base: string = name.replaceAll(/[^\w-]+/g, '-');
        let key: string = base;
        for (let index: number = 2; Object.hasOwn(taken, key); index++) {
            key = `${base}-${index}`;
        }
        return key;
    }
}