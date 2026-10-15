import { AuthenticatorInterface, isAuthenticator } from './authenticator.interface';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator that signs up a user who does not exist yet by itself, such as with a
 * passkey, and answers with the ticket the application's own sign-up route creates the user with. The
 * `registration-options` and `register` routes of `AuthController` lead to the ticket.
 */
export interface SignUpAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType,
    SignUpRequestType,
    SignUpOptionsType,
    SignUpAnswerType,
    TicketType
> extends AuthenticatorInterface<RoleType, UserType, CredentialsType> {
    /**
     * The model of the body the `registration-options` route takes.
     */
    readonly signUpRequestModel: Newable<SignUpRequestType>,
    /**
     * The model of what the `registration-options` route answers with.
     */
    readonly signUpOptionsModel: Newable<SignUpOptionsType>,
    /**
     * The model of the body the `register` route takes.
     */
    readonly signUpAnswerModel: Newable<SignUpAnswerType>,
    /**
     * The model of what the `register` route answers with.
     */
    readonly ticketModel: Newable<TicketType>,
    /**
     * Starts a sign-up, and answers with what the client signs up with.
     */
    resolveSignUpOptions: (request: SignUpRequestType) => Promise<SignUpOptionsType>,
    /**
     * Takes the client's answer to a sign-up, and answers with the ticket it continues with.
     */
    completeSignUp: (answer: SignUpAnswerType) => Promise<TicketType>
}

/**
 * Checks whether or not the given value is an authenticator that signs up users by itself.
 * @param value - The value to check.
 * @returns True if it has every key SignUpAuthenticatorInterface adds.
 */
export function isSignUpAuthenticator(
    value: unknown
): value is SignUpAuthenticatorInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown> {
    if (!isAuthenticator(value)) {
        return false;
    }
    const keys: string[] = [
        'signUpRequestModel',
        'signUpOptionsModel',
        'signUpAnswerModel',
        'ticketModel',
        'resolveSignUpOptions',
        'completeSignUp'
    ];
    return keys.every(key => key in value);
}