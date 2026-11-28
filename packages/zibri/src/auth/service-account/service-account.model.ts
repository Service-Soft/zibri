import { Property } from '../../entity/decorators/property.decorator';
import { ServiceAccountApiKey } from './service-account-api-key.model';

/**
 * A service account, as the routes of the `ServiceAccountController` answer it: a user that acts through its API keys
 * only, with its roles and its keys.
 */
export class ServiceAccount {
    /**
     * The id of the user.
     */
    @Property.string({ format: 'uuid' })
    id!: string;

    /**
     * What the service account is for, such as `assistant`: the local part of its email.
     */
    @Property.string()
    name!: string;

    /**
     * The platform roles of the service account.
     */
    @Property.array({ items: { type: 'string' } })
    roles!: string[];

    /**
     * The tenant roles of its membership in the tenant the request acts in. Empty when it is no member there, or the
     * request acts in no tenant.
     */
    @Property.array({ items: { type: 'string' } })
    tenantRoles!: string[];

    /**
     * Its API keys, expired ones included, oldest first.
     */
    @Property.array({ items: { type: 'object', cls: () => ServiceAccountApiKey } })
    apiKeys!: ServiceAccountApiKey[];
}
