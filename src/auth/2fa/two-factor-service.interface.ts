import { TwoFactorMethod } from './methods/two-factor-method.interface';
import { TwoFactorMethods } from './two-factor-methods.model';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { BaseUser } from '../models/base-user.model';

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
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData>,
        data: TwoFactorRequestRegisterData
    ) => Promise<void>,
    /**
     * Confirms the registration of the given two factor method for the given user.
     */
    confirmRegisterTwoFactorMethodForUser: <
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData>,
        data: TwoFactorConfirmRegisterData
    ) => Promise<void>,
    /**
     * Removes the given two factor method from the given user.
     */
    unregisterTwoFactorMethodForUser: <
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(user: UserType, method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData>) => Promise<void>,
    /**
     * Checks if the incoming request has some second factor.
     */
    has2fa: (
        user: BaseUser<string>,
        context: HttpRequestContext | WebsocketRequestContext,
        allowedMethods?: TwoFactorMethods
    ) => Promise<boolean>
}