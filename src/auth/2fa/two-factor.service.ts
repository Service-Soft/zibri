import { ZibriApplication } from '../../application';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { register } from '../../di/register.function';
import { OnAppInit } from '../../global/on-app-init.interface';
import { type LoggerInterface } from '../../logging/logger.interface';
import { BaseUser } from '../models/base-user.model';
import { TwoFactorMethod } from './methods/two-factor-method.interface';
import { TwoFactorMethods } from './two-factor-methods.model';
import { TwoFactorServiceInterface } from './two-factor-service.interface';

/**
 * Default implementation of the two factor service.
 */
@Injectable({ register: 'onUse' })
export class TwoFactorService implements TwoFactorServiceInterface, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly twoFactorMethods: TwoFactorMethods = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) { }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit({ options }: ZibriApplication): Promise<void> {
        const { twoFactorMethods } = options;
        for (const method of twoFactorMethods) {
            register({ token: method, useClass: method });
            this.twoFactorMethods.push(method);
        }
        if (twoFactorMethods.length) {
            await this.logger.info(
                `initializes ${twoFactorMethods.length} ${twoFactorMethods.length > 1 ? 'two factor methods' : 'two factor method'}`
            );
            for (const method of twoFactorMethods) {
                await this.logger.info(`  - ${method.name}`);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestRegisterTwoFactorMethodForUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData>,
        data: TwoFactorRequestRegisterData
    ): Promise<void> {
        await method.requestRegisterForUser(user, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmRegisterTwoFactorMethodForUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData>,
        data: TwoFactorConfirmRegisterData
    ): Promise<void> {
        await method.confirmRegisterForUser(user, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unregisterTwoFactorMethodForUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData>
    ): Promise<void> {
        await method.unregisterForUser(user);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async has2fa(
        user: BaseUser<string>,
        context: HttpRequestContext | WebsocketRequestContext,
        allowedMethods: TwoFactorMethods = this.twoFactorMethods
    ): Promise<boolean> {
        if (context.has(ZIBRI_REQUEST_CONTEXT_TOKENS.HAS_2FA)) {
            return context.get(ZIBRI_REQUEST_CONTEXT_TOKENS.HAS_2FA);
        }
        try {
            await Promise.any(
                allowedMethods.map(m => inject(m).validate(user, context))
            );
            return true;
        }
        catch {
            return false;
        }
    }
}