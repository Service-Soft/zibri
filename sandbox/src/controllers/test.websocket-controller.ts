import { WebsocketController, WebsocketBody, WebsocketRoute, Property, Inject, ZIBRI_DI_TOKENS, WebsocketService, BaseWebsocketConnection, CurrentWebsocketConnection } from 'zibri';

export class CreateWebsocketChatMessageDTO {
    @Property.string()
    message!: string;
}

@WebsocketController()
export class TestWebsocketController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.WEBSOCKET_SERVICE)
        private readonly websocketService: WebsocketService
    ) {}

    @WebsocketRoute('chat message')
    async receiveChatMessage(
        @WebsocketBody(CreateWebsocketChatMessageDTO)
        message: CreateWebsocketChatMessageDTO,
        @CurrentWebsocketConnection()
        connection: BaseWebsocketConnection
    ): Promise<void> {
        await this.websocketService.sendToAll({
            event: 'chat message',
            message: {
                ok: true,
                data: message,
                senderUserId: connection.userId,
                senderConnectionId: connection.id
            }
        });
    }
}