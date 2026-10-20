import assert from 'node:assert';

import type { Namespace, Server, ServerOptions, Socket } from 'socket.io';

import { WebsocketSendData, WebsocketSendDataMessage, WebsocketSendToAllData, WebsocketSendToChannelData, WebsocketServiceInterface } from './websocket-service.interface.ts';
import { ZibriApplication } from '../../application/application.ts';
import { type AuthServiceInterface } from '../../auth/auth-service.interface.ts';
import { BaseUser } from '../../auth/models/base-user.model.ts';
import { AlsUtilities } from '../../context/als.utilities.ts';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../context/request/request-context-token.model.ts';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface.ts';
import { isPubSubDataSource } from '../../data-source/data-sources/pub-sub-data-source.interface.ts';
import { WhereFilter } from '../../data-source/models/where/where-filter.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { getDiTokenName } from '../../di/get-di-token-name.function.ts';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function.ts';
import { inject } from '../../di/inject.function.ts';
import { DiProvider } from '../../di/models/di-provider.model.ts';
import { DiVariants } from '../../di/models/di-variant.model.ts';
import { fileSizeToBytes } from '../../entity/models/file-property-metadata.model.ts';
import { ErrorUtilities } from '../../error-handling/error.utilities.ts';
import { BadRequestError } from '../../error-handling/errors/bad-request.error.ts';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error.ts';
import { GlobalError } from '../../error-handling/errors/global.error.ts';
import { HttpError } from '../../error-handling/errors/http.error.ts';
import { NotFoundError } from '../../error-handling/errors/not-found.error.ts';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { BeforeAppShutdown } from '../../global/before-app-shutdown.interface.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';
import { OnAppInit } from '../../global/on-app-init.interface.ts';
import { RouteRegistry, RouteRegistryData } from '../../global/route-registry/route.registry.ts';
import { HandlerTimeout } from '../../http/handler-timeout.type.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { MimeType } from '../../http/mime-type.enum.ts';
import { isJsonMimeType } from '../../http/mime-type.helpers.ts';
import { RequestDeadlineUtilities } from '../../http/request-deadline.utilities.ts';
import { $ts } from '../../localization/translate.function.ts';
import { errorToLoggedError } from '../../logging/error-to-logged-error.function.ts';
import { type LoggerInterface } from '../../logging/logger.interface.ts';
import { resolveRouteParams } from '../../routing/resolve-route-params.function.ts';
import { RouteParamMetadata } from '../../routing/route-param-metadata.model.ts';
import { BaseMembership } from '../../tenancy/membership/base-membership.model.ts';
import { ChangedMembership } from '../../tenancy/membership/changed-membership.model.ts';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface.ts';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { validateRequestTenant } from '../../tenancy/validate-request-tenant.function.ts';
import { TraceSpanKind } from '../../tracing/trace-span-kind.enum.ts';
import { TraceSpanStatus } from '../../tracing/trace-span-status.enum.ts';
import { TracingUtilities } from '../../tracing/tracing.utilities.ts';
import { isNewable, Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { optionalPeer } from '../../utilities/optional-peer.function.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function.ts';
import { type ValidationServiceInterface } from '../../validation/validation-service.interface.ts';
import { RouteWithVersionData } from '../../versioning/route-with-version-data.model.ts';
import { SemVerVersion } from '../../versioning/sem-ver.utilities.ts';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model.ts';
import { Version } from '../../versioning/version.model.ts';
import { type VersioningServiceInterface } from '../../versioning/versioning-service.interface.ts';
import { type DataSourceWebsocketAdapter, type DataSourceWebsocketAdapterConstructor, dataSourceWebsocketAdapterClass } from '../data-source.websocket-adapter.ts';
import { WebsocketControllerData } from '../decorators/websocket-controller.decorator.ts';
import { JsonSocketIoEncoder } from '../json.socket-io-encoder.ts';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model.ts';
import { WebsocketAnswer } from '../models/websocket-answer.model.ts';
import { WebsocketChannel } from '../models/websocket-channel.model.ts';
import { WebsocketControllerRouteConfiguration } from '../models/websocket-controller-route-configuration.model.ts';
import { LooseWebsocketEvent, WebsocketEvent } from '../models/websocket-event.enum.ts';
import { WEBSOCKET_MESSAGE_SEQUENCE_NAME, WebsocketMessageSequence, WebsocketMessageSequenceCreateData } from '../models/websocket-message-sequence.model.ts';
import { WebsocketMessage, CreateWebsocketMessageData, WebsocketRecipientType } from '../models/websocket-message.model.ts';
import { type WebsocketOptions } from '../models/websocket-options.model.ts';
import { WebsocketReplayIncomplete } from '../models/websocket-replay-incomplete.model.ts';
import { WebsocketRequest, WebsocketRequestWithConnection } from '../models/websocket-request.model.ts';
import { WebsocketResponseHandler } from '../models/websocket-response.model.ts';
import { WebsocketMessageCleanupCronJob } from '../websocket-message-cleanup.cron-job.ts';

/**
 * Names the room a channel's messages are delivered through.
 *
 * By id rather than by name: a name is unique within a tenant only, and two tenants' channels of one
 * name would otherwise share a room.
 * @param channel - The channel.
 * @returns The room.
 */
function channelRoomOf(channel: WebsocketChannel): string {
    return `zibri.channel:${channel.id}`;
}

/**
 * Names the room a tenant's broadcasts are delivered through, which holds the connections of its members.
 * @param tenantId - The tenant.
 * @returns The room.
 */
function tenantRoomOf(tenantId: string): string {
    return `zibri.tenant:${tenantId}`;
}

/**
 * Names the room holding every connection of one user, on every instance.
 * @param userId - The user.
 * @returns The room.
 */
function userRoomOf(userId: string): string {
    return `zibri.user:${userId}`;
}

/**
 * The event one instance tells the others with that logins of users have ended.
 */
const ENDED_LOGINS_EVENT: string = 'zibri.ended-logins';

/**
 * The event one instance asks the others with to collect what their connections answer to a message.
 */
const ASK_FOR_ANSWERS_EVENT: string = 'zibri.ask-for-answers';

/**
 * The event an instance sends what its connections answered back with.
 */
const ANSWERS_EVENT: string = 'zibri.answers';

/**
 * How much longer than a connection may take to answer the asking instance waits for the others: for
 * the question to reach them, and their answers to come back.
 */
const ANSWERS_TRAVEL_IN_MS: number = 1000;

/**
 * What another instance is asked to collect the answers of its connections for.
 */
type AnswersRequest = {
    /**
     * Matches the answers to the question.
     */
    requestId: string,
    /**
     * The room whose connections are asked, every connection of the instance when undefined.
     */
    room: string | undefined,
    /**
     * The event to send the message as.
     */
    event: string,
    /**
     * The message.
     */
    message: WebsocketMessage
};

/**
 * What one instance sends back: the answers of its connections.
 */
type AnswersReply = {
    /**
     * The question they answer.
     */
    requestId: string,
    /**
     * The answers.
     */
    answers: WebsocketAnswer[]
};

/**
 * The answers of the other instances, while they are still being waited for.
 */
type PendingAnswers = {
    /**
     * What has arrived so far.
     */
    answers: WebsocketAnswer[],
    /**
     * How many instances have not sent theirs yet.
     */
    missingInstances: number,
    /**
     * Stops waiting, and hands over what has arrived.
     */
    finish: () => void
};

/**
 * Narrows what another instance asked for.
 * @param value - What arrived.
 * @returns Whether it is a request for answers.
 */
function isAnswersRequest(value: unknown): value is AnswersRequest {
    return typeof value === 'object' && value != undefined
        && 'requestId' in value && typeof value.requestId === 'string'
        // undefined is not written into json, so a room of every connection arrives as no room at all
        && (!('room' in value) || typeof value.room === 'string')
        && 'event' in value && typeof value.event === 'string'
        && 'message' in value && typeof value.message === 'object' && value.message != undefined;
}

/**
 * Narrows what another instance sent back.
 * @param value - What arrived.
 * @returns Whether it is a reply with answers.
 */
function isAnswersReply(value: unknown): value is AnswersReply {
    return typeof value === 'object' && value != undefined
        && 'requestId' in value && typeof value.requestId === 'string'
        && 'answers' in value && Array.isArray(value.answers);
}

/**
 * The longest delay a timer holds, about 24 days. A credential expiring later is checked then, and
 * its check is scheduled again.
 */
const MAX_TIMER_DELAY_IN_MS: number = 2_147_483_647;

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
    // which connections are in a channel is read off the channel's room rather than kept in a list
    // of its own: a socket that closes or is moved out of a tenant leaves its rooms, and a list beside
    // them kept every connection that had ever joined. The connections of a user are read off the
    // user's room the same way. By socket id, so a connect or disconnect finds its own connection
    // without looking at all the others, which a reconnect storm would do once per socket
    private readonly connections: Map<string, SocketIOWebsocketConnection> = new Map();
    /**
     * The messages currently being handled, so a client that goes away can be answered for.
     *
     * A set rather than a map by connection, because every message leaves it again in a `finally`
     * and a map would need its own emptying when the last message of a connection is over.
     */
    private readonly inFlight: Set<WebsocketRequestContext> = new Set();
    /**
     * The answers this instance is waiting for from the others, by the request they belong to.
     */
    private readonly pendingAnswers: Map<string, PendingAnswers> = new Map();
    /**
     * When each connection's credential is checked again, by the id of the connection: at its expiry.
     */
    private readonly expiryChecks: Map<string, NodeJS.Timeout> = new Map();

    private readonly pendingRouteGroups: Map<string, {
        // eslint-disable-next-line jsdoc-js/require-jsdoc
        entries: { versions: SupportedVersionsOptions, innerHandler: SocketIOWebsocketHandler }[]
    }> = new Map();

    private get versioningService(): VersioningServiceInterface {
        return inject(ZIBRI_DI_TOKENS.VERSIONING_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    private get membershipService(): MembershipServiceInterface {
        return inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE)
        private readonly validationService: ValidationServiceInterface
    ) {}

    // read when used rather than injected, because only an application with websockets provides the
    // input they are built from, and this is built in every application
    private get options(): WebsocketOptions {
        const options: WebsocketOptions | undefined = inject(ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS);
        if (options == undefined) {
            throw new InternalError([
                'An application with websockets has to provide ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,',
                'with how long its messages are kept to be replayed (messageRetentionInMs).'
            ]);
        }
        return options;
    }

    // the three below are read when used rather than injected, so that an application without the
    // entities is told which ones to declare by onAppInit, instead of failing on a repository token
    // while this is built
    private get channelRepository(): Repository<WebsocketChannel> {
        return inject(repositoryTokenFor(WebsocketChannel));
    }
    private get messageRepository(): Repository<WebsocketMessage, CreateWebsocketMessageData> {
        return inject(repositoryTokenFor(WebsocketMessage));
    }
    private get sequenceRepository(): Repository<WebsocketMessageSequence, WebsocketMessageSequenceCreateData> {
        return inject(repositoryTokenFor(WebsocketMessageSequence));
    }

    /**
     * Builds the socket.io adapter from the configured data source, if one was named.
     * @param options - The websocket options.
     * @returns The adapter, or undefined to keep broadcasts inside this instance.
     * @throws When the named data source cannot carry messages between instances.
     */
    private resolveAdapter(options: WebsocketOptions): ServerOptions['adapter'] | undefined {
        if (!options.adapterDataSource) {
            return undefined;
        }

        const dataSource: DataSourceInterface = inject(options.adapterDataSource);
        if (!isPubSubDataSource(dataSource)) {
            throw new InternalError([
                `The data source "${options.adapterDataSource.name}" was configured as the websocket adapter,`,
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
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
        //
        // The input rather than the options: the options are built from it, and fail for an
        // application that has websockets and did not say how long its messages are kept
        const declaresWebsockets: boolean = app.options.websocketControllers.length > 0
            || inject(ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT)?.adapterDataSource != undefined;
        if (!declaresWebsockets) {
            this.logger.info('starts no socket.io server: nothing declares websockets');
            return;
        }
        // read once now, so that an application that has to provide them and did not fails on the
        // way up rather than on its first connection
        const options: WebsocketOptions = this.options;

        // only asked for when there is a server - channels and messages are read and written by
        // nothing else, and every send reads the server before either table
        validateEntitiesRegistered(WebsocketService.name, app, WebsocketChannel, WebsocketMessage, WebsocketMessageSequence);
        await this.initMessageSequence();
        if (!app.options.cronJobs.includes(WebsocketMessageCleanupCronJob)) {
            app.options.cronJobs.push(WebsocketMessageCleanupCronJob);
        }

        this.socketServer = new (optionalPeer<typeof import('socket.io')>('socket.io', 'Websockets').Server)(app.server, {
            connectionStateRecovery: {},
            adapter: this.resolveAdapter(options),
            maxHttpBufferSize: fileSizeToBytes('1mb').toNumber(),
            // a message is written once, by the encoder. The service used to turn it into json and
            // back first, only so socket.io's encoder would not throw on a bigint, which wrote every
            // message three times over. What clients send is read by socket.io's own decoder
            parser: {
                Encoder: JsonSocketIoEncoder,
                Decoder: optionalPeer<typeof import('socket.io-parser')>('socket.io-parser', 'Websockets').Decoder
            }
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
                // no offset is a client with nothing to catch up on, the way socket.io documents
                // connecting. One that was sent is the seq of the last message the client saw, and
                // anything else is said at once rather than read as some other offset (02 §M18)
                const offset: unknown = socket.handshake.auth['offset'];
                if (offset !== undefined && !(typeof offset === 'number' && Number.isInteger(offset) && offset >= 0)) {
                    next(new BadRequestError($ts`The offset has to be a whole number of at least 0.`));
                    return;
                }
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
        // what another instance tells it: the connections of these users that are held here are only
        // checked here
        this.socketServer.on(ENDED_LOGINS_EVENT, (userIds: unknown) => {
            if (!Array.isArray(userIds) || !userIds.every(id => typeof id === 'string')) {
                return;
            }
            // eslint-disable-next-line promise/prefer-await-to-then
            void this.closeEndedLoginsOf(userIds).catch(
                // eslint-disable-next-line promise/prefer-await-to-callbacks
                error => this.logger.error(new InternalError('Could not close the websocket connections of ended logins', { cause: error }))
            );
        });
        this.socketServer.on(ASK_FOR_ANSWERS_EVENT, (request: unknown) => {
            // eslint-disable-next-line promise/prefer-await-to-then
            void this.answerFor(request).catch(
                // eslint-disable-next-line promise/prefer-await-to-callbacks
                error => this.logger.error(new InternalError('Could not collect the answers another instance asked for', { cause: error }))
            );
        });
        this.socketServer.on(ANSWERS_EVENT, (reply: unknown) => this.receiveAnswers(reply));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

        let connection: SocketIOWebsocketConnection | undefined = this.connections.get(socket.id);

        if (connection) {
            // checked at the handshake, so anything but a number is no offset at all
            const offset: unknown = socket.handshake.auth['offset'];
            connection.offset = typeof offset === 'number' ? offset : undefined;
            await this.scheduleExpiryCheck(connection);
            await this.recoverConnection(connection, currentUser);
            return;
        }

        connection = new SocketIOWebsocketConnection(socket, currentUser?.id, resolvedVersion);
        this.connections.set(connection.id, connection);
        // in the user's room before anything else is awaited, because the room is where an ended
        // login looks for the user's connections: joined later, a logout in between would miss it
        if (currentUser) {
            await connection.join(userRoomOf(currentUser.id));
        }
        this.logger.debug('a user connected');

        connection.onDisconnect(() => this.onDisconnect(connection));
        await this.scheduleExpiryCheck(connection);

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
        await connection.join(channels.map(channelRoomOf));
    }

    private async recoverConnection(connection: SocketIOWebsocketConnection, currentUser: BaseUser<string> | undefined): Promise<void> {
        if (connection.recovered) {
            // socket.io restored the rooms and the buffered packets itself, which it can only do on
            // the instance that held the socket in the first place
            return;
        }

        // the tenants whose messages this connection receives: those of no tenant, and those of each
        // tenant its user is a member of. A connection names no tenant of its own, and its messages
        // each name theirs, so this is the one thing that limits what reaches it
        const tenantIds: string[] = currentUser == undefined
            ? []
            : (await this.membershipService.findMemberships<string, BaseMembership<string>>(currentUser.id)).map(m => m.tenantId);
        // eslint-disable-next-line unicorn/no-null
        const reachable: WhereFilter<WebsocketMessage>['tenantId'] = { oneOf: [...tenantIds, null] };

        let channelsOfUser: WebsocketChannel[] = [];
        if (currentUser) {
            await connection.join(tenantIds.map(tenantRoomOf));

            channelsOfUser = await this.channelRepository.findAll({
                where: { userIds: { includes: [currentUser.id] }, tenantId: reachable },
                acrossTenants: true
            });

            await this.rejoinChannels(connection, channelsOfUser);
        }

        // in its rooms whatever the offset, and only the replay depends on it: a client that sent none
        // has nothing to catch up on, like one connecting for the first time
        const offset: number | undefined = connection.offset;
        if (offset == undefined) {
            return;
        }
        const whereFilters: WhereFilter<WebsocketMessage>[] = [
            {
                seq: { greaterThan: offset },
                recipientType: WebsocketRecipientType.ALL,
                tenantId: reachable
            }
        ];
        if (currentUser) {
            whereFilters.push(
                {
                    seq: { greaterThan: offset },
                    recipientType: WebsocketRecipientType.CHANNEL,
                    recipientId: { oneOf: channelsOfUser.map(c => c.id) },
                    tenantId: reachable
                },
                {
                    seq: { greaterThan: offset },
                    recipientType: WebsocketRecipientType.USER,
                    recipientId: currentUser.id,
                    tenantId: reachable
                }
            );
        }

        // asked first, because it is one row, and a client that lost messages is sent none of the rest
        if (await this.hasLostMessagesAfter(offset)) {
            await this.sendReplayIncomplete(connection);
            return;
        }
        const messages: WebsocketMessage[] = await this.messageRepository.findAll({
            // one more than is replayed, which is how a client that missed too many is told apart. The
            // offset is the client's to choose, so this bounds what any connection can make it read
            take: this.options.maxReplayedMessages + 1,
            where: whereFilters,
            acrossTenants: true
        });
        // none of them rather than the first or the last ones: a part of what was missed looks to the
        // client like all of it, and the one thing it can do about a gap is reload, which it is told
        if (messages.length > this.options.maxReplayedMessages) {
            await this.sendReplayIncomplete(connection);
            return;
        }

        for (const m of messages) {
            // without waiting for an answer to each: socket.io keeps the order on a connection and
            // the client tracks the seq, so an answer adds nothing - and waiting for one let a client
            // that never answered hold this for timeoutInMs per message, the first timeout ending it
            await this.send({
                connection,
                event: m.event,
                message: m as WebsocketSendDataMessage,
                expectResponse: false,
                responseHandler: undefined,
                persist: false
            });
        }
    }

    /**
     * Whether messages after an offset are no longer kept.
     * @param offset - The seq of the last message the client saw.
     * @returns True when some of what came after it was deleted.
     */
    private async hasLostMessagesAfter(offset: number): Promise<boolean> {
        // the cleanup deletes from the oldest message on, so what is kept starts right after what was
        // deleted. Messages the client could not have read count as well: telling a client to reload
        // when it did not have to costs a reload, the other way round costs what it never receives
        const [oldest] = await this.messageRepository.findAll({ order: { seq: 'ASC' }, take: 1, acrossTenants: true });
        if (oldest != undefined) {
            return oldest.seq > offset + 1;
        }
        return await this.resolveNewestSeq() > offset;
    }

    /**
     * Tells a reconnecting client that it is not sent what it missed.
     * @param connection - The client.
     */
    private async sendReplayIncomplete(connection: SocketIOWebsocketConnection): Promise<void> {
        const data: WebsocketReplayIncomplete = { seq: await this.resolveNewestSeq() };
        await this.send({
            connection,
            event: WebsocketEvent.REPLAY_INCOMPLETE,
            message: { ok: true, data, senderUserId: undefined, senderConnectionId: undefined },
            expectResponse: false,
            responseHandler: undefined,
            persist: false
        });
    }

    /**
     * Resolves the seq the newest message was given.
     * @returns The seq, or 0 before the first message.
     */
    private async resolveNewestSeq(): Promise<number> {
        const sequence: WebsocketMessageSequence | undefined = await this.sequenceRepository.findOne({
            where: { name: WEBSOCKET_MESSAGE_SEQUENCE_NAME },
            required: false
        });
        return sequence?.seq ?? 0;
    }

    /**
     * Creates the sequence messages draw their seq from, unless it exists.
     */
    private async initMessageSequence(): Promise<void> {
        // continuing from the newest message that is kept, for messages stored before there was a
        // sequence: starting it at 0 would give the next message a seq a client already has. Two
        // instances starting at once both get here, and the second finds the row the first created
        const [newest] = await this.messageRepository.findAll({ order: { seq: 'DESC' }, take: 1, acrossTenants: true });
        await this.sequenceRepository.upsert(
            { name: WEBSOCKET_MESSAGE_SEQUENCE_NAME },
            { name: WEBSOCKET_MESSAGE_SEQUENCE_NAME, seq: newest?.seq ?? 0 },
            { seq: { increment: 0 } }
        );
    }

    private onDisconnect(connection: SocketIOWebsocketConnection): void {
        this.logger.debug('a user disconnected');
        this.abandonMessagesOf(connection);
        clearTimeout(this.expiryChecks.get(connection.id));
        this.expiryChecks.delete(connection.id);
        if (!this.connections.delete(connection.id)) {
            this.logger.warn(`Could not find connection to disconnect with id "${connection.id}"`);
        }
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    registerController(controllerClass: Newable<unknown>): void {
        const controllerData: WebsocketControllerData | undefined = MetadataUtilities.getWebsocketControllerData(controllerClass);
        const currentLatest: SemVerVersion | undefined = GlobalRegistry.getAppData('version');
        assert(currentLatest);
        if (controllerData == undefined) {
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
            // eslint-disable-next-line typescript-js/typedef
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

        if (data.expectResponse) {
            const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection> = await this.emitWithAckTo(
                data.connection,
                data.event,
                message
            );
            return res as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
        }

        data.connection.emit(data.event, message);
        return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
    }

    /**
     * Emits a message to one connection and waits for its answer.
     * @param connection - Who to emit to.
     * @param event - The event to emit.
     * @param message - The message to send.
     * @returns What the connection answered.
     */
    private async emitWithAckTo(
        connection: SocketIOWebsocketConnection,
        event: LooseWebsocketEvent,
        message: WebsocketMessage
    ): Promise<WebsocketRequestWithConnection<SocketIOWebsocketConnection>> {
        return {
            request: await connection.emitWithAck(event, message, this.options.timeoutInMs),
            connection
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async sendToChannel<B extends boolean>(
        data: WebsocketSendToChannelData<B>
    ): Promise<B extends false ? void : WebsocketAnswer[]> {
        data.expectResponse ??= false as B;
        // read first, so an application without websockets is told that, rather than being told
        // about the tables it only needs when it has them
        const server: Server = this.server;
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
            return undefined as B extends false ? void : WebsocketAnswer[];
        }

        if (!data.expectResponse) {
            server.to(channelRoomOf(channel)).emit(data.event, message);
            return undefined as B extends false ? void : WebsocketAnswer[];
        }

        const answers: WebsocketAnswer[] = await this.collectAnswers(channelRoomOf(channel), data.event, message);
        return answers as B extends false ? void : WebsocketAnswer[];
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async sendToAll<B extends boolean>(
        data: WebsocketSendToAllData<B>
    ): Promise<B extends false ? void : WebsocketAnswer[]> {
        data.expectResponse ??= false as B;
        // for the same reason as in sendToChannel
        const server: Server = this.server;
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
            return undefined as B extends false ? void : WebsocketAnswer[];
        }

        // inside a tenant, everyone means the connections of its members - the users who could read
        // what the message is about
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        if (!data.expectResponse) {
            (tenantId == undefined ? server : server.to(tenantRoomOf(tenantId))).emit(data.event, message);
            return undefined as B extends false ? void : WebsocketAnswer[];
        }

        const answers: WebsocketAnswer[] = await this.collectAnswers(
            tenantId == undefined ? undefined : tenantRoomOf(tenantId),
            data.event,
            message
        );
        return answers as B extends false ? void : WebsocketAnswer[];
    }

    /**
     * Sends a message to the connections in a room, on every instance, and waits for each to answer.
     * @param room - The room, every connection when undefined.
     * @param event - The event to send the message as.
     * @param message - The message.
     * @returns What each connection answered.
     */
    private async collectAnswers(
        room: string | undefined,
        event: LooseWebsocketEvent,
        message: WebsocketMessage
    ): Promise<WebsocketAnswer[]> {
        // a server of one instance has nobody to ask, and its adapter refuses to try
        if (this.options.adapterDataSource == undefined) {
            return await this.collectLocalAnswers(room, event, message);
        }
        const [own, others] = await Promise.all([
            this.collectLocalAnswers(room, event, message),
            this.askOtherInstances(room, event, message)
        ]);
        return [...own, ...others];
    }

    /**
     * Sends a message to the connections in a room held by this instance, and waits for each to answer.
     * @param room - The room, every connection of this instance when undefined.
     * @param event - The event to send the message as.
     * @param message - The message.
     * @returns What each connection answered.
     */
    private async collectLocalAnswers(
        room: string | undefined,
        event: LooseWebsocketEvent,
        message: WebsocketMessage
    ): Promise<WebsocketAnswer[]> {
        const recipients: SocketIOWebsocketConnection[] = room == undefined
            ? [...this.connections.values()]
            : this.findLocalConnectionsIn(room);
        return await Promise.all(recipients.map(async c => await this.resolveAnswer(c, event, message)));
    }

    /**
     * Sends a message to one connection and waits for its answer.
     * @param connection - The connection.
     * @param event - The event to send the message as.
     * @param message - The message.
     * @returns What it answered, or why it did not.
     */
    private async resolveAnswer(
        connection: SocketIOWebsocketConnection,
        event: LooseWebsocketEvent,
        message: WebsocketMessage
    ): Promise<WebsocketAnswer> {
        try {
            const request: WebsocketRequest = await connection.emitWithAck(event, message, this.options.timeoutInMs);
            return { request, connectionId: connection.id, userId: connection.userId };
        }
        catch (error) {
            // as a LoggedError, which is json: an answer collected on another instance is sent here as
            // json, and an Error is written as {}
            const failure: Error = error instanceof Error ? error : new Error(String(error));
            return {
                request: { body: { error: errorToLoggedError(failure) }, headers: {}, params: {}, query: {} },
                connectionId: connection.id,
                userId: connection.userId
            };
        }
    }

    /**
     * Asks the other instances for what the connections in a room they hold answer to a message.
     *
     * Waits until every instance this one knows of has sent its answers, or until a connection could
     * have answered and the answers come back. An instance that stopped since its last heartbeat
     * is still counted, so past that its answers are given up on.
     * @param room - The room, every connection when undefined.
     * @param event - The event to send the message as.
     * @param message - The message.
     * @returns What their connections answered.
     */
    private async askOtherInstances(
        room: string | undefined,
        event: LooseWebsocketEvent,
        message: WebsocketMessage
    ): Promise<WebsocketAnswer[]> {
        const server: Server = this.server;
        const otherInstances: number = await server.of('/').adapter.serverCount() - 1;
        if (otherInstances <= 0) {
            return [];
        }
        const request: AnswersRequest = { requestId: UUIDUtilities.generate(), room, event, message };
        return await new Promise(resolve => {
            const pending: PendingAnswers = { answers: [], missingInstances: otherInstances, finish: () => undefined };
            const deadline: NodeJS.Timeout = setTimeout(() => {
                this.logger.warn(
                    `${pending.missingInstances} of ${otherInstances} other instances did not send the answers`
                    + ' of their websocket connections in time, which are left out'
                );
                pending.finish();
            }, this.options.timeoutInMs + ANSWERS_TRAVEL_IN_MS);
            pending.finish = () => {
                clearTimeout(deadline);
                this.pendingAnswers.delete(request.requestId);
                resolve(pending.answers);
            };
            this.pendingAnswers.set(request.requestId, pending);
            server.serverSideEmit(ASK_FOR_ANSWERS_EVENT, request);
        });
    }

    /**
     * Collects what the connections of this instance answer, for another instance that asked.
     * @param request - What the other instance asked.
     */
    private async answerFor(request: unknown): Promise<void> {
        if (!isAnswersRequest(request)) {
            return;
        }
        const reply: AnswersReply = {
            requestId: request.requestId,
            answers: await this.collectLocalAnswers(request.room, request.event, request.message)
        };
        this.server.serverSideEmit(ANSWERS_EVENT, reply);
    }

    /**
     * Takes the answers another instance sent, if this instance is waiting for them.
     * @param reply - What the other instance sent.
     */
    private receiveAnswers(reply: unknown): void {
        if (!isAnswersReply(reply)) {
            return;
        }
        // every instance hears every reply: one this instance did not ask for, or no longer waits
        // for, belongs to nobody here
        const pending: PendingAnswers | undefined = this.pendingAnswers.get(reply.requestId);
        if (pending == undefined) {
            return;
        }
        pending.answers.push(...reply.answers);
        pending.missingInstances--;
        if (pending.missingInstances <= 0) {
            pending.finish();
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    disconnect(connection: SocketIOWebsocketConnection, close: boolean = true): void {
        connection.disconnect(close);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async joinChannel(connection: SocketIOWebsocketConnection, channelId: string): Promise<void> {
        const channel: WebsocketChannel = await this.channelRepository.findById(channelId);
        if (connection.isIn(channelRoomOf(channel))) {
            this.logger.warn(`The connection with id ${connection.id} has already joined the channel ${channel.name}.`);
            return;
        }

        if (connection.userId && !channel.userIds.includes(connection.userId)) {
            channel.userIds.push(connection.userId);
            // across tenants, so that a channel every tenant shares is joined from inside one. The
            // channel was found by the read above, as the active tenant, so this reaches no other
            await this.channelRepository.updateById(channel.id, { userIds: channel.userIds }, { acrossTenants: true });
        }
        await connection.join(channelRoomOf(channel));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async leaveChannel(connection: SocketIOWebsocketConnection, channelId: string): Promise<void> {
        const channel: WebsocketChannel = await this.channelRepository.findById(channelId);
        if (connection.userId && channel.userIds.includes(connection.userId)) {
            channel.userIds.splice(channel.userIds.indexOf(connection.userId), 1);
            // across tenants, for the reason joinChannel gives
            await this.channelRepository.updateById(channel.id, { userIds: channel.userIds }, { acrossTenants: true });
        }
        await connection.leave(channelRoomOf(channel));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async updateTenantRooms(memberships: ChangedMembership[]): Promise<void> {
        const server: Server | undefined = this.socketServer;
        if (server == undefined) {
            return;
        }
        await Promise.all(memberships.map(async ({ userId, tenantId }) => {
            // what is stored now rather than what the write did, so that a membership deleted while
            // another one of the user in that tenant remains keeps the connection where it is
            const isMember: boolean = await this.membershipService.findMembership(userId, tenantId) != undefined;
            // through the room of the user, which reaches their connections on every instance
            const connections: ReturnType<Server['in']> = server.in(userRoomOf(userId));
            if (isMember) {
                // the tenant's channels the user is in, as a reconnect would join them
                const ofUser: WebsocketChannel[] = await this.channelRepository.findAll({
                    where: { tenantId, userIds: { includes: [userId] } },
                    acrossTenants: true
                });
                connections.socketsJoin([tenantRoomOf(tenantId), ...ofUser.map(channelRoomOf)]);
                return;
            }
            // every channel of the tenant, whichever the connection joined. The user stays in their
            // userIds, so the channels are theirs again once they are a member again
            const ofTenant: WebsocketChannel[] = await this.channelRepository.findAll({ where: { tenantId }, acrossTenants: true });
            connections.socketsLeave([tenantRoomOf(tenantId), ...ofTenant.map(channelRoomOf)]);
        }));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async disconnectEndedLogins(userIds: string[], transaction: Transaction | undefined): Promise<void> {
        const server: Server | undefined = this.socketServer;
        if (server == undefined || !userIds.length) {
            return;
        }
        const handle: () => Promise<void> = async () => {
            // a server of one instance has nobody to tell, and its adapter refuses to try
            if (this.options.adapterDataSource != undefined) {
                server.serverSideEmit(ENDED_LOGINS_EVENT, userIds);
            }
            await this.closeEndedLoginsOf(userIds);
        };
        // once committed: until then the logins have not ended, and a rollback means they never did
        if (transaction == undefined) {
            await handle();
            return;
        }
        transaction.afterCommit(handle);
    }

    /**
     * Closes the connections held by this instance of the given users whose login has ended.
     * @param userIds - The users.
     */
    private async closeEndedLoginsOf(userIds: string[]): Promise<void> {
        const ofUsers: SocketIOWebsocketConnection[] = [...new Set(userIds)].flatMap(id => this.findConnectionsByUserId(id));
        await Promise.all(ofUsers.map(async c => await this.closeIfLoginEnded(c)));
    }

    /**
     * Closes a connection whose credential no longer resolves to its user.
     *
     * Asked of the credential it connected with, the way a request carrying it would be: so a logout
     * ends the socket of the login that logged out and leaves the user's other logins connected, and a
     * credential that keeps working over http until it expires keeps its socket as long.
     * @param connection - The connection.
     */
    private async closeIfLoginEnded(connection: SocketIOWebsocketConnection): Promise<void> {
        const context: WebsocketRequestContext = new WebsocketRequestContext(connection.handshakeRequest, undefined, undefined, undefined);
        const user: BaseUser<string> | undefined = await this.authService.getCurrentUser(context, this.authService.strategies, false);
        if (user != undefined && user.id === connection.userId) {
            await this.scheduleExpiryCheck(connection);
            return;
        }
        this.disconnect(connection, true);
    }

    /**
     * Checks a connection's credential again when it expires.
     * @param connection - The connection.
     */
    private async scheduleExpiryCheck(connection: SocketIOWebsocketConnection): Promise<void> {
        clearTimeout(this.expiryChecks.get(connection.id));
        this.expiryChecks.delete(connection.id);
        if (connection.userId == undefined) {
            return;
        }
        const context: WebsocketRequestContext = new WebsocketRequestContext(connection.handshakeRequest, undefined, undefined, undefined);
        const expiresAt: Date | undefined = await this.authService.resolveCredentialExpiry(context);
        // a credential still accepted past the expiry it names would be checked again at once, forever
        if (expiresAt == undefined || expiresAt.getTime() <= Date.now()) {
            return;
        }
        const check: NodeJS.Timeout = setTimeout(
            // eslint-disable-next-line promise/prefer-await-to-then
            () => void this.closeIfLoginEnded(connection).catch(
                // eslint-disable-next-line promise/prefer-await-to-callbacks
                error => this.logger.error(new InternalError('Could not check the credential of a websocket connection', { cause: error }))
            ),
            Math.min(Math.max(expiresAt.getTime() - Date.now(), 0), MAX_TIMER_DELAY_IN_MS)
        );
        // a pending check is no reason to keep the process alive
        check.unref();
        this.expiryChecks.set(connection.id, check);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    getConnections(): SocketIOWebsocketConnection[] {
        return [...this.connections.values()];
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    findConnectionById(id: string): SocketIOWebsocketConnection {
        const foundConnection: SocketIOWebsocketConnection | undefined = this.connections.get(id);
        if (!foundConnection) {
            throw new NotFoundError($ts`Could not find connection with id "${id}".`);
        }
        return foundConnection;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    findConnectionsByUserId(userId: string): SocketIOWebsocketConnection[] {
        return this.findLocalConnectionsIn(userRoomOf(userId));
    }

    /**
     * Finds the connections in a room that this instance holds.
     * @param room - The room.
     * @returns The connections.
     */
    private findLocalConnectionsIn(room: string): SocketIOWebsocketConnection[] {
        // socket.io's own index of the rooms of this instance, so only the room's sockets are looked at
        const socketIds: Set<string> = this.socketServer?.sockets.adapter.rooms.get(room) ?? new Set();
        return [...socketIds].map(id => this.connections.get(id)).filter(c => c != undefined);
    }

    private createDispatchHandler(
        // eslint-disable-next-line jsdoc-js/require-jsdoc
        entries: { versions: SupportedVersionsOptions, innerHandler: SocketIOWebsocketHandler }[]
    ): SocketIOWebsocketHandler {
        return async (connection, req, responseHandler) => {
            try {
                // eslint-disable-next-line typescript-js/typedef
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
            && !isJsonMimeType(routeData.params.body.type)
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
                        // per message rather than per connection, for the reason the trace is: every
                        // message is checked on its own, the membership in its tenant included
                        const named: string | undefined = await this.tenantService.resolveTenant(req);
                        validateRequestTenant(named);
                        // for the reason the router gives
                        const tenantId: string | undefined = named ?? await this.authService.resolveCredentialTenant(context);
                        const handle: () => Promise<void> = async () => {
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
                        };
                        await (tenantId == undefined ? handle() : this.tenantService.runAs(tenantId, handle));
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
                        // the error itself rather than a wrapper, for the reason handleLogging in
                        // error-handler.ts gives
                        if (!ErrorUtilities.isError(error)) {
                            this.logger.critical(new GlobalError(error));
                        }
                        else if (err.status >= 500) {
                            this.logger.error(error);
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