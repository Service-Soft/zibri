import { Property } from '../../entity/decorators/property.decorator';

/**
 * The ways the login route of `AuthController` takes, as `GET /login-methods` answers them, so that a frontend offers
 * those.
 */
export class LoginMethods {
    /**
     * Whether a user logs in with an email and a password, through `PasswordAuthenticator`.
     */
    @Property.boolean()
    password!: boolean;

    /**
     * Whether a user logs in with a link sent by email, through `LoginLinkAuthenticator`, asked for at
     * `POST /request-login-link`.
     */
    @Property.boolean()
    loginLink!: boolean;
}
