import { ZibriApplication } from '../../../application/application.ts';
import { HttpRequestContext } from '../../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context.ts';
import { Newable } from '../../../types/newable.type.ts';
import { BaseUser } from '../../models/base-user.model.ts';

/**
 * Interface for a two factor method.
 */
export interface TwoFactorMethod<
    TwoFactorRequestRegisterData,
    TwoFactorConfirmRegisterData,
    TwoFactorRequestRegisterResult = void,
    SecondFactorStartType = void
> {
    /**
     * The name of the method, which the 2fa routes of `AuthController` name it by, eg. `otp`.
     */
    readonly name: string,
    /**
     * The model of what requesting to register the method takes. `NoRegisterData` for a method that
     * takes nothing.
     */
    readonly requestRegisterModel: Newable<TwoFactorRequestRegisterData>,
    /**
     * The model of what confirming the registration takes.
     */
    readonly confirmRegisterModel: Newable<TwoFactorConfirmRegisterData>,
    /**
     * The model of what requesting to register answers with, undefined when it answers with nothing.
     */
    readonly registrationModel: Newable<TwoFactorRequestRegisterResult> | undefined,
    /**
     * The model of what starting a second factor answers with, undefined when it answers with nothing.
     */
    readonly secondFactorStartModel: Newable<SecondFactorStartType> | undefined,
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
    /**
     * Requests to register the two factor method for the given user.
     *
     * What it answers is whatever the user has to be shown to finish enrolling - for an
     * authenticator app that is the otpauth url behind the qr code, for a method that mails a code
     * it is nothing at all, which is why this defaults to `void`. It is returned rather than stored:
     * everything in it is derived from the secret, so keeping a copy at rest would mean a second
     * plaintext of the thing the row exists to protect.
     */
    requestRegisterForUser: <Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: TwoFactorRequestRegisterData
    ) => TwoFactorRequestRegisterResult | Promise<TwoFactorRequestRegisterResult>,
    /**
     * Confirms the registration of the two factor method for the given user.
     */
    confirmRegisterForUser: <Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: TwoFactorConfirmRegisterData
    ) => void | Promise<void>,
    /**
     * Removes the two factor method from the given user.
     */
    unregisterForUser: <Role extends string, UserType extends BaseUser<Role>>(user: UserType) => void | Promise<void>,
    /**
     * Whether the given user has a confirmed registration of this method.
     *
     * A registration that was requested but never confirmed does not count.
     */
    isRegisteredForUser: <Role extends string, UserType extends BaseUser<Role>>(user: UserType) => boolean | Promise<boolean>,
    /**
     * Starts the second factor of an operation of the given user, who has a confirmed registration of
     * the method: sends them a code, or answers with a challenge for their device. Does nothing for a
     * method whose second factor needs nothing started, such as an authenticator app.
     */
    startSecondFactor: <Role extends string, UserType extends BaseUser<Role>>(user: UserType) => Promise<SecondFactorStartType>,
    /**
     * Validates that the given request has a valid second factor.
     */
    validate: <Role extends string, UserType extends BaseUser<Role>>(
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
        'requestRegisterModel',
        'confirmRegisterModel',
        'registrationModel',
        'secondFactorStartModel',
        'startSecondFactor',
        'requestRegisterForUser',
        'confirmRegisterForUser',
        'unregisterForUser',
        'isRegisteredForUser',
        'validate'
    ];

    return !keys.find(key => !(key in value));
}