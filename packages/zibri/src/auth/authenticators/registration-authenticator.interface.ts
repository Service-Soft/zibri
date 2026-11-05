import { AuthenticatorInterface, isAuthenticator } from './authenticator.interface';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator that registers a user who does not exist yet by itself, such as with
 * a passkey, and answers with the ticket the application's own registration route creates the user
 * with. The `registration/request` and `registration/confirm` routes of `AuthController` lead to the
 * ticket.
 */
export interface RegistrationAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType,
    RegistrationRequestType,
    RegistrationOptionsType,
    RegistrationAnswerType,
    TicketType
> extends AuthenticatorInterface<RoleType, UserType, CredentialsType> {
    /**
     * The model of the body the `registration/request` route takes.
     */
    readonly registrationRequestModel: Newable<RegistrationRequestType>,
    /**
     * The model of what the `registration/request` route answers with.
     */
    readonly registrationOptionsModel: Newable<RegistrationOptionsType>,
    /**
     * The model of the body the `registration/confirm` route takes.
     */
    readonly registrationAnswerModel: Newable<RegistrationAnswerType>,
    /**
     * The model of what the `registration/confirm` route answers with.
     */
    readonly ticketModel: Newable<TicketType>,
    /**
     * Requests a registration, and answers with what the client registers with.
     */
    requestRegistration: (request: RegistrationRequestType) => Promise<RegistrationOptionsType>,
    /**
     * Takes the client's answer to a registration, and answers with the ticket it continues with.
     */
    confirmRegistration: (answer: RegistrationAnswerType) => Promise<TicketType>
}

/**
 * Checks whether or not the given value is an authenticator that registers users by itself.
 * @param value - The value to check.
 * @returns True if it has every key RegistrationAuthenticatorInterface adds.
 */
export function isRegistrationAuthenticator(
    value: unknown
): value is RegistrationAuthenticatorInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown> {
    if (!isAuthenticator(value)) {
        return false;
    }
    const keys: string[] = [
        'registrationRequestModel',
        'registrationOptionsModel',
        'registrationAnswerModel',
        'ticketModel',
        'requestRegistration',
        'confirmRegistration'
    ];
    return keys.every(key => key in value);
}