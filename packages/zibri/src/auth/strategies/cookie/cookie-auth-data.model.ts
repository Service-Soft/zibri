import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The authentication data that gets returned when logging in or refreshing the login.
 */
export class CookieAuthData<Role extends string> {
    /**
     * The id of the user of the cookie.
     */
    @Property.string({ format: 'uuid' })
    userId!: string;
    /**
     * The roles of the user.
     */
    @Property.array({ items: { type: 'string' } })
    roles!: Role[];
    /**
     * The token to prohibit cross site request forgery.
     */
    @Property.string()
    csrfToken!: string;
    /**
     * The expiration date of the session.
     */
    @Property.date()
    sessionExpirationDate!: Date;
    /**
     * The expiration date of the refresh session.
     */
    @Property.date()
    refreshSessionExpirationDate!: Date;
}