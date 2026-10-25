import { TwoFactorMethod } from './methods/two-factor-method.interface';
import { TwoFactorLock } from './two-factor-failure-limit.model';
import { TwoFactorMethods } from './two-factor-methods.model';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { UserAccount } from '../models/user-account.model';

/**
 * Interface for a two factor service.
 */
export interface TwoFactorServiceInterface {
    /**
     * The different two factor methods provided.
     */
    readonly twoFactorMethods: TwoFactorMethods,
    /**
     * Requests the registration of the given two factor method for the given user.
     */
    requestRegisterTwoFactorMethodForUser: <
        UserType extends UserAccount,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData,
        TwoFactorRequestRegisterResult
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, TwoFactorRequestRegisterResult, unknown>,
        data: TwoFactorRequestRegisterData
    ) => Promise<TwoFactorRequestRegisterResult>,
    /**
     * Starts the second factor of an operation of the given user with the given method: sends them a
     * code, or answers with a challenge for their device.
     */
    startSecondFactor: <
        UserType extends UserAccount,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData,
        SecondFactorStartType
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, unknown, SecondFactorStartType>
    ) => Promise<SecondFactorStartType>,
    /**
     * Confirms the registration of the given two factor method for the given user.
     */
    confirmRegisterTwoFactorMethodForUser: <
        UserType extends UserAccount,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, unknown, unknown>,
        data: TwoFactorConfirmRegisterData
    ) => Promise<void>,
    /**
     * Removes the given two factor method from the given user.
     */
    unregisterTwoFactorMethodForUser: <
        UserType extends UserAccount,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, unknown, unknown>
    ) => Promise<void>,
    /**
     * Whether the given user has a confirmed registration of any of the allowed methods.
     */
    isRegistered: (user: UserAccount, allowedMethods?: TwoFactorMethods) => Promise<boolean>,
    /**
     * Finds the allowed methods the given user has a confirmed registration of.
     */
    findRegisteredMethods: (user: UserAccount, allowedMethods?: TwoFactorMethods) => Promise<TwoFactorMethods>,
    /**
     * Checks if the incoming request has some second factor.
     *
     * Counts as an attempt exactly like `validate2fa`, and answers false wherever that refuses.
     */
    has2fa: (
        user: UserAccount,
        context: HttpRequestContext | WebsocketRequestContext,
        allowedMethods?: TwoFactorMethods
    ) => Promise<boolean>,
    /**
     * Validates that the incoming request has a second factor, and throws what the caller should be
     * told when it has not.
     *
     * Each wrong code in a row makes the user wait twice as long before the next one is checked,
     * starting at `ZIBRI_DI_TOKENS.TWO_FACTOR_FAILURE_DELAY_IN_MS`; a correct code ends the streak.
     * With a `twoFactorFailureLimit`, the streak reaching it locks the user's second factor, and only
     * a method that `unlocksLockedFactors` is checked until it accepts a request or the user's second
     * factors are reset.
     * @throws A `TwoFactorThrottledError` while the user has to wait.
     * @throws A `TwoFactorLockedError` while the user's second factor is locked.
     * @throws When no allowed method accepts the request.
     */
    validate2fa: (
        user: UserAccount,
        context: HttpRequestContext | WebsocketRequestContext,
        allowedMethods?: TwoFactorMethods
    ) => Promise<void>,
    /**
     * Resolves what the lock on the given user's second factor refuses, or undefined when it is not locked.
     */
    resolveLock: (user: UserAccount) => Promise<TwoFactorLock | undefined>,
    /**
     * Removes every second factor of the given user, recovery codes included, and lifts a lock on
     * them, so the user enrolls anew.
     *
     * What an application's support or admin route calls for a user who lost their device or locked
     * themselves out.
     */
    resetSecondFactors: (user: UserAccount) => Promise<void>
}