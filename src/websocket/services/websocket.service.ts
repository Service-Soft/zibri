
import { Server, Socket } from 'socket.io';

import { WebsocketSendData, WebsocketSendDataMessage, WebsocketSendToAllData, WebsocketSendToChannelData, WebsocketServiceInterface } from './websocket-service.interface';
import { ZibriApplication } from '../../application';
import { BaseUser, type AuthServiceInterface } from '../../auth';
import { Repository, WhereFilter } from '../../data-source';
import { inject, Inject, InjectRepository, ZIBRI_DI_TOKENS } from '../../di';
import { BadRequestError, HttpError, isError, isHttpError, NotFoundError, toHttpError } from '../../error-handling';
import { GlobalRegistry } from '../../global';
import { HttpStatus, KnownHeader } from '../../http';
import type { LoggerInterface } from '../../logging';
import type { ParserInterface } from '../../parsing';
import { resolveRouteParams } from '../../routing/resolve-route-params.function';
import { Newable } from '../../types';
import { MetadataUtilities, UUIDUtilities } from '../../utilities';
import type { ValidationServiceInterface } from '../../validation';
import { WebsocketControllerData } from '../decorators';
import { WebsocketRequest, WebsocketControllerRouteConfiguration, SocketIOWebsocketConnection, WebsocketEvent, WebsocketResponseHandler, WebsocketChannel, BaseWebsocketConnection, WebsocketMessage, CreateWebsocketMessageData, WebsocketRecipientType, WebsocketRequestWithConnection } from '../models';

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
export class WebsocketService implements WebsocketServiceInterface<SocketIOWebsocketConnection> {
    private socketServer!: Server;
    private readonly websocketHandlers: Record<string, SocketIOWebsocketHandler | undefined> = {};
    private readonly websocketChannels: Record<string, SocketIOWebsocketConnection[] | undefined> = {};
    private readonly connections: SocketIOWebsocketConnection[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.PARSER)
        private readonly parser: ParserInterface,
        @Inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE)
        private readonly validationService: ValidationServiceInterface,
        @InjectRepository(WebsocketChannel)
        private readonly channelRepository: Repository<WebsocketChannel>,
        @InjectRepository(WebsocketMessage)
        private readonly messageRepository: Repository<WebsocketMessage, CreateWebsocketMessageData>
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async attachTo(app: ZibriApplication): Promise<void> {
        this.socketServer = new Server(app.server, { connectionStateRecovery: {} });

        await this.logger.info('starts socket.io server');

        await this.logger.info(`registers ${app.options.websocketControllers.length} websocket controllers:`);
        for (const controller of app.options.websocketControllers) {
            const routes: WebsocketControllerRouteConfiguration[] = MetadataUtilities.getWebsocketControllerRoutes(controller);
            await this.logger.info(`  - ${controller.name} (${routes.length} routes)`);
            await this.registerController(controller);
        }
        this.checkForOrphanedControllers(app.options.websocketControllers);

        this.socketServer.on('connection', socket => this.onConnect(socket));
    }

    private async onConnect(socket: Socket): Promise<void> {
        const websocketRequest: WebsocketRequest = {
            headers: socket.handshake.headers as Partial<Record<KnownHeader, string | undefined>>,
            body: undefined,
            query: socket.handshake.query as Partial<Record<string, string | undefined>>,
            params: {}
        };
        const currentUser: BaseUser<string> | undefined = await this.authService.getCurrentUser(
            websocketRequest,
            this.authService.strategies,
            false
        );

        let connection: SocketIOWebsocketConnection | undefined = this.connections.find(c => c.id === socket.id);
        if (connection) {
            connection.offset = socket.handshake.auth.offset as number;
            await this.recoverConnection(connection, currentUser);
            return;
        }

        connection = new SocketIOWebsocketConnection(socket, currentUser?.id);
        // TODO: implement
        // authenticate and authorize that the connected user is allowed to connect to a websocket at all
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
                const error: HttpError = new NotFoundError(`Could not find websocket event "${ev}"`);
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
                const error: HttpError = new BadRequestError('There should only be one message sent.');
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
                this.validationService.validateWebsocketRequest(req);
                await handler(connection, req as WebsocketRequest, responseHandler);
                return;
            }
            catch (error) {
                const globalError: Error = new Error('Global Error', { cause: error });
                globalError.stack = undefined;
                let persist: boolean = false;
                if (isError(error)) {
                    if (!isHttpError(error) || error.status >= 500) {
                        await this.logger.error(globalError);
                        persist = true;
                    }
                }
                else {
                    await this.logger.critical(globalError);
                    persist = true;
                }

                await this.logger.debug(`got an error ${JSON.stringify(globalError)}`);

                await this.send({
                    connection,
                    event: WebsocketEvent.RESPONSE,
                    message: {
                        ok: false,
                        error: toHttpError(error),
                        status: toHttpError(error).status,
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
            where: whereFilters,
            order: { seq: 'ASC' }
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
        const controllerData: WebsocketControllerData | undefined = MetadataUtilities.getWebsocketController(controllerClass);
        if (controllerData == undefined) {
            // eslint-disable-next-line stylistic/max-len
            throw new Error(`Could not find websocket controller data on class ${controllerClass.name}. Did you forget to decorate it with @WebsocketController?`);
        }
        const routes: WebsocketControllerRouteConfiguration[] = MetadataUtilities.getWebsocketControllerRoutes(controllerClass);

        for (const route of routes) {
            const handler: SocketIOWebsocketHandler = this.controllerRouteToWebsocketHandler(
                controllerClass,
                route
            );
            if (this.websocketHandlers[route.event]) {
                throw new Error(
                    `The websocket event "${route.event}" has been defined more than once.`,
                    { cause: controllerClass }
                );
            }
            await this.logger.debug(`- mounting websocket event "${route.event}"`);

            this.websocketHandlers[route.event] = handler;
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
                request: await data.connection.emitWithAck(data.event, message),
                connection: data.connection
            };
            return res as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
        }

        data.connection.emit(data.event, message);
        return undefined as B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async sendToChannel<B extends boolean>(
        data: WebsocketSendToChannelData<B>
    ): Promise<B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[]> {
        data.expectResponse ??= true as B;
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
            this.socketServer.to(channel.name).emit(data.event, message);
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
        data: WebsocketSendToAllData<B>,
        expectResponse: B = true as B
    ): Promise<B extends false ? void : WebsocketRequestWithConnection<SocketIOWebsocketConnection>[]> {
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

        if (!expectResponse) {
            this.socketServer.emit(data.event, message);
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

        const foundChannel: SocketIOWebsocketConnection | undefined = this.websocketChannels[channel.name]?.find(c => c.id === channel.id);
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
            throw new NotFoundError(`Could not find connection with id "${id}".`);
        }
        return foundConnection;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findConnectionByUserId(userId: string): SocketIOWebsocketConnection {
        const foundConnection: SocketIOWebsocketConnection | undefined = this.connections.find(c => c.userId === userId);
        if (!foundConnection) {
            throw new NotFoundError(`Could not find connection with userId "${userId}".`);
        }
        return foundConnection;
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
            try {
                await this.authService.checkAccess(controllerClass, route.controllerMethod, req);
                const controller: unknown = inject(controllerClass);
                const params: unknown[] = await this.resolveRouteParams(
                    controllerClass,
                    route.controllerMethod,
                    // eslint-disable-next-line typescript/no-unsafe-member-access, typescript/no-explicit-any
                    ((controller as any)[route.controllerMethod] as Function).length,
                    req,
                    connection
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
                const err: HttpError = toHttpError(error);
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
                    persist: !isHttpError(error) || error.status >= 500
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
        };
        return handler;
    }

    private checkForOrphanedControllers(controllers: Newable<unknown>[]): void {
        const orphanedControllers: Newable<unknown>[] = GlobalRegistry.websocketControllerClasses.filter(c => {
            return !controllers.includes(c);
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
        req: WebsocketRequest,
        connection: BaseWebsocketConnection
    ): Promise<unknown[]> {
        return await resolveRouteParams(
            controllerClass,
            controllerMethod,
            totalParamCount,
            req,
            this.parser,
            this.validationService,
            this.authService,
            connection
        );
    }
}