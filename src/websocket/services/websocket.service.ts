import assert from 'node:assert';

import { Server, Socket } from 'socket.io';

import { WebsocketSendData, WebsocketSendDataMessage, WebsocketSendToAllData, WebsocketSendToChannelData, WebsocketServiceInterface } from './websocket-service.interface';
import { ZibriApplication } from '../../application';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { BaseUser } from '../../auth/models/base-user.model';
import { AlsUtilities } from '../../context/als.utilities';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { WhereFilter } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { ErrorUtilities } from '../../error-handling/error.utilities';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { HttpError } from '../../error-handling/errors/http.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { BeforeAppShutdown } from '../../global/before-app-shutdown.interface';
import { GlobalRegistry } from '../../global/global-registry';
import { OnAppInit } from '../../global/on-app-init.interface';
import { HttpStatus } from '../../http/http-status.enum';
import { KnownHeader } from '../../http/known-header.enum';
import { $ts } from '../../localization/translate.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { resolveRouteParams } from '../../routing/resolve-route-params.function';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { type ValidationServiceInterface } from '../../validation/validation-service.interface';
import { RouteWithVersionData } from '../../versioning/route-with-version-data.model';
import { SupportedVersionsOptions } from '../../versioning/supported-versions-options.model';
import { Version } from '../../versioning/version.model';
import { type VersioningServiceInterface } from '../../versioning/versioning-service.interface';
import { WebsocketControllerData } from '../decorators/websocket-controller.decorator';
import { SocketIOWebsocketConnection } from '../models/connection/socket-io-websocket-connection.model';
import { WebsocketChannel } from '../models/websocket-channel.model';
import { WebsocketControllerRouteConfiguration } from '../models/websocket-controller-route-configuration.model';
import { WebsocketEvent } from '../models/websocket-event.enum';
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
    private socketServer!: Server;
    private readonly allEventRoutes: RouteWithVersionData[] = [];
    private readonly websocketHandlers: Record<string, SocketIOWebsocketHandler | undefined> = {};
    private readonly websocketChannels: Record<string, SocketIOWebsocketConnection[] | undefined> = {};
    private readonly connections: SocketIOWebsocketConnection[] = [];

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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        this.socketServer = new Server(app.server, { connectionStateRecovery: {} });

        await this.logger.info('starts socket.io server');

        await this.logger.info(`registers ${app.options.websocketControllers.length} websocket controllers:`);
        for (const controller of app.options.websocketControllers) {
            const routes: WebsocketControllerRouteConfiguration[] = MetadataUtilities.getWebsocketControllerRoutes(controller);
            await this.logger.info(`  - ${controller.name} (${routes.length} routes)`);
            await this.registerController(controller);
        }
        this.checkForOrphanedControllers(app.options.websocketControllers);

        for (const [event, group] of this.pendingRouteGroups.entries()) {
            this.websocketHandlers[event] = this.createDispatchHandler(group.entries);
            await this.logger.debug(`- mounting websocket event "${event}"`);
        }

        // eslint-disable-next-line typescript/no-misused-promises
        this.socketServer.use(async (socket, next) => {
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
                next(new UnauthorizedError($ts`Not allowed to connect`));
                return;
            }

            try {
                const version: Version = await context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_VERSION);
                // eslint-disable-next-line typescript/no-unsafe-member-access
                socket.data.resolvedVersion = version;
                // eslint-disable-next-line typescript/no-unsafe-member-access
                socket.data.currentUser = currentUser;
                next();
            }
            catch (error) {
                next(error instanceof Error ? error : new Error('Could not resolve version', { cause: error }));
            }
        });
        this.socketServer.on('connection', async socket => await this.onConnect(socket));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async beforeAppShutdown(): Promise<void> {
        await this.socketServer.close();
    }

    private async onConnect(socket: Socket): Promise<void> {
        // eslint-disable-next-line typescript/no-unsafe-member-access
        const currentUser: BaseUser<string> | undefined = socket.data.currentUser as BaseUser<string> | undefined;
        // eslint-disable-next-line typescript/no-unsafe-member-access
        const resolvedVersion: Version = socket.data.resolvedVersion as Version;

        let connection: SocketIOWebsocketConnection | undefined = this.connections.find(c => c.id === socket.id);

        if (connection) {
            connection.offset = socket.handshake.auth.offset as number;
            await this.recoverConnection(connection, currentUser);
            return;
        }

        connection = new SocketIOWebsocketConnection(socket, currentUser?.id, resolvedVersion);
        this.connections.push(connection);
        await this.logger.debug('a user connected');

        connection.onDisconnect(() => this.onDisconnect(connection));

        connection.onAny(async (ev: string, ...args: unknown[]) => {
            await this.logger.debug(`got an event "${ev}"`);

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
                const globalError: Error = new Error('Global Error', { cause: error });
                globalError.stack = undefined;
                let persist: boolean = false;
                if (ErrorUtilities.isError(error)) {
                    if (!ErrorUtilities.isHttpError(error) || error.status >= 500) {
                        await this.logger.error(globalError);
                        persist = true;
                    }
                }
                else {
                    await this.logger.critical(globalError);
                    persist = true;
                }

                await this.logger.debug(`got an error ${JsonUtilities.stringify(globalError)}`);

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

    private async recoverConnection(connection: SocketIOWebsocketConnection, currentUser: BaseUser<string> | undefined): Promise<void> {
        if (connection.recovered) {
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

    private async onDisconnect(connection: SocketIOWebsocketConnection): Promise<void> {
        await this.logger.debug('a user disconnected');
        const foundConnection: SocketIOWebsocketConnection | undefined = this.connections.find(c => c.id === connection.id);
        if (!foundConnection) {
            await this.logger.warn(`Could not find connection to disconnect with id "${connection.id}"`);
            return;
        }
        this.connections.splice(this.connections.indexOf(foundConnection), 1);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async registerController(controllerClass: Newable<unknown>): Promise<void> {
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

            const innerHandler: SocketIOWebsocketHandler = this.controllerRouteToWebsocketHandler(controllerClass, route);
            // eslint-disable-next-line typescript/typedef
            const existing = this.pendingRouteGroups.get(fullEvent);
            if (existing) {
                existing.entries.push({ versions, innerHandler });
            }
            else {
                this.pendingRouteGroups.set(fullEvent, { entries: [{ versions, innerHandler }] });
            }
            await this.logger.debug(`- registering websocket event "${fullEvent}"`);
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

        if (data.expectResponse) {
            const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection> = {
                request: await data.connection.emitWithAck(
                    data.event,
                    JsonUtilities.parse(JsonUtilities.stringify(message)),
                    this.options.timeoutInMs
                ),
                connection: data.connection
            };
            return res as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
        }

        data.connection.emit(data.event, JsonUtilities.parse(JsonUtilities.stringify(message)));
        return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
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
            this.socketServer.to(channel.name).emit(data.event, JsonUtilities.parse(JsonUtilities.stringify(message)));
            return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[];
        }

        const connections: SocketIOWebsocketConnection[] = this.websocketChannels[channel.name] ?? [];
        const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection>[] = await Promise.all(
            connections.map(async c => {
                try {
                    const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection> = await this.send({
                        connection: c,
                        ...data,
                        message: message as WebsocketSendDataMessage,
                        persist: false
                    }) as WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
                    return res;
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
            this.socketServer.emit(data.event, JsonUtilities.parse(JsonUtilities.stringify(message)));
            return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[];
        }

        const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection>[] = await Promise.all(
            this.connections.map(async c => {
                try {
                    const res: WebsocketRequestWithConnection<SocketIOWebsocketConnection> = await this.send({
                        connection: c,
                        ...data,
                        message: message as WebsocketSendDataMessage,
                        persist: false
                    }) as WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
                    return res;
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
            await this.logger.warn(`The connection with id ${connection.id} has already joined the channel ${channel.name}.`);
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
        route: WebsocketControllerRouteConfiguration
    ): SocketIOWebsocketHandler {
        const handler: SocketIOWebsocketHandler = async (
            connection: SocketIOWebsocketConnection,
            req: WebsocketRequest,
            ack: WebsocketResponseHandler | undefined
        ) => {
            const context: WebsocketRequestContext = new WebsocketRequestContext(req, connection, controllerClass, route.controllerMethod);
            await AlsUtilities.runWithWebsocketRequestContext(context, async () => {
                try {
                    await this.authService.checkAccess(controllerClass, route.controllerMethod, context);
                    const controller: unknown = inject(controllerClass);
                    const params: unknown[] = await this.resolveRouteParams(
                        controllerClass,
                        route.controllerMethod,
                        // eslint-disable-next-line typescript/no-unsafe-member-access, typescript/no-explicit-any
                        ((controller as any)[route.controllerMethod] as Function).length,
                        context
                    );

                    // eslint-disable-next-line typescript/no-unsafe-call, typescript/no-explicit-any, typescript/no-unsafe-member-access
                    const res: unknown = await ((controller as any)[route.controllerMethod] as Function)(...params) as unknown;
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
                    const err: HttpError = ErrorUtilities.toHttpError(error);
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
                        await this.logger.error(globalError);
                    }
                }
            });
        };
        return handler;
    }

    private checkForOrphanedControllers(controllers: Newable<unknown>[]): void {
        const orphanedControllers: Newable<unknown>[] = GlobalRegistry.websocketControllerClasses.filter(c => {
            return !controllers.includes(c) && !(MetadataUtilities.getWebsocketControllerData(c)?.allowOrphan ?? false);
        });
        if (orphanedControllers.length) {
            const message: string[] = ['Error initializing websocket service.', 'Found orphaned controllers:'];
            for (const controller of orphanedControllers) {
                message.push(`  - ${controller.name}`);
            }
            message.push('Did you forget to add them to your websocketControllers array?');
            throw new Error(message.join('\n'));
        }
    }

    private async resolveRouteParams(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        totalParamCount: number,
        context: WebsocketRequestContext
    ): Promise<unknown[]> {
        return await resolveRouteParams(
            controllerClass,
            controllerMethod,
            totalParamCount,
            context
        );
    }
}