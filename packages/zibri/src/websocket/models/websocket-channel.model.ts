import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * A websocket channel.
 */
@Entity({ allowOrphan: true })
export class WebsocketChannel extends BaseEntity {
    /**
     * The tenant the channel belongs to, or null for a channel of no tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
    /**
     * The name of the channel, unique within its tenant.
     */
    @Property.string({ unique: true })
    name!: string;
    /**
     * The ids of all users that are in this channel.
     */
    @Property.array({ items: { type: 'string' } })
    userIds!: string[];
}