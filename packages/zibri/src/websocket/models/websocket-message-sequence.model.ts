import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * The name of the one sequence websocket messages draw their seq from.
 */
export const WEBSOCKET_MESSAGE_SEQUENCE_NAME: string = 'websocket-messages';

/**
 * The seq the last websocket message was given.
 */
// one row for the whole deployment, across tenants: a client reading the messages of several tenants
// keeps one offset for all of them. The unique name is what lets the next number be drawn in a single
// upsert instead of reading the newest message and writing one above it, which two senders at once
// both did with the same number
@Entity({ allowOrphan: true, tenant: 'shared', uniques: [['name']] })
export class WebsocketMessageSequence extends BaseEntity {
    /**
     * Which sequence this is.
     */
    @Property.string()
    name!: string;
    /**
     * The last seq given out.
     */
    @Property.number({ format: 'integer' })
    seq!: number;
}

/**
 * The data required to create a websocket message sequence.
 */
export type WebsocketMessageSequenceCreateData = OmitStrict<WebsocketMessageSequence, 'id'>;