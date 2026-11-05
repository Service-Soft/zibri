import { BaseUser } from '../../../models/base-user.model';
import { BaseOidcAuthenticator } from '../base-oidc.authenticator';
import { OidcAuthenticationTime } from '../oidc-authentication-time.type';

/**
 * Authenticates a user by a login at a Keycloak realm.
 *
 * Extend it with the url Keycloak is reached at, the realm, and the client id and credentials of the
 * client created in the realm.
 */
export abstract class BaseKeycloakAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOidcAuthenticator<RoleType, UserType> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'keycloak';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly authenticationTime: OidcAuthenticationTime = 'auth_time';

    /**
     * The url Keycloak is reached at, eg. `https://sso.example.com`.
     */
    abstract readonly baseUrl: string;

    /**
     * The realm whose users log in.
     */
    abstract readonly realm: string;

    // eslint-disable-next-line jsdoc/require-jsdoc
    get issuer(): string {
        return `${this.baseUrl.replace(/\/+$/, '')}/realms/${this.realm}`;
    }
}