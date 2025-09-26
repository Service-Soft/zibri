import { BaseEntity, Entity, Property } from '../../entity';

/**
 * A websocket channel.
 */
@Entity()
export class WebsocketChannel extends BaseEntity {
    /**
     * The unique name of the channel.
     */
    @Property.string({ unique: true })
    name!: string;
    /**
     * The ids of all users that are in this channel.
     */
    @Property.array({ items: { type: 'string' } })
    userIds!: string[];
}