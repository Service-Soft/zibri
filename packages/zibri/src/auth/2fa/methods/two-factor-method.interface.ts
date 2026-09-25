import { HttpRequestContext } from '../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { BaseUser } from '../../models/base-user.model';

/**
 * Interface for a two factor method.
 */
export interface TwoFactorMethod<
    TwoFactorRequestRegisterData,
    TwoFactorConfirmRegisterData,
    TwoFactorRequestRegisterResult = void
> {
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
        'requestRegisterForUser',
        'confirmRegisterForUser',
        'unregisterForUser',
        'validate'
    ];

    return !keys.find(key => !(key in value));
}