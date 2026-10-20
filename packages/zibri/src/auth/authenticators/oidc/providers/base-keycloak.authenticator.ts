import { BaseUser } from '../../../models/base-user.model.ts';
import { BaseOidcAuthenticator } from '../base-oidc.authenticator.ts';

/**
 * Authenticates a user by a sign-in at a Keycloak realm.
 *
 * Extend it with the url Keycloak is reached at, the realm, and the client id and credentials of the
 * client created in the realm.
 */
export abstract class BaseKeycloakAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOidcAuthenticator<RoleType, UserType> {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: string = 'keycloak';

    /**
     * The url Keycloak is reached at, eg. `https://sso.example.com`.
     */
    abstract readonly baseUrl: string;

    /**
     * The realm whose users sign in.
     */
    abstract readonly realm: string;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    get issuer(): string {
        return `${this.baseUrl.replace(/\/+$/, '')}/realms/${this.realm}`;
    }
}