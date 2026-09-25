import assert from 'node:assert';

import type { Namespace, Server, ServerOptions, Socket } from 'socket.io';

import { WebsocketSendData, WebsocketSendDataMessage, WebsocketSendToAllData, WebsocketSendToChannelData, WebsocketServiceInterface } from './websocket-service.interface';
import { ZibriApplication } from '../../application/application';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { BaseUser } from '../../auth/models/base-user.model';
import { AlsUtilities } from '../../context/als.utilities';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { isPubSubDataSource } from '../../data-source/data-sources/pub-sub-data-source.interface';
import { WhereFilter } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { fileSizeToBytes } from '../../entity/models/file-property-metadata.model';
import { ErrorUtilities } from '../../error-handling/error.utilities';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { GlobalError } from '../../error-handling/errors/global.error';
import { HttpError } from '../../error-handling/errors/http.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { BeforeAppShutdown } from '../../global/before-app-shutdown.interface';
import { GlobalRegistry } from '../../global/global-registry';
import { OnAppInit } from '../../global/on-app-init.interface';
import { RouteRegistry, RouteRegistryData } from '../../global/route-registry/route.registry';
import { HandlerTimeout } from '../../http/handler-timeout.type';
import { HttpStatus } from '../../http/http-status.enum';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { RequestDeadlineUtilities } from '../../http/request-deadline.utilities';
import { $ts } from '../../localization/translate.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { resolveRouteParams } from '../../routing/resolve-route-params.function';
import { RouteParamMetadata } from '../../routing/route-param-metadata.model';
import { TraceSpanKind } from '../../tracing/trace-span-kind.enum';
import { TraceSpanStatus } from '../../tracing/trace-span-status.enum';
import { TracingUtilities } from '../../tracing/tracing.utilities';
import { isNewable, Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { type ValidationServiceInterface } from '../../validation/validation-service.interface';
import { RouteWithVersionData } from '../../versioning/route-with-version-data.model';
import { SemVerVersion } from '../../versioning/sem-ver.utilities';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model';
import { Version } from '../../versioning/version.model';
import { type VersioningServiceInterface } from '../../versioning/versioning-service.interface';
import { type DataSourceWebsocketAdapter, type DataSourceWebsocketAdapterConstructor, dataSourceWebsocketAdapterClass } from '../data-source.websocket-adapter';
import { WebsocketControllerData } from '../decorators/websocket-controller.decorator';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model';
import { WebsocketChannel } from '../models/websocket-channel.model';
import { WebsocketControllerRouteConfiguration } from '../models/websocket-controller-route-configuration.model';
import { LooseWebsocketEvent, WebsocketEvent } from '../models/websocket-event.enum';
import { WebsocketMessage, CreateWebsocketMessageData, WebsocketRecipientType } from '../models/websocket-message.model';
import { type WebsocketOptions } from '../models/websocket-options.model';
import { WebsocketRequest, WebsocketRequestWithConnection } from '../models/websocket-request.model';
import { WebsocketResponseHandler } from '../models/websocket-response.model';

/**
 * Handler for dealing with an incoming websocket message.
 */
type SocketIOWebsocketHandler = (
    connection: SocketIOWebsocketConnection,
    req: WebsocketRequest,
    responseHandler: WebsocketResponseHandler | undefined
) => unknown | Promise<unknown>;

/**
 * Default implementation for handling websockets.
 * Uses socket.io under the hood.
 */
@Injectable({ register: 'onUse' })
export class WebsocketService implements WebsocketServiceInterface<SocketIOWebsocketConnection>, OnAppInit, BeforeAppShutdown {
    /**
     * Absent for an application that declares no websockets, which is the one that never starts a
     * server. Read through `server` wherever one is required.
     */
    private socketServer?: Server;
    private readonly allEventRoutes: RouteWithVersionData[] = [];
    private readonly websocketHandlers: Record<string, SocketIOWebsocketHandler | undefined> = {};
    private readonly websocketChannels: Record<string, SocketIOWebsocketConnection[] | undefined> = {};
    private readonly connections: SocketIOWebsocketConnection[] = [];
    /**
     * The messages currently being handled, so a client that goes away can be answered for.
     *
     * A set rather than a map by connection, because every message leaves it again in a `finally`
     * and a map would need its own emptying when the last message of a connection is over.
     */
    private readonly inFlight: Set<WebsocketRequestContext> = new Set();

    private readonly pendingRouteGroups: Map<string, {
        // eslint-disable-next-line jsdoc/require-jsdoc
        entries: { versions: SupportedVersionsOptions, innerHandler: SocketIOWebsocketHandler }[]
    }> = new Map();

    private get versioningService(): VersioningServiceInterface {
        return inject(ZIBRI_DI_TOKENS.VERSIONING_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE)
        private readonly validationService: ValidationServiceInterface,
        @InjectRepository(WebsocketChannel)
        private readonly channelRepository: Repository<WebsocketChannel>,
        @InjectRepository(WebsocketMessage)
        private readonly messageRepository: Repository<WebsocketMessage, CreateWebsocketMessageData>,
        @Inject(ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS)
        private readonly options: WebsocketOptions
    ) {}

    /**
     * Builds the socket.io adapter from the configured data source, if one was named.
     * @returns The adapter, or undefined to keep broadcasts inside this instance.
     * @throws When the named data source cannot carry messages between instances.
     */
    private resolveAdapter(): ServerOptions['adapter'] | undefined {
        if (!this.options.adapterDataSource) {
            return undefined;
        }

        const dataSource: DataSourceInterface = inject(this.options.adapterDataSource);
        if (!isPubSubDataSource(dataSource)) {
            throw new InternalError([
                `The data source "${this.options.adapterDataSource.name}" was configured as the websocket adapter,`,
                'but it cannot carry messages between instances.',
                'Use one that implements PubSubDataSourceInterface, eg. a ValKeyDataSource.'
            ]);
        }

        const logger: LoggerInterface = this.logger;

        // here rather than inside the factory below, so socket.io-adapter is resolved while the
        // application starts. socket.io asks for an adapter per namespace, and the first namespace
        // is created with the server - but a deployment that named an adapter data source has
        // already declared it wants this, and that declaration is read now.
        const adapterClass: DataSourceWebsocketAdapterConstructor = dataSourceWebsocketAdapterClass();

        // deliberately not an arrow function: socket.io types this as a plain factory but calls it
        // with `new`, and an arrow function has no construct slot. Calling `new` on a normal
        // function that returns an object yields that object, which is what every socket.io adapter
        // factory relies on.
        return function createAdapter(nsp: Namespace): DataSourceWebsocketAdapter {
            return new adapterClass(nsp, dataSource, logger);
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // before the check below, and deliberately: an empty list is exactly the case a controller
        // can be orphaned in - decorated, and then never passed to the application. Skipping this
        // when there is nothing to serve would make forgetting every controller the one mistake
        // that boots cleanly.
        this.validateNoOrphanedControllers(app.options.websocketControllers);

        // an application that declares no websockets at all does not get a server, which is what
        // makes socket.io an optional peer dependency rather than one every application carries. It
        // is read here, at startup, so a deployment that declared them without installing socket.io
        // fails on the way up rather than on the first connection.
        //
        // A websocket controller is one declaration and an adapter data source is the other: naming
        // one says this deployment carries broadcasts between its instances, which is a thing only
        // an application with a websocket server has any use for. A server that never handles an
        // inbound event is a real shape - push only notifications are exactly that - and reading
        // controllers alone left it with nowhere to say so.
        const declaresWebsockets: boolean = app.options.websocketControllers.length > 0
            || this.options.adapterDataSource != undefined;
        if (!declaresWebsockets) {
            this.logger.info('starts no socket.io server: nothing declares websockets');
            return;
        }

        this.socketServer = new (optionalPeer<typeof import('socket.io')>('socket.io', 'Websockets').Server)(app.server, {
            connectionStateRecovery: {},
            adapter: this.resolveAdapter(),
            maxHttpBufferSize: fileSizeToBytes('1mb').toNumber()
        });

        this.logger.info('starts socket.io server');

        this.logger.info(`registers ${app.options.websocketControllers.length} websocket controllers:`);
        for (const controller of app.options.websocketControllers) {
            const routes: WebsocketControllerRouteConfiguration[] = MetadataUtilities.getWebsocketControllerRoutes(controller);
            this.logger.info(`  - ${controller.name} (${routes.length} routes)`);
            this.registerController(controller);
        }

        for (const [event, group] of this.pendingRouteGroups.entries()) {
            this.websocketHandlers[event] = this.createDispatchHandler(group.entries);
            this.logger.debug(`- mounting websocket event "${event}"`);
        }

        // eslint-disable-next-line typescript/no-misused-promises
        this.socketServer.use(async (socket, next) => {
            // everything in here has to stay inside the try. socket.io does not catch a rejection from
            // an async middleware, so anything escaping it never reaches next() and leaves the client
            // waiting out the connect timeout without an error.
            try {
                const request: WebsocketRequest = {
                    headers: socket.handshake.headers as Partial<Record<KnownHeader, string | undefined>>,
                    body: undefined,
                    query: socket.handshake.query as Partial<Record<string, string | undefined>>,
                    params: {}
                };
                const context: WebsocketRequestContext = new WebsocketRequestContext(request, undefined, undefined, undefined);

                const currentUser: BaseUser<string> | undefined = await this.authService.getCurrentUser(
                    context,
                    this.authService.strategies,
                    false
                );
                if (!await this.options.isAllowedToConnect(currentUser)) {
                    // the hook refuses an identity rather than a credential, so which of the two this is
                    // depends on whether there was one. An anonymous caller can still become someone the
                    // hook admits; a resolved one cannot, and telling it 401 asks it to refresh forever.
                    next(
                        currentUser === undefined
                            ? new UnauthorizedError($ts`Not allowed to connect`)
                            : new ForbiddenError($ts`Not allowed to connect`)
                    );
                    return;
                }

                const version: Version = await context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_VERSION);
                // eslint-disable-next-line typescript/no-unsafe-member-access
                socket.data.resolvedVersion = version;
                // eslint-disable-next-line typescript/no-unsafe-member-access
                socket.data.currentUser = currentUser;
                next();
            }
            catch (error) {
                // a rejected handshake is a normal outcome, so it is reported as it is. anything else is
                // this server's fault and only its message goes out, because the cause can hold internals.
                if (ErrorUtilities.isHttpError(error)) {
                    next(error);
                    return;
                }
                const internalError: InternalError = new InternalError('Could not establish the websocket connection', { cause: error });
                this.logger.error(internalError);
                next(internalError);
            }
        });
        // an async listener on an event emitter is not awaited by anyone, so it needs its own catch.
        // eslint-disable-next-line promise/prefer-await-to-then
        this.socketServer.on('connection', socket => void this.onConnect(socket).catch(
            // eslint-disable-next-line promise/prefer-await-to-callbacks
            error => this.logger.error(new InternalError('Could not handle a new websocket connection', { cause: error }))
        ));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async beforeAppShutdown(): Promise<void> {
        if (this.socketServer == undefined) {
            return;
        }
        await this.socketServer.close();
    }

    private async onConnect(socket: Socket): Promise<void> {
        // eslint-disable-next-line typescript/no-unsafe-member-access
        const currentUser: BaseUser<string> | undefined = socket.data.currentUser as BaseUser<string> | undefined;
        // eslint-disable-next-line typescript/no-unsafe-member-access
        const resolvedVersion: Version = socket.data.resolvedVersion as Version;

        let connection: SocketIOWebsocketConnection | undefined = this.connections.find(c => c.id === socket.id);

        if (connection) {
            connection.offset = socket.handshake.auth['offset'] as number;
            await this.recoverConnection(connection, currentUser);
            return;
        }

        connection = new SocketIOWebsocketConnection(socket, currentUser?.id, resolvedVersion);
        this.connections.push(connection);
        this.logger.debug('a user connected');

        connection.onDisconnect(() => this.onDisconnect(connection));

        connection.onAny(async (ev: string, ...args: unknown[]) => {
            this.logger.debug(`got an event "${ev}"`);

            // detect response handler if client supplied one
            const last: unknown = args[args.length - 1];
            const responseHandler: WebsocketResponseHandler | undefined = typeof last === 'function'
                ? (args.pop() as WebsocketResponseHandler)
                : undefined;

            if (ev === WebsocketEvent.DISCONNECT) {
                return; // do nothing;
            }
            const handler: SocketIOWebsocketHandler | undefined = this.websocketHandlers[ev];
            if (!handler) {
                const error: HttpError = new NotFoundError($ts`Could not find websocket event "${ev}"`);
                await this.send({
                    connection,
                    event: WebsocketEvent.RESPONSE,
                    message: {
                        ok: false,
                        error,
                        status: error.status,
                        senderUserId: undefined,
                        senderConnectionId: undefined
                    },
                    responseHandler,
                    expectResponse: true,
                    persist: false
                });
                return;
            }
            if (args.length > 1) {
                const error: HttpError = new BadRequestError($ts`There should only be one message sent.`);
                await this.send({
                    connection,
                    event: WebsocketEvent.RESPONSE,
                    message: {
                        ok: false,
                        error,
                        status: error.status,
                        senderUserId: undefined,
                        senderConnectionId: undefined
                    },
                    responseHandler,
                    expectResponse: true,
                    persist: false
                });
                return;
            }
            const req: unknown = args[0];
            try {
                await this.validationService.validateWebsocketRequest(req);
                await handler(connection, req as WebsocketRequest, responseHandler);
                return;
            }
            catch (error) {
                // the same record the http error handler writes, for the same reasons - see
                // handleLogging in error-handler.ts. A wrapper here made every websocket handler
                // failure arrive as "Global Error" with an empty stack, and a client error arrive as
                // nothing at all
                let persist: boolean = false;
                if (!ErrorUtilities.isError(error)) {
                    this.logger.critical(new GlobalError(error));
                    persist = true;
                }
                else if (!ErrorUtilities.isHttpError(error) || error.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
                    this.logger.error(error);
                    persist = true;
                }
                // a client error is neither logged nor persisted here, for the same reason it is not
                // in the http handler: the security relevant ones are in the audit trail already

                await this.send({
                    connection,
                    event: WebsocketEvent.RESPONSE,
                    message: {
                        ok: false,
                        error: ErrorUtilities.toHttpError(error),
                        status: ErrorUtilities.toHttpError(error).status,
                        senderUserId: undefined,
                        senderConnectionId: undefined
                    },
                    responseHandler,
                    expectResponse: true,
                    persist
                });
                return;
            }
        });

        await this.recoverConnection(connection, currentUser);
    }

    /**
     * Puts a connection back into the rooms of the channels its user already belongs to.
     *
     * Membership is stored on the channel, but delivery goes through a socket.io room - and a room
     * only exists on the instance holding the socket. Socket.io restores rooms itself as part of a
     * connection state recovery, which cannot span instances, so without this a user reconnecting
     * anywhere else stays a member in the data source while belonging to no room: the messages they
     * missed get replayed below, and every message after that passes them by.
     *
     * Done before the replay rather than after. A message published in between then arrives live and
     * is replayed as well, which a client can drop because it tracks the sequence number it last
     * saw - the other order loses that message entirely, which it cannot do anything about.
     *
     * Joining a room twice is a no-op, so a channel the connection is already in costs nothing.
     * @param connection - The connection that has just been established.
     * @param channels - The channels its user is a member of.
     */
    private async rejoinChannels(connection: SocketIOWebsocketConnection, channels: WebsocketChannel[]): Promise<void> {
        for (const channel of channels) {
            await connection.join(channel.name);
            this.websocketChannels[channel.name] ??= [];

            if (!this.websocketChannels[channel.name]?.find(c => c.id === connection.id)) {
                this.websocketChannels[channel.name]?.push(connection);
            }
        }
    }

    private async recoverConnection(connection: SocketIOWebsocketConnection, currentUser: BaseUser<string> | undefined): Promise<void> {
        if (connection.recovered) {
            // socket.io restored the rooms and the buffered packets itself, which it can only do on
            // the instance that held the socket in the first place
            return;
        }
        const whereFilters: WhereFilter<WebsocketMessage>[] = [
            {
                seq: { greaterThan: connection.offset },
                recipientType: WebsocketRecipientType.ALL
            }
        ];
        if (currentUser) {
            const channelsOfUser: WebsocketChannel[] = await this.channelRepository.findAll(
                { where: { userIds: { includes: [currentUser.id] } } }
            );

            await this.rejoinChannels(connection, channelsOfUser);

            whereFilters.push(
                {
                    seq: { greaterThan: connection.offset },
                    recipientType: WebsocketRecipientType.CHANNEL,
                    recipientId: { oneOf: channelsOfUser.map(c => c.id) }
                },
                {
                    seq: { greaterThan: connection.offset },
                    recipientType: WebsocketRecipientType.USER,
                    recipientId: currentUser.id
                }
            );
        }

        const messages: WebsocketMessage[] = await this.messageRepository.findAll({
            // everything the reconnecting client missed, however much that is
            take: 'all',
            where: whereFilters
        });

        for (const m of messages) {
            await this.send({
                connection,
                event: m.event,
                message: m as WebsocketSendDataMessage,
                expectResponse: true,
                responseHandler: undefined,
                persist: false
            });
        }
    }

    private onDisconnect(connection: SocketIOWebsocketConnection): void {
        this.logger.debug('a user disconnected');
        this.abandonMessagesOf(connection);
        const foundConnection: SocketIOWebsocketConnection | undefined = this.connections.find(c => c.id === connection.id);
        if (!foundConnection) {
            this.logger.warn(`Could not find connection to disconnect with id "${connection.id}"`);
            return;
        }
        this.connections.splice(this.connections.indexOf(foundConnection), 1);
    }

    /**
     * Tells everything still being handled for a client that the client has gone.
     *
     * The one thing a websocket has that a http request does not: nothing else will ever notice.
     * A http handler whose caller hung up at least has a response that fails to write, while a
     * message handler would go on working for a socket that is already closed - and an event with
     * no deadline of its own would do so for as long as it takes.
     * @param connection - The connection that closed.
     */
    private abandonMessagesOf(connection: SocketIOWebsocketConnection): void {
        for (const context of this.inFlight) {
            if (context.connection?.id !== connection.id) {
                continue;
            }
            context.clientGone = true;
            context.abandon(new InternalError('The client disconnected while this message was still being handled.'));
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    registerController(controllerClass: Newable<unknown>): void {
        const controllerData: WebsocketControllerData | undefined = MetadataUtilities.getWebsocketControllerData(controllerClass);
        const currentLatest: SemVerVersion | undefined = GlobalRegistry.getAppData('version');
        assert(currentLatest);
        if (controllerData == undefined) {
            // eslint-disable-next-line stylistic/max-len
            throw new Error(`Could not find websocket controller data on class ${controllerClass.name}. Did you forget to decorate it with @WebsocketController?`);
        }
        const routes: WebsocketControllerRouteConfiguration[] = MetadataUtilities.getWebsocketControllerRoutes(controllerClass);

        for (const route of routes) {
            const fullEvent: string = `${controllerData.eventPrefix}${route.event}`;
            const versions: SupportedVersionsOptions = route.versions ?? controllerData.versions;

            const overlappingRoute: RouteWithVersionData | undefined = this.allEventRoutes.find(
                r => r.key === fullEvent && this.versioningService.hasOverlappingVersions(r.versions, versions, currentLatest)
            );
            if (overlappingRoute) {
                const overlappingVersions: SupportedVersionsOptions = this.versioningService.findOverlappingVersions(
                    overlappingRoute.versions,
                    versions,
                    currentLatest
                );
                if (overlappingVersions === 'all') {
                    throw new Error([
                        `The websocket event "${fullEvent}"`,
                        'has been defined more than once.',
                        '(versions: \'all\' has been used)'
                    ].join(' '), { cause: controllerClass });
                }
                throw new Error([
                    `The websocket event "${fullEvent}"`,
                    `for the ${overlappingVersions.length > 1 ? 'versions' : 'version'} "${overlappingVersions.join(', ')}"`,
                    'has been defined more than once.'
                ].join(' '), { cause: controllerClass });
            }

            this.allEventRoutes.push({ key: fullEvent, versions });

            const innerHandler: SocketIOWebsocketHandler = this.controllerRouteToWebsocketHandler(
                controllerClass,
                route,
                // an event that says nothing takes what its controller says, exactly as it does for
                // the versions it supports. `??` rather than a truthiness check, because an event
                // declaring `'none'` has said something
                route.timeoutInMs ?? controllerData.timeoutInMs
            );
            // eslint-disable-next-line typescript/typedef
            const existing = this.pendingRouteGroups.get(fullEvent);
            if (existing) {
                existing.entries.push({ versions, innerHandler });
            }
            else {
                this.pendingRouteGroups.set(fullEvent, { entries: [{ versions, innerHandler }] });
            }
            this.logger.debug(`- registering websocket event "${fullEvent}"`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async send<B extends boolean = true>(
        data: WebsocketSendData<SocketIOWebsocketConnection, B>
    ): Promise<B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>> {
        data.expectResponse ??= true as B;

        const message: WebsocketMessage = await this.createWebsocketMessage(
            data.persist ?? true,
            data.message.ok
                ? {
                    status: HttpStatus.OK,
                    event: data.event,
                    recipientType: WebsocketRecipientType.USER,
                    recipientId: data.connection.userId,
                    error: undefined,
                    ...data.message
                }
                : {
                    event: data.event,
                    recipientType: WebsocketRecipientType.USER,
                    recipientId: data.connection.userId,
                    data: undefined,
                    ...data.message
                }
        );

        if (data.responseHandler) {
            await data.responseHandler(message);
            return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
        }

        const payload: WebsocketMessage = JsonUtilities.parse(JsonUtilities.stringify(message));

        if (data.expectResponse) {
            const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection> = await this.emitWithAckTo(
                data.connection,
                data.event,
                payload
            );
            return res as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
        }

        data.connection.emit(data.event, payload);
        return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
    }

    /**
     * Emits a prepared payload to one connection and waits for its answer.
     *
     * Split out of `send` so a fan out can prepare that payload once. A message has to be turned
     * into what json carries before socket.io can encode it, and that is work about the message
     * rather than about the connection it goes to. Done inside `send` it happened once per
     * recipient, so a broadcast to a thousand connections did it a thousand times.
     * @param connection - Who to emit to.
     * @param event - The event to emit.
     * @param payload - The message, as json carries it.
     * @returns What the connection answered.
     */
    private async emitWithAckTo(
        connection: SocketIOWebsocketConnection,
        event: LooseWebsocketEvent,
        payload: WebsocketMessage
    ): Promise<WebsocketRequestWithConnection<SocketIOWebsocketConnection>> {
        return {
            request: await connection.emitWithAck(event, payload, this.options.timeoutInMs),
            connection
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async sendToChannel<B extends boolean>(
        data: WebsocketSendToChannelData<B>
    ): Promise<B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[]> {
        data.expectResponse ??= false as B;
        const channel: WebsocketChannel = await this.channelRepository.findById(data.channelId);

        const message: WebsocketMessage = await this.createWebsocketMessage(
            data.persist ?? true,
            data.message.ok
                ? {
                    event: data.event,
                    recipientType: WebsocketRecipientType.CHANNEL,
                    recipientId: data.channelId,
                    status: HttpStatus.OK,
                    error: undefined,
                    ...data.message
                }
                : {
                    event: data.event,
                    recipientType: WebsocketRecipientType.CHANNEL,
                    recipientId: data.channelId,
                    data: undefined,
                    ...data.message
                }
        );

        if (data.responseHandler) {
            await data.responseHandler(message);
            return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[];
        }

        if (!data.expectResponse) {
            this.server.to(channel.name).emit(data.event, JsonUtilities.parse(JsonUtilities.stringify(message)));
            return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[];
        }

        const connections: SocketIOWebsocketConnection[] = this.websocketChannels[channel.name] ?? [];
        const payload: WebsocketMessage = JsonUtilities.parse(JsonUtilities.stringify(message));
        const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection>[] = await Promise.all(
            connections.map(async c => {
                try {
                    return await this.emitWithAckTo(c, data.event, payload);
                }
                catch (error) {
                    const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection> = {
                        request: {
                            body: { error },
                            headers: {},
                            params: {},
                            query: {}
                        },
                        connection: c
                    };
                    return res;
                }
            })
        );
        return res as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async sendToAll<B extends boolean>(
        data: WebsocketSendToAllData<B>
    ): Promise<B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[]> {
        data.expectResponse ??= false as B;
        const message: WebsocketMessage = await this.createWebsocketMessage(
            data.persist ?? true,
            data.message.ok
                ? {
                    event: data.event,
                    recipientType: WebsocketRecipientType.ALL,
                    recipientId: undefined,
                    status: HttpStatus.OK,
                    error: undefined,
                    ...data.message
                }
                : {
                    event: data.event,
                    recipientType: WebsocketRecipientType.ALL,
                    recipientId: undefined,
                    data: undefined,
                    ...data.message
                }
        );

        if (data.responseHandler) {
            await data.responseHandler(message);
            return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[];
        }

        if (!data.expectResponse) {
            this.server.emit(data.event, JsonUtilities.parse(JsonUtilities.stringify(message)));
            return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[];
        }

        const payload: WebsocketMessage = JsonUtilities.parse(JsonUtilities.stringify(message));
        const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection>[] = await Promise.all(
            this.connections.map(async c => {
                try {
                    return await this.emitWithAckTo(c, data.event, payload);
                }
                catch (error) {
                    const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection> = {
                        request: {
                            body: { error },
                            headers: {},
                            params: {},
                            query: {}
                        },
                        connection: c
                    };
                    return res;
                }
            })
        );
        return res as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    disconnect(connection: SocketIOWebsocketConnection, close: boolean = true): void {
        connection.disconnect(close);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async joinChannel(connection: SocketIOWebsocketConnection, channelId: string): Promise<void> {
        const channel: WebsocketChannel = await this.channelRepository.findById(channelId);
        this.websocketChannels[channel.name] ??= [];
        if (this.websocketChannels[channel.name]?.find(c => c.id === connection.id)) {
            this.logger.warn(`The connection with id ${connection.id} has already joined the channel ${channel.name}.`);
            return;
        }

        if (connection.userId && !channel.userIds.includes(connection.userId)) {
            channel.userIds.push(connection.userId);
            await this.channelRepository.updateById(channel.id, { userIds: channel.userIds });
        }
        await connection.join(channel.name);
        this.websocketChannels[channel.name]?.push(connection);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async leaveChannel(connection: SocketIOWebsocketConnection, channelId: string): Promise<void> {
        const channel: WebsocketChannel = await this.channelRepository.findById(channelId);
        if (connection.userId && channel.userIds.includes(connection.userId)) {
            channel.userIds.splice(channel.userIds.indexOf(connection.userId), 1);
            await this.channelRepository.updateById(channel.id, { userIds: channel.userIds });
        }
        await connection.leave(channel.name);

        const foundChannel: SocketIOWebsocketConnection | undefined = this.websocketChannels[channel.name]?.find(
            c => c.id === connection.id
        );
        if (foundChannel) {
            // eslint-disable-next-line typescript/no-non-null-assertion
            this.websocketChannels[channel.name]!.splice(this.websocketChannels[channel.name]!.indexOf(foundChannel), 1);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getConnections(): SocketIOWebsocketConnection[] {
        return this.connections;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findConnectionById(id: string): SocketIOWebsocketConnection {
        const foundConnection: SocketIOWebsocketConnection | undefined = this.connections.find(c => c.id === id);
        if (!foundConnection) {
            throw new NotFoundError($ts`Could not find connection with id "${id}".`);
        }
        return foundConnection;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findConnectionByUserId(userId: string): SocketIOWebsocketConnection {
        const foundConnection: SocketIOWebsocketConnection | undefined = this.connections.find(c => c.userId === userId);
        if (!foundConnection) {
            throw new NotFoundError($ts`Could not find connection with userId "${userId}".`);
        }
        return foundConnection;
    }

    private createDispatchHandler(
        // eslint-disable-next-line jsdoc/require-jsdoc
        entries: { versions: SupportedVersionsOptions, innerHandler: SocketIOWebsocketHandler }[]
    ): SocketIOWebsocketHandler {
        return async (connection, req, responseHandler) => {
            try {
                // eslint-disable-next-line typescript/typedef
                const match = entries.find(e => this.versioningService.matchesVersion(e.versions, connection.resolvedVersion));
                if (!match) {
                    const error: NotFoundError = new NotFoundError(
                        $ts`Could not find handler for websocket event for version "${connection.resolvedVersion.value}"`
                    );
                    await this.send({
                        connection,
                        event: WebsocketEvent.RESPONSE,
                        message: { ok: false, error, status: error.status, senderUserId: undefined, senderConnectionId: undefined },
                        responseHandler,
                        expectResponse: true,
                        persist: false
                    });
                    return;
                }
                await match.innerHandler(connection, req, responseHandler);
            }
            catch (error) {
                const err: HttpError = ErrorUtilities.toHttpError(error);
                await this.send({
                    connection,
                    event: WebsocketEvent.RESPONSE,
                    message: { ok: false, error: err, status: err.status, senderUserId: undefined, senderConnectionId: undefined },
                    responseHandler,
                    expectResponse: true,
                    persist: false
                });
            }
        };
    }

    private async createWebsocketMessage(
        persist: boolean,
        messageData: CreateWebsocketMessageData | WebsocketMessage
    ): Promise<WebsocketMessage> {
        if ('id' in messageData) {
            return messageData;
        }
        return persist
            ? await this.messageRepository.create(messageData)
            : {
                ...messageData,
                seq: 1,
                id: UUIDUtilities.generate(),
                createdAt: new Date(),
                ok: messageData.status < 400
            };
    }

    private controllerRouteToWebsocketHandler(
        controllerClass: Newable<unknown>,
        route: WebsocketControllerRouteConfiguration,
        timeoutInMs: HandlerTimeout | undefined
    ): SocketIOWebsocketHandler {
        // resolved here rather than on every message, for the reasons the http router states where it
        // does the same
        const routeData: RouteRegistryData = RouteRegistry.register(controllerClass, route.controllerMethod);

        if (
            routeData.params.body?.type != undefined
            && routeData.params.body.type !== MimeType.JSON
            && routeData.params.body.type !== MimeType.XML
        ) {
            throw new InternalError([
                `The websocket request body on ${controllerClass.name}.${route.controllerMethod}`,
                ` has been defined as type ${routeData.params.body.type}.\n`,
                'This is not supported for websockets'
            ].join(' '));
        }

        const handler: SocketIOWebsocketHandler = async (
            connection: SocketIOWebsocketConnection,
            req: WebsocketRequest,
            ack: WebsocketResponseHandler | undefined
        ) => {
            const context: WebsocketRequestContext = new WebsocketRequestContext(req, connection, controllerClass, route.controllerMethod);
            // held for as long as the message is, so a client that hangs up can be told about
            // everything still running for it. Removed in the `finally` below rather than on the
            // way out of the handler, since a failed message has to let go of its place too
            this.inFlight.add(context);
            await AlsUtilities.runWithWebsocketRequestContext(context, async () => await TracingUtilities.trace(
                `${controllerClass.name}.${route.controllerMethod}`,
                {
                    kind: TraceSpanKind.SERVER,
                    // a trace per message rather than per connection: a socket that stays open for
                    // an hour would otherwise be one trace holding everything anybody said on it
                    root: true,
                    attributes: { 'code.function': route.controllerMethod }
                },
                async span => {
                    try {
                        await this.authService.checkAccess(controllerClass, route.controllerMethod, context);
                        const controller: unknown = inject(controllerClass);
                        const params: unknown[] = await this.resolveRouteParams(
                            routeData.params,
                            // eslint-disable-next-line typescript/no-unsafe-member-access, typescript/no-explicit-any
                            ((controller as any)[route.controllerMethod] as Function).length,
                            context
                        );

                        const res: unknown = await RequestDeadlineUtilities.resolveWithinDeadline(
                            context,
                            timeoutInMs ?? this.options.handlerInMs,
                            // eslint-disable-next-line typescript/no-unsafe-call, typescript/no-explicit-any, typescript/no-unsafe-member-access
                            async (): Promise<unknown> => await ((controller as any)[route.controllerMethod] as Function)(...params)
                        );
                        await this.send({
                            connection,
                            event: WebsocketEvent.RESPONSE,
                            expectResponse: true,
                            message: {
                                ok: true,
                                data: res,
                                senderConnectionId: undefined,
                                senderUserId: undefined
                            },
                            persist: false,
                            responseHandler: ack
                        });
                    }
                    catch (error) {
                        // there is nobody to answer and no socket to answer on. Unlike a failed
                        // http request, which still has a response to turn into a status, a message
                        // whose client has gone has nowhere for this to go
                        if (context.clientGone) {
                            return;
                        }
                        const err: HttpError = ErrorUtilities.toHttpError(error);
                        // recorded rather than rethrown, for the reason a cron tick records its
                        // own: this is where a failed message is answered, and a span that said
                        // nothing would make a handler that fails every time look like one that
                        // works
                        span.recordAttribute('http.response.status_code', err.status);
                        if (err.status >= 500) {
                            span.recordError(error);
                            span.end(TraceSpanStatus.ERROR);
                        }
                        await this.send({
                            connection,
                            event: WebsocketEvent.RESPONSE,
                            message: {
                                ok: false,
                                error: err,
                                status: err.status,
                                senderUserId: undefined,
                                senderConnectionId: undefined
                            },
                            responseHandler: ack,
                            expectResponse: true,
                            persist: !ErrorUtilities.isHttpError(error) || error.status >= 500
                        });
                        if (err.status === HttpStatus.UNAUTHORIZED) {
                            this.disconnect(connection, true);
                        }
                        if (err.status >= 500) {
                            const globalError: Error = new Error('Global Error', { cause: error });
                            globalError.stack = undefined;
                            this.logger.error(globalError);
                        }
                    }
                    finally {
                        this.inFlight.delete(context);
                    }
                }
            ));
        };
        return handler;
    }

    /**
     * The running socket.io server.
     *
     * There is none when the application declared no websockets, and sending to nobody is more
     * likely a mistake than an intention - so this says which, rather than being a `TypeError`
     * about reading a property of undefined.
     * @returns The server.
     * @throws When no websocket server was started.
     */
    private get server(): Server {
        if (this.socketServer == undefined) {
            throw new InternalError([
                'There is no websocket server to send through.',
                'One is started for an application that registers a websocket controller,',
                'or whose ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS name an adapterDataSource.'
            ]);
        }
        return this.socketServer;
    }

    private validateNoOrphanedControllers(controllers: Newable<unknown>[]): void {
        const orphanedControllers: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.WEBSOCKET_CONTROLLER).filter(c => {
            return isNewable(c.useClass)
                && !controllers.includes(c.useClass)
                && !(MetadataUtilities.getWebsocketControllerData(c.useClass)?.allowOrphan ?? false);
        });
        if (orphanedControllers.length) {
            const message: string[] = ['Error initializing websocket service.', 'Found orphaned controllers:'];
            for (const controller of orphanedControllers) {
                message.push(`  - ${getDiTokenName(controller.token)}`);
            }
            message.push('Did you forget to add them to your websocketControllers array?');
            throw new Error(message.join('\n'));
        }
    }

    private async resolveRouteParams(
        metadata: RouteParamMetadata,
        totalParamCount: number,
        context: WebsocketRequestContext
    ): Promise<unknown[]> {
        return await resolveRouteParams(metadata, totalParamCount, context);
    }
}