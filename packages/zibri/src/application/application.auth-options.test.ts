import { afterEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, defaultTestProviders, StartedTestServer, startTestServer } from 'zibri-testing';

import { ZibriApplicationOptions } from './application-options.model';
import { TestTimeouts } from '../__testing__/constants';
import { OtpTwoFactorMethod } from '../auth/2fa/methods/otp/otp.two-factor-method';
import { TwoFactorServiceInterface } from '../auth/2fa/two-factor-service.interface';
import { AuthServiceInterface } from '../auth/auth-service.interface';
import { AuthService } from '../auth/auth.service';
import { Authenticators } from '../auth/authenticators/authenticators.model';
import { PasswordAuthenticator } from '../auth/authenticators/password/password.authenticator';
import { Auth } from '../auth/decorators/auth.decorator';
import { AuthStrategies } from '../auth/strategies/auth-strategies.model';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';

@Controller('/open', { allowOrphan: true, versions: 'all' })
class OpenController {

    @Get('/')
    get(): { open: boolean } {
        return { open: true };
    }
}

@Controller('/members', { allowOrphan: true, versions: 'all' })
class MembersController {

    @Auth.isLoggedIn()
    @Get('/')
    get(): { open: boolean } {
        return { open: false };
    }
}

// one class for the whole file: a data source that is declared and never deployed is refused by name
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource();

const applicationOptions: ZibriApplicationOptions = {
    name: 'auth-options',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    controllers: [OpenController],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never',
    dataSources: [dataSourceClass],
    providers: defaultTestProviders
};

/**
 * What the started application registered: its auth strategies, authenticators and second factors.
 */
type RegisteredAuth = {
    strategies: AuthStrategies,
    authenticators: Authenticators,
    twoFactorMethods: unknown[]
};

/**
 * Reads what the running application registered.
 * @returns Its strategies, authenticators and second factors.
 * @throws When the application replaced the auth service, whose lists this cannot read.
 */
function resolveRegisteredAuth(): RegisteredAuth {
    const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    const twoFactorService: TwoFactorServiceInterface = inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
    if (!(authService instanceof AuthService)) {
        throw new Error('The application runs an auth service of its own.');
    }
    return {
        strategies: [...authService.strategies],
        authenticators: [...authService.authenticators],
        twoFactorMethods: [...twoFactorService.twoFactorMethods]
    };
}

describe('the auth an application registers', () => {
    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
    }, TestTimeouts.inMemory.shutdown);

    it('is the default strategy, authenticator and second factor when the application names none', async () => {
        server = await startTestServer({ application: applicationOptions });

        expect(resolveRegisteredAuth()).toEqual({
            strategies: [JwtAuthStrategy],
            authenticators: [PasswordAuthenticator],
            twoFactorMethods: [OtpTwoFactorMethod]
        });
    }, TestTimeouts.inMemory.start);

    it('is nothing for an application naming no strategy, as nobody can log in to it', async () => {
        server = await startTestServer({ application: { ...applicationOptions, authStrategies: [] } });
        const baseUrl: string = await server.start();

        expect(resolveRegisteredAuth()).toEqual({ strategies: [], authenticators: [], twoFactorMethods: [] });
        expect((await fetch(`${baseUrl}/open`)).status).toBe(200);
    }, TestTimeouts.inMemory.start);

    it('is no authenticator for an application naming none, beside the default strategy', async () => {
        server = await startTestServer({ application: { ...applicationOptions, authenticators: [], twoFactorMethods: [] } });

        expect(resolveRegisteredAuth()).toEqual({ strategies: [JwtAuthStrategy], authenticators: [], twoFactorMethods: [] });
    }, TestTimeouts.inMemory.start);

    it('refuses to start without a strategy when a route needs a login, naming the route', async () => {
        await expect(startTestServer({
            application: { ...applicationOptions, controllers: [OpenController, MembersController], authStrategies: [] }
        })).rejects.toThrow(/MembersController\.get needs a login, and the application registers no auth strategy/);
    }, TestTimeouts.inMemory.start);

    it('refuses to start without a strategy when every route needs a login by default', async () => {
        await expect(startTestServer({
            application: { ...applicationOptions, defaultAuth: 'isLoggedIn', authStrategies: [] }
        })).rejects.toThrow(/OpenController\.get needs a login, and the application registers no auth strategy/);
    }, TestTimeouts.inMemory.start);
});