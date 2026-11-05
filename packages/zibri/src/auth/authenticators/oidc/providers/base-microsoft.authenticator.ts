import { ZibriApplication } from '../../../../application/application';
import { InternalError } from '../../../../error-handling/internal-error.model';
import { BaseUser } from '../../../models/base-user.model';
import { OAuthOfflineAccess } from '../../oauth/oauth-offline-access.model';
import { BaseOidcAuthenticator } from '../base-oidc.authenticator';
import { OidcAuthenticationTime } from '../oidc-authentication-time.type';

/**
 * The tenant ids of Entra ID's endpoints the accounts of more than one tenant log in through.
 */
const MULTI_TENANT_IDS: string[] = ['common', 'organizations'];

/**
 * The issuer of a tenant, which names its id.
 */
const TENANT_ISSUER: RegExp = /^https:\/\/login\.microsoftonline\.com\/([\da-f-]+)\/v2\.0$/i;

/**
 * Authenticates a user by a login with their account in a Microsoft Entra ID tenant.
 *
 * Extend it with the tenant id, the client id and credentials of the app registered in it, and whether
 * that registration adds `auth_time` to the optional claims of its ID tokens.
 */
export abstract class BaseMicrosoftAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseOidcAuthenticator<RoleType, UserType> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'microsoft';

    /**
     * The id of the tenant whose accounts log in. Or `organizations` for the work accounts of any
     * tenant, `common` for those and personal accounts, of the tenants `allowedTenantIds` names.
     */
    abstract readonly tenantId: string;

    /**
     * The tenants whose accounts log in through `organizations` or `common`: their ids, or `'any'` for
     * every tenant. Required for those, unused for a single tenant.
     */
    readonly allowedTenantIds: string[] | 'any' | undefined = undefined;

    /**
     * `auth_time` when the app registration adds `auth_time` to the optional claims of its ID tokens,
     * `none` otherwise: Entra ID sends it only when asked to in the registration.
     */
    abstract override readonly authenticationTime: OidcAuthenticationTime;

    // Microsoft issues a refresh token for the offline_access scope without asking for consent again
    override readonly offlineAccess: OAuthOfflineAccess = { scopes: ['offline_access'], prompts: [], parameters: {} };

    // Entra's `sub` is pairwise: another value for every app registration, and yet another in an
    // access token issued for an api. The object id is the one key the same person has in all of them
    override readonly subjectClaim: string = 'oid';

    // eslint-disable-next-line jsdoc/require-jsdoc
    get issuer(): string {
        return `https://login.microsoftonline.com/${this.tenantId}/v2.0`;
    }

    private get isMultiTenant(): boolean {
        return MULTI_TENANT_IDS.includes(this.tenantId);
    }

    override async init(app: ZibriApplication): Promise<void> {
        if (this.isMultiTenant && this.allowedTenantIds == undefined) {
            throw new InternalError(
                // eslint-disable-next-line stylistic/max-len
                `${this.constructor.name} logs in the accounts of every tenant through "${this.tenantId}": name the tenants that may in allowedTenantIds, or 'any'.`
            );
        }
        await super.init(app);
    }

    /**
     * Whether an issuer is this provider: for a single tenant the tenant's issuer, for `organizations`
     * or `common` the issuer of any tenant `allowedTenantIds` names. An identity is stored with the
     * issuer of the user's own tenant, so the same object id in two tenants is two identities.
     * @param issuer - The issuer, a url.
     * @returns True when it is this provider.
     */
    protected override isOwnIssuer(issuer: string): boolean {
        if (!this.isMultiTenant) {
            return super.isOwnIssuer(issuer);
        }
        const tenantId: string | undefined = TENANT_ISSUER.exec(issuer)?.[1]?.toLowerCase();
        return tenantId != undefined
            && (this.allowedTenantIds === 'any' || this.allowedTenantIds?.some(allowed => allowed.toLowerCase() === tenantId) === true);
    }
}