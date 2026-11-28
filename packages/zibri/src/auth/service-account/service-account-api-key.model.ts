import { Property } from '../../entity/decorators/property.decorator';

/**
 * An API key of a service account, as the routes of the `ServiceAccountController` answer it. The key itself is never
 * part of it.
 */
export class ServiceAccountApiKey {
    /**
     * The id of the key, which is the `client_id` of the key at the token endpoint.
     */
    @Property.string({ format: 'uuid' })
    id!: string;

    /**
     * What the key is for, such as the assistant or the script that sends it.
     */
    @Property.string()
    name!: string;

    /**
     * The permissions the key may use, of either level. A request with it holds those of them the roles of the service
     * account carry.
     */
    @Property.array({ items: { type: 'string' } })
    permissions!: string[];

    /**
     * The tenant the key is bound to. Undefined for a key that acts in every tenant the service account is a member of.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;

    /**
     * When the key stops working. Undefined for a key that works until it is revoked.
     */
    @Property.date({ required: false })
    expiresAt?: Date;

    /**
     * When the key was last used. Undefined for a key never used.
     */
    @Property.date({ required: false })
    lastUsedAt?: Date;

    /**
     * When the key was created.
     */
    @Property.date()
    createdAt!: Date;

    /**
     * Whether the key is only exchanged for tokens bound to a DPoP key, and never taken in the API key header.
     */
    @Property.boolean()
    requireDpop!: boolean;
}