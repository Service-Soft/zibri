import { IdentityLinkingAuthenticatorInterface, isIdentityLinkingAuthenticator } from './identity-linking-authenticator.interface.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * Interface for an authenticator whose identities a logged in user connects to their account through
 * the `connect` route of `AuthController`.
 */
export interface ConnectingAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType,
    TicketType,
    RegistrationType,
    IdentityType extends Pick<BaseEntity, 'id'>,
    ConnectionRequestType,
    ConnectionStartType
> extends IdentityLinkingAuthenticatorInterface<
        RoleType,
        UserType,
        CredentialsType,
        TicketType,
        RegistrationType,
        IdentityType,
        ConnectionRequestType,
        ConnectionStartType
    > {
    /**
     * The model of the body the `connect` route takes.
     */
    readonly connectionRequestModel: Newable<ConnectionRequestType>,
    /**
     * The model of what the `connect` route answers with.
     */
    readonly connectionStartModel: Newable<ConnectionStartType>
}

/**
 * Checks whether or not the given value is an authenticator whose identities the `connect` route connects.
 * @param value - The value to check.
 * @returns True if it links identities and has every key ConnectingAuthenticatorInterface adds.
 */
export function isConnectingAuthenticator(
    value: unknown
): value is ConnectingAuthenticatorInterface<
    string,
    BaseUser<string>,
    unknown,
    unknown,
    unknown,
    Pick<BaseEntity, 'id'>,
    unknown,
    unknown
> {
    return isIdentityLinkingAuthenticator(value) && 'connectionRequestModel' in value && 'connectionStartModel' in value;
}