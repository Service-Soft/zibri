import { ZibriApplication } from '../../application/application';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { register } from '../../di/register.function';
import { OnAppInit } from '../../global/on-app-init.interface';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model';
import { auditReasonFor } from '../../logging/audit-reason-for.function';
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
    onAppInit({ options }: ZibriApplication): void {
        const { twoFactorMethods } = options;
        for (const method of twoFactorMethods) {
            register({ token: method, useClass: method });
            this.twoFactorMethods.push(method);
        }
        if (twoFactorMethods.length) {
            this.logger.info(
                `initializes ${twoFactorMethods.length} ${twoFactorMethods.length > 1 ? 'two factor methods' : 'two factor method'}`
            );
            for (const method of twoFactorMethods) {
                this.logger.info(`  - ${method.name}`);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestRegisterTwoFactorMethodForUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData,
        TwoFactorRequestRegisterResult
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, TwoFactorRequestRegisterResult>,
        data: TwoFactorRequestRegisterData
    ): Promise<TwoFactorRequestRegisterResult> {
        return await method.requestRegisterForUser(user, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmRegisterTwoFactorMethodForUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        TwoFactorRequestRegisterData,
        TwoFactorConfirmRegisterData
    >(
        user: UserType,
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, unknown>,
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
        method: TwoFactorMethod<TwoFactorRequestRegisterData, TwoFactorConfirmRegisterData, unknown>
    ): Promise<void> {
        await method.unregisterForUser(user);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async has2fa(
        user: BaseUser<string>,
        context: HttpRequestContext | WebsocketRequestContext,
        allowedMethods: TwoFactorMethods = this.twoFactorMethods
    ): Promise<boolean> {
        // the HAS_2FA token asks this with every registered method, so a route that named a subset
        // would be told yes by a factor it does not accept. Reading the token here would also make
        // it its own dependency, since the token is what calls this.
        try {
            await Promise.any(
                allowedMethods.map(m => inject(m).validate(user, context))
            );
            return true;
        }
        catch (error) {
            // Promise.any rejects with every method's error, and dropping them made a wrong code and
            // a data source that is down look identical - to the caller, who gets 401 either way,
            // and in the trail, where neither appeared at all
            this.logger.audit({
                action: AuditAction.TWO_FACTOR,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                userId: user.id
            });
            return false;
        }
    }
}