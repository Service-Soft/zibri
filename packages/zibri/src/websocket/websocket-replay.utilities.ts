import { SocketIOWebsocketConnection } from './models/connection/socket-io-websocket-connection.model';
import { WebsocketChannel } from './models/websocket-channel.model';
import { WebsocketEvent } from './models/websocket-event.enum';
import { WEBSOCKET_MESSAGE_SEQUENCE_NAME, WebsocketMessageSequence, WebsocketMessageSequenceCreateData } from './models/websocket-message-sequence.model';
import { CreateWebsocketMessageData, WebsocketMessage, WebsocketRecipientType } from './models/websocket-message.model';
import { WebsocketReplayIncomplete } from './models/websocket-replay-incomplete.model';
import { WebsocketSendDataMessage, WebsocketServiceInterface } from './services/websocket-service.interface';
import { type CurrentUser } from '../auth/decorators/current-user.decorator';
import { WhereFilter } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';

/**
 * Sends a client that reconnects the messages it missed while it was away.
 */
export abstract class WebsocketReplayUtilities {
    // read when used rather than held, so that an application without the entities is told which
    // ones to declare by the websocket service's onAppInit, instead of failing on a repository token
    private static get messageRepository(): Repository<WebsocketMessage, CreateWebsocketMessageData> {
        return inject(repositoryTokenFor(WebsocketMessage));
    }
    private static get sequenceRepository(): Repository<WebsocketMessageSequence, WebsocketMessageSequenceCreateData> {
        return inject(repositoryTokenFor(WebsocketMessageSequence));
    }

    /**
     * Creates the sequence messages draw their seq from, unless it exists.
     */
    static async initSequence(): Promise<void> {
        // continuing from the newest message that is kept, for messages stored before there was a
        // sequence: starting it at 0 would give the next message a seq a client already has. Two
        // instances starting at once both get here, and the second finds the row the first created
        const [newest] = await this.messageRepository.findAll({ order: { seq: 'DESC' }, limit: 1, acrossTenants: true });
        await this.sequenceRepository.upsert(
            { name: WEBSOCKET_MESSAGE_SEQUENCE_NAME },
            { name: WEBSOCKET_MESSAGE_SEQUENCE_NAME, seq: newest?.seq ?? 0 },
            { seq: { increment: 0 } }
        );
    }

    /**
     * Sends a connection every message stored after the offset its client reconnected with, or tells
     * it that they are not all kept.
     * @param service - What the messages are sent through.
     * @param connection - The connection, with the offset its client sent.
     * @param currentUser - Its user, if it is logged in.
     * @param channels - The channels its user is a member of.
     * @param reachable - The tenants whose messages reach it.
     * @param maxReplayedMessages - The most messages it is sent, past which it is told to reload instead.
     */
    static async replay(
        service: WebsocketServiceInterface<SocketIOWebsocketConnection>,
        connection: SocketIOWebsocketConnection,
        currentUser: CurrentUser | undefined,
        channels: WebsocketChannel[],
        reachable: WhereFilter<WebsocketMessage>['tenantId'],
        maxReplayedMessages: number
    ): Promise<void> {
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
                    recipientId: { oneOf: channels.map(c => c.id) },
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
            await this.sendReplayIncomplete(service, connection);
            return;
        }
        const messages: WebsocketMessage[] = await this.messageRepository.findAll({
            // one more than is replayed, which is how a client that missed too many is told apart. The
            // offset is the client's to choose, so this bounds what any connection can make it read
            limit: maxReplayedMessages + 1,
            where: whereFilters,
            acrossTenants: true
        });
        // none of them rather than the first or the last ones: a part of what was missed looks to the
        // client like all of it, and the one thing it can do about a gap is reload, which it is told
        if (messages.length > maxReplayedMessages) {
            await this.sendReplayIncomplete(service, connection);
            return;
        }

        for (const m of messages) {
            // without waiting for an answer to each: socket.io keeps the order on a connection and
            // the client tracks the seq, so an answer adds nothing - and waiting for one let a client
            // that never answered hold this for timeoutInMs per message, the first timeout ending it
            await service.send({
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
    private static async hasLostMessagesAfter(offset: number): Promise<boolean> {
        // the cleanup deletes from the oldest message on, so what is kept starts right after what was
        // deleted. Messages the client could not have read count as well: telling a client to reload
        // when it did not have to costs a reload, the other way round costs what it never receives
        const [oldest] = await this.messageRepository.findAll({ order: { seq: 'ASC' }, limit: 1, acrossTenants: true });
        if (oldest != undefined) {
            return oldest.seq > offset + 1;
        }
        return await this.resolveNewestSeq() > offset;
    }

    /**
     * Tells a reconnecting client that it is not sent what it missed.
     * @param service - What the message is sent through.
     * @param connection - The client.
     */
    private static async sendReplayIncomplete(
        service: WebsocketServiceInterface<SocketIOWebsocketConnection>,
        connection: SocketIOWebsocketConnection
    ): Promise<void> {
        const data: WebsocketReplayIncomplete = { seq: await this.resolveNewestSeq() };
        await service.send({
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
    private static async resolveNewestSeq(): Promise<number> {
        const sequence: WebsocketMessageSequence | undefined = await this.sequenceRepository.findOne({
            where: { name: WEBSOCKET_MESSAGE_SEQUENCE_NAME },
            required: false
        });
        return sequence?.seq ?? 0;
    }
}