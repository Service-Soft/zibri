import { IdentityLinkingAuthenticatorInterface, isIdentityLinkingAuthenticator } from './identity-linking-authenticator.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator whose identities a logged in user links to their account through
 * the `link-identity/request` route of `AuthController`.
 */
export interface LinkIdentityRequestingAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType,
    TicketType,
    RegistrationType,
    IdentityType extends Pick<BaseEntity, 'id'>,
    LinkIdentityRequestType,
    LinkIdentityStartType
> extends IdentityLinkingAuthenticatorInterface<
        RoleType,
        UserType,
        CredentialsType,
        TicketType,
        RegistrationType,
        IdentityType,
        LinkIdentityRequestType,
        LinkIdentityStartType
    > {
    /**
     * The model of the body the `link-identity/request` route takes.
     */
    readonly linkIdentityRequestModel: Newable<LinkIdentityRequestType>,
    /**
     * The model of what the `link-identity/request` route answers with.
     */
    readonly linkIdentityStartModel: Newable<LinkIdentityStartType>
}

/**
 * Checks whether or not the given value is an authenticator whose identities the
 * `link-identity/request` route links.
 * @param value - The value to check.
 * @returns True if it links identities and has every key LinkIdentityRequestingAuthenticatorInterface adds.
 */
export function isLinkIdentityRequestingAuthenticator(
    value: unknown
): value is LinkIdentityRequestingAuthenticatorInterface<
    string,
    BaseUser<string>,
    unknown,
    unknown,
    unknown,
    Pick<BaseEntity, 'id'>,
    unknown,
    unknown
> {
    return isIdentityLinkingAuthenticator(value) && 'linkIdentityRequestModel' in value && 'linkIdentityStartModel' in value;
}
