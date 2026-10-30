import { LOGIN_USER_AGENT_MAX_LENGTH } from './login-device.model';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * A login of a user, as a strategy keeps it: one device or browser the user logged in on, which
 * stays logged in through its refreshes until it ends.
 */
export class UserLogin {
    /**
     * Identifies the login among those of its strategy, which ending it takes.
     */
    @Property.string()
    id!: string;

    /**
     * The name of the auth strategy carrying the login.
     */
    @Property.string()
    strategy!: string;

    /**
     * Whether the request asking carries this login.
     */
    @Property.boolean()
    current!: boolean;

    /**
     * When the user logged in. Undefined when the strategy does not know.
     */
    @Property.date({ required: false })
    authenticatedAt?: Date;

    /**
     * When the login was last used to get a new credential: when it started, or was last refreshed.
     * Undefined when the strategy does not know.
     */
    @Property.date({ required: false })
    lastUsedAt?: Date;

    /**
     * When the login ends unless it is refreshed before.
     */
    @Property.date()
    expiresAt!: Date;

    /**
     * The `User-Agent` of the client that last used the login, if it sent one.
     */
    @Property.string({ required: false, maxLength: LOGIN_USER_AGENT_MAX_LENGTH })
    userAgent?: string;

    /**
     * The address of the client that last used the login.
     */
    @Property.string({ required: false })
    ipAddress?: string;
}