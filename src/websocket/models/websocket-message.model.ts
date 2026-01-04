import { type LooseWebsocketEvent } from './websocket-event.enum';
import { Repository } from '../../data-source';
import { inject, repositoryTokenFor } from '../../di';
import { Entity, OmitClass, Property } from '../../entity';
import { BaseEntity } from '../../entity/base-entity.model';
import { HttpError } from '../../error-handling';
import { HttpStatus } from '../../http';

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
@Entity()
export class WebsocketMessage extends BaseEntity {
    /**
     * The date at which the message was created.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
    /**
     * An incremental number that can be used with a client offset to sync server state back to the client.
     */
    @Property.number({ default: getNewSeqNumber })
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
    senderUserId: string | undefined;
    /**
     * The of the connection that has sent the message.
     */
    @Property.string({ required: false })
    senderConnectionId: string | undefined;
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
async function getNewSeqNumber(): Promise<number> {
    const repo: Repository<WebsocketMessage, CreateWebsocketMessageData> = inject(repositoryTokenFor(WebsocketMessage));
    const [message] = await repo.findAll({ order: { seq: 'DESC' }, take: 1 });
    return Number(message?.seq ?? 0) + 1;
}