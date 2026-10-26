import { PasskeyAuthenticationResponse } from './passkey-authentication-response.model';
import { PasskeyCreationOptions } from './passkey-creation-options.model';
import { PasskeyRegistrationResponse } from './passkey-registration-response.model';
import { PasskeyRegistrationTicket } from './passkey-registration-ticket.model';
import { PasskeyRequestOptions } from './passkey-request-options.model';
import { Passkey } from './passkey.model';
import { Transaction } from '../../../data-source/transaction/transaction.model';

/**
 * Interface for a passkey service: what issues the challenges a device signs, and verifies its answers.
 *
 * `PasskeyAuthenticator` logs users in with it and `PasskeyTwoFactorMethod` takes a passkey as a
 * second factor with it. An application reaches what it does through `AuthServiceInterface` and
 * `TwoFactorServiceInterface`.
 */
export interface PasskeyServiceInterface {
    /**
     * Requests a login: a challenge for whichever passkey of the site the user picks.
     */
    requestLogin: () => Promise<PasskeyRequestOptions>,
    /**
     * Requests creating a passkey for a user who does not exist yet, listed on the device under the
     * given name.
     */
    requestRegistration: (name: string) => Promise<PasskeyCreationOptions>,
    /**
     * Requests creating a passkey for a user who exists, listed on the device under the given name, and
     * adding it to them.
     */
    requestAddition: (userId: string, name: string) => Promise<PasskeyCreationOptions>,
    /**
     * Requests using a passkey of a user as the second factor of an operation. Throws a BadRequestError
     * when the user has none.
     */
    requestSecondFactor: (userId: string) => Promise<PasskeyRequestOptions>,
    /**
     * Verifies a passkey created for a user who does not exist yet, and keeps it until they do.
     * Answers with the ticket the application creates the user with, and logs them in with.
     */
    confirmRegistration: (response: PasskeyRegistrationResponse) => Promise<string>,
    /**
     * Verifies a passkey created for a user who exists, and adds it to them. The creation has to have
     * been requested for them.
     */
    confirmAddition: (userId: string, response: PasskeyRegistrationResponse) => Promise<void>,
    /**
     * Verifies a login with a passkey, and answers with the passkey.
     *
     * Throws an UnauthorizedError when it does not verify, and a CredentialClonedError when the
     * device's signature counter went backwards.
     */
    confirmLogin: (response: PasskeyAuthenticationResponse, transaction: Transaction | undefined) => Promise<Passkey>,
    /**
     * Verifies a passkey presented as the second factor of an operation of a user.
     *
     * Throws an UnauthorizedError when it does not verify, and a CredentialClonedError when the
     * device's signature counter went backwards.
     */
    verifySecondFactor: (userId: string, response: PasskeyAuthenticationResponse) => Promise<void>,
    /**
     * Finds a registration ticket that may still be used. Throws an UnauthorizedError when it is
     * unknown, spent or expired.
     */
    findRegistrationTicket: (ticket: string, transaction: Transaction | undefined) => Promise<PasskeyRegistrationTicket>,
    /**
     * Adds the passkey a registration ticket holds to a user.
     */
    linkRegistrationTicket: (ticket: string, userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Spends a registration ticket whose passkey was added to a user, and answers with the ticket as it
     * was before.
     */
    spendRegistrationTicket: (ticket: string, transaction: Transaction | undefined) => Promise<PasskeyRegistrationTicket>,
    /**
     * Finds the passkeys of a user, oldest first.
     */
    findPasskeys: (userId: string, transaction: Transaction | undefined) => Promise<Passkey[]>,
    /**
     * Removes a passkey from a user. Throws a NotFoundError when the user has no passkey of that id.
     */
    removePasskey: (userId: string, passkeyId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Removes every passkey of a user.
     */
    removePasskeys: (userId: string) => Promise<void>,
    /**
     * Deletes the passkeys of the given users, and the challenges and registration tickets bound to
     * them. Called in the transaction that deletes the users for good.
     */
    deleteUserRows: (userIds: string[], transaction: Transaction) => Promise<void>,
    /**
     * Deletes the challenges and registration tickets that expired.
     */
    deleteExpired: () => Promise<void>
}