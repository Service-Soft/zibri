import { type LooseWebsocketEvent } from './websocket-event.enum';
import { WEBSOCKET_MESSAGE_SEQUENCE_NAME, WebsocketMessageSequence, WebsocketMessageSequenceCreateData } from './websocket-message-sequence.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitClass } from '../../entity/omit-class.model';
import { HttpError } from '../../error-handling/errors/http.error';
import { HttpStatus } from '../../http/http-status.enum';

/**
 * The type of a websocket message recipient.
 */
export enum WebsocketRecipientType {
    ALL = 'ALL',
    USER = 'USER',
    CHANNEL = 'CHANNEL'
}

/**
 * Definition of a message sent via websocket connection.
 */
@Entity({ allowOrphan: true, defaultOrder: { seq: 'ASC' } })
export class WebsocketMessage extends BaseEntity {
    /**
     * The tenant the message was sent in, or null for one sent outside every tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
    /**
     * The date at which the message was created.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
    /**
     * An incremental number that can be used with a client offset to sync server state back to the client.
     */
    @Property.number({ default: resolveNewSeqNumber })
    seq!: number;
    /**
     * Whether or not the message is ok.
     */
    @Property.boolean({
        default: (m: WebsocketMessage) => {
            return m.status < 400;
        }
    })
    ok!: boolean;
    /**
     * The event to send to.
     */
    @Property.string()
    event!: LooseWebsocketEvent;
    /**
     * The http status code.
     */
    @Property.number({ enum: HttpStatus })
    status!: HttpStatus;
    /**
     * The id of the user that has sent the message.
     */
    @Property.string({ required: false, format: 'uuid' })
    senderUserId: string | undefined | null;
    /**
     * The of the connection that has sent the message.
     */
    @Property.string({ required: false })
    senderConnectionId: string | undefined | null;
    /**
     * The actual data of the message.
     */
    @Property.unknown({ required: (m: WebsocketMessage) => m.ok })
    data: unknown | undefined;
    /**
     * An error that was caused.
     */
    @Property.unknown({ required: (m: WebsocketMessage) => !m.ok })
    error: HttpError | undefined;
    /**
     * The type of recipient. Can be "USER", "CHANNEL", "ALL".
     */
    @Property.string({ enum: WebsocketRecipientType })
    recipientType!: WebsocketRecipientType;
    /**
     * The id of either the channel or the user that this message was sent to.
     * Can be empty when the message was sent to all or to a non user connection.
     */
    @Property.string({ required: (m: WebsocketMessage) => m.recipientType != WebsocketRecipientType.ALL, format: 'uuid' })
    recipientId: string | undefined;
}

/**
 * The data required to create a new websocket message.
 */
export class CreateWebsocketMessageData extends OmitClass(WebsocketMessage, ['id', 'seq', 'createdAt']) {}

// eslint-disable-next-line jsdoc/require-jsdoc
async function resolveNewSeqNumber(): Promise<number> {
    const repo: Repository<WebsocketMessageSequence, WebsocketMessageSequenceCreateData> = inject(
        repositoryTokenFor(WebsocketMessageSequence)
    );
    // one increment rather than the newest message's seq plus one, which two senders read at once and
    // both used. The websocket service creates the row while the application starts, continuing from
    // the messages that are kept, so the create here only happens to a row deleted since
    const sequence: WebsocketMessageSequence = await repo.upsert(
        { name: WEBSOCKET_MESSAGE_SEQUENCE_NAME },
        { name: WEBSOCKET_MESSAGE_SEQUENCE_NAME, seq: 1 },
        { seq: { increment: 1 } }
    );
    return sequence.seq;
}