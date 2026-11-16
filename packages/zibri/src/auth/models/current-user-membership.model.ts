import { Property } from '../../entity/decorators/property.decorator';

/**
 * A membership of the logged in user in a tenant, as `GET /me` of the `AuthController` answers it:
 * what they may do there, without their roles, like a `CurrentMembership`.
 */
export class CurrentUserMembership {
    /**
     * The id of the tenant.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The permissions the roles of the membership carry, which \@Auth.hasPermission checks in a
     * request for this tenant, as far as the credential of the request may use them.
     */
    @Property.array({ items: { type: 'string' } })
    permissions!: string[];
}