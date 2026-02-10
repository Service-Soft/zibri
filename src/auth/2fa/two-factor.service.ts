import { inject, ZIBRI_DI_TOKENS } from '../../di';
import { register } from '../../di/register.function';
import { HttpRequest } from '../../http';
import { LoggerInterface } from '../../logging';
import { WebsocketRequest } from '../../websocket';
import { BaseUser } from '../models';
import { TwoFactorMethod } from './methods';
import { TwoFactorMethods } from './two-factor-methods.model';
import { TwoFactorServiceInterface } from './two-factor-service.interface';

/**
 * Default implementation of the two factor service.
 */
export class TwoFactorService implements TwoFactorServiceInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly twoFactorMethods: TwoFactorMethods = [];

    /**
     * A logger.
     */
    protected readonly logger: LoggerInterface;

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(twoFactorMethods: TwoFactorMethods): Promise<void> {
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
                inject(method).init();
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
        request: HttpRequest | WebsocketRequest,
        allowedMethods: TwoFactorMethods = this.twoFactorMethods
    ): Promise<boolean> {
        try {
            await Promise.any(
                allowedMethods.map(m => inject(m).validate(user, request))
            );
            return true;
        }
        catch {
            return false;
        }
    }
}