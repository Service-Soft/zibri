import { ZibriApplication } from '../../../application/application';
import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { Newable } from '../../../types/newable.type';
import { UserAccount } from '../../models/user-account.model';

/**
 * Interface for a two factor method.
 */
export interface TwoFactorMethod<
    TwoFactorRegistrationRequestData,
    TwoFactorRegistrationConfirmData,
    TwoFactorRegistrationRequestResult = void,
    SecondFactorRequestType = void
> {
    /**
     * The name of the method, which the 2fa routes of `AuthController` name it by, eg. `otp`.
     */
    readonly name: string,
    /**
     * The model of what requesting to register the method takes. `NoRegistrationRequestData` for a
     * method that takes nothing.
     */
    readonly registrationRequestModel: Newable<TwoFactorRegistrationRequestData>,
    /**
     * The model of what confirming the registration takes.
     */
    readonly registrationConfirmModel: Newable<TwoFactorRegistrationConfirmData>,
    /**
     * The model of what requesting to register answers with, undefined when it answers with nothing.
     */
    readonly registrationRequestResultModel: Newable<TwoFactorRegistrationRequestResult> | undefined,
    /**
     * The model of what requesting a second factor answers with, undefined when it answers with nothing.
     */
    readonly secondFactorRequestModel: Newable<SecondFactorRequestType> | undefined,
    /**
     * Whether the method is the way back for a user whose second factor is locked after too many wrong
     * codes, as recovery codes are.
     *
     * While a user is locked, only such a method is checked. When it accepts the request, the user's
     * other methods are removed and the lock is lifted, so the user enrolls a new one.
     */
    readonly unlocksLockedFactors?: boolean,
    /**
     * Initializes the two factor method while the application starts.
     */
    init?: (app: ZibriApplication) => void | Promise<void>,
    // returned rather than stored: everything in it is derived from the secret, so keeping a copy at
    // rest would mean a second plaintext of the thing the row exists to protect
    /**
     * Requests to register the two factor method for the given user.
     *
     * What it answers is whatever the user has to be shown to finish enrolling - for an
     * authenticator app that is the otpauth url behind the qr code, for a method that mails a code
     * it is nothing at all, which is why this defaults to `void`. What it answers is not stored.
     */
    requestRegistration: <UserType extends UserAccount>(
        user: UserType,
        data: TwoFactorRegistrationRequestData
    ) => TwoFactorRegistrationRequestResult | Promise<TwoFactorRegistrationRequestResult>,
    /**
     * Confirms the registration of the two factor method for the given user.
     */
    confirmRegistration: <UserType extends UserAccount>(
        user: UserType,
        data: TwoFactorRegistrationConfirmData
    ) => void | Promise<void>,
    /**
     * Removes the two factor method from the given user.
     */
    removeRegistration: <UserType extends UserAccount>(user: UserType) => void | Promise<void>,
    /**
     * Deletes every row the method keeps for the given users, confirmed or not. Called in the
     * transaction that deletes the users for good; a soft deleted user keeps them. Optional: leave it
     * out for a method that keeps nothing per user.
     */
    deleteUserRows?: (userIds: string[], transaction: RepositoryTransaction) => Promise<void>,
    /**
     * Whether the given user has a confirmed registration of this method.
     *
     * A registration that was requested but never confirmed does not count.
     */
    isRegistered: <UserType extends UserAccount>(user: UserType) => boolean | Promise<boolean>,
    /**
     * Requests the second factor of an operation of the given user, who has a confirmed registration of
     * the method: sends them a code, or answers with a challenge for their device. Does nothing for a
     * method whose second factor needs nothing requested, such as an authenticator app.
     */
    requestSecondFactor: <UserType extends UserAccount>(user: UserType) => Promise<SecondFactorRequestType>,
    /**
     * Validates that the given request has a valid second factor.
     */
    validate: <UserType extends UserAccount>(
        user: UserType,
        context: HttpRequestContext | WebsocketRequestContext
    ) => void | Promise<void>
}

/**
 * Checks whether or not the given value is a two factor method.
 * @param value - The value to check.
 * @returns True if all keys of the TwoFactorMethod interface are present, false otherwise.
 */
export function isTwoFactorMethod(value: unknown): value is TwoFactorMethod<unknown, unknown> {
    if (value == undefined) {
        return false;
    }
    if (typeof value !== 'object') {
        return false;
    }

    const keys: (keyof TwoFactorMethod<unknown, unknown>)[] = [
        'name',
        'registrationRequestModel',
        'registrationConfirmModel',
        'registrationRequestResultModel',
        'secondFactorRequestModel',
        'requestSecondFactor',
        'requestRegistration',
        'confirmRegistration',
        'removeRegistration',
        'isRegistered',
        'validate'
    ];

    return !keys.find(key => !(key in value));
}