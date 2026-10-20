import { AuthenticatorInterface, isAuthenticator } from './authenticator.interface.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * Interface for an authenticator that finishes connecting an identity with an answer of the client,
 * such as the passkey a device created. The `connect/complete` route of `AuthController` takes it.
 */
export interface ConnectionCompletingAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType,
    ConnectionAnswerType
> extends AuthenticatorInterface<RoleType, UserType, CredentialsType> {
    /**
     * The model of the body the `connect/complete` route takes.
     */
    readonly connectionAnswerModel: Newable<ConnectionAnswerType>,
    /**
     * Takes the client's answer to a connection started for the given user, and links the identity to them.
     */
    completeConnection: (userId: string, answer: ConnectionAnswerType) => Promise<void>
}

/**
 * Checks whether or not the given value is an authenticator that finishes connecting with an answer of the client.
 * @param value - The value to check.
 * @returns True if it has every key ConnectionCompletingAuthenticatorInterface adds.
 */
export function isConnectionCompletingAuthenticator(
    value: unknown
): value is ConnectionCompletingAuthenticatorInterface<string, BaseUser<string>, unknown, unknown> {
    return isAuthenticator(value) && 'connectionAnswerModel' in value && 'completeConnection' in value;
}