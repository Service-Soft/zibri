import { HttpRequest } from '../../../http/http-request.model';
import { WebsocketRequest } from '../../../websocket/models/websocket-request.model';
import { BaseUser } from '../../models/base-user.model';

/**
 * Interface for a two factor method.
 */
export interface TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData> {
    /**
     * Initializes the two factor method.
     */
    init: () => void,
    /**
     * Requests to register the two factor method for the given user.
     */
    requestRegisterForUser: <Role extends string, UserType extends BaseUser<Role>>(
        user: UserType,
        data: TwoFactorRequestRegisterData
    ) => void | Promise<void>,
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
        request: HttpRequest | WebsocketRequest
    ) => void | Promise<void>
}