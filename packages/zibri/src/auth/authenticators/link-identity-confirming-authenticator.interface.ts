import { AuthenticatorInterface, isAuthenticator } from './authenticator.interface';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator that confirms linking an identity with an answer of the client, such
 * as the passkey a device created. The `link-identity/confirm` route of `AuthController` takes it.
 */
export interface LinkIdentityConfirmingAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType,
    LinkIdentityAnswerType
> extends AuthenticatorInterface<RoleType, UserType, CredentialsType> {
    /**
     * The model of the body the `link-identity/confirm` route takes.
     */
    readonly linkIdentityAnswerModel: Newable<LinkIdentityAnswerType>,
    /**
     * Takes the client's answer to a link requested for the given user, and links the identity to them.
     */
    confirmLinkIdentity: (userId: string, answer: LinkIdentityAnswerType) => Promise<void>
}

/**
 * Checks whether or not the given value is an authenticator that confirms a link with an answer of the client.
 * @param value - The value to check.
 * @returns True if it has every key LinkIdentityConfirmingAuthenticatorInterface adds.
 */
export function isLinkIdentityConfirmingAuthenticator(
    value: unknown
): value is LinkIdentityConfirmingAuthenticatorInterface<string, BaseUser<string>, unknown, unknown> {
    return isAuthenticator(value) && 'linkIdentityAnswerModel' in value && 'confirmLinkIdentity' in value;
}