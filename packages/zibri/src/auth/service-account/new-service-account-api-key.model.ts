import { Property } from '../../entity/decorators/property.decorator';
import { ZIBRI_SERVICE_ACCOUNT_LIMITS } from './service-account-limits.model';

/**
 * An API key to create for a service account, as `POST /:serviceAccountId/api-keys` of the `ServiceAccountController`
 * takes it.
 */
export class NewServiceAccountApiKey {
    /**
     * What the key is for, such as the assistant or the script that sends it.
     */
    @Property.string({ minLength: 1, maxLength: ZIBRI_SERVICE_ACCOUNT_LIMITS.API_KEY_NAME_MAX_LENGTH })
    name!: string;

    /**
     * The permissions the key may use, of either level. Each one needs to be carried by a role of the service account,
     * of its own or through its membership in the tenant the key is bound to.
     */
    @Property.array({ items: { type: 'string' } })
    permissions!: string[];

    /**
     * The tenant the key is bound to, one the service account is a member of. Undefined for a key that acts in every
     * tenant it is a member of.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string;

    /**
     * When the key stops working. Undefined for a key that works until it is revoked.
     */
    @Property.date({ required: false })
    expiresAt?: Date;

    /**
     * Whether the key is only exchanged for tokens bound to a DPoP key, and never taken in the API key header.
     */
    @Property.boolean()
    requireDpop!: boolean;
}