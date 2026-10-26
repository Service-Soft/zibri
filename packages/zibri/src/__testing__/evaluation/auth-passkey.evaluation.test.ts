import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, FakePasskeyDevice, InMemoryDataSource } from 'zibri-testing';

import { PasskeyTwoFactorMethod } from '../../auth/2fa/methods/passkey/passkey.two-factor-method';
import { AuthController } from '../../auth/auth-controller/auth-controller.model';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { PasskeyAuthenticationResponse } from '../../auth/authenticators/passkey/passkey-authentication-response.model';
import { PasskeyChallenge } from '../../auth/authenticators/passkey/passkey-challenge.model';
import { PasskeyCreationOptions } from '../../auth/authenticators/passkey/passkey-creation-options.model';
import { PasskeyTicketCredentials } from '../../auth/authenticators/passkey/passkey-credentials.model';
import { PasskeyRegistrationResponse } from '../../auth/authenticators/passkey/passkey-registration-response.model';
import { PasskeyRegistrationTicket } from '../../auth/authenticators/passkey/passkey-registration-ticket.model';
import { PasskeyRegistration } from '../../auth/authenticators/passkey/passkey-registration.model';
import { PasskeyRequestOptions } from '../../auth/authenticators/passkey/passkey-request-options.model';
import { PasskeyAuthenticator } from '../../auth/authenticators/passkey/passkey.authenticator';
import { Passkey } from '../../auth/authenticators/passkey/passkey.model';
import { Auth } from '../../auth/decorators/auth.decorator';
import { JwtAuthData } from '../../auth/strategies/jwt/jwt-auth-data.model';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { KnownHeader } from '../../http/known-header.enum';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { TestTimeouts } from '../constants';
import { JwtUser } from '../mocks/entities/jwt-user.entity';
import { Roles } from '../mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

const ORIGIN: string = 'https://app.example.com';

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class EvaluationAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasskeyAuthenticator],
        twoFactorMethods: [PasskeyTwoFactorMethod]
    }) {}

@Controller('/users', { allowOrphan: true })
class RegistrationController {
    // what an application writes: a registration with nothing but a passkey, the same three steps as
    // a first login through a provider
    @Auth.skip({ allowRedundant: true })
    @Post('/register-with-passkey')
    async register(
        @Body(PasskeyTicketCredentials)
        input: PasskeyTicketCredentials
    ): Promise<JwtAuthData<string>> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const registration: PasskeyRegistration = await authService.resolveRegistration(PasskeyAuthenticator, input, undefined);
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: registration.name, roles: [Roles.USER] });
        await authService.linkTicketIdentity(PasskeyAuthenticator, input, user.id, undefined);
        return await authService.login(PasskeyAuthenticator<string, JwtUser>, JwtAuthStrategy<string, JwtUser>, input, undefined);
    }
}

@Controller('/account', { allowOrphan: true })
class AccountController {
    @Auth.isLoggedIn()
    @Get('/')
    read(): { ok: boolean } {
        return { ok: true };
    }

    @Auth.require2fa()
    @Post('/payment-details')
    updatePaymentDetails(): { ok: boolean } {
        return { ok: true };
    }
}

describe('evaluation/03-auth-and-security H10 - passkeys', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: [...defaultTestServerEntities, Passkey, PasskeyChallenge, PasskeyRegistrationTicket],
            repositories: defaultTestServerRepositories,
            allowOrphan: true
        });
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            authenticators: [PasskeyAuthenticator],
            twoFactorMethods: [PasskeyTwoFactorMethod],
            controllers: [EvaluationAuthController, RegistrationController, AccountController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS,
                    useValue: { relyingPartyId: 'example.com', relyingPartyName: 'Example', origins: [ORIGIN] }
                })
            ]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<[number, T]> {
        const res: Response = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json', ...headers },
            body: JsonUtilities.stringify(body)
        });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const answer: T = await res.json();
        return [res.status, answer];
    }

    async function register(device: FakePasskeyDevice, email: string): Promise<JwtAuthData<Roles>> {
        const [, options] = await post<PasskeyCreationOptions>('/auth/registration/request', { name: email });
        const response: PasskeyRegistrationResponse = device.create(options, ORIGIN);
        const [, { ticket }] = await post<{ ticket: string }>('/auth/registration/confirm', { response });
        const [status, auth] = await post<JwtAuthData<Roles>>('/users/register-with-passkey', { ticket });
        expect(status).toBe(200);
        return auth;
    }

    it('registers a user with nothing but a passkey, which logs them in, and logs them in with it later', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        const registered: JwtAuthData<Roles> = await register(device, 'passkey-only@example.com');
        const account: Response = await fetch(`${baseUrl}/account`, {
            headers: { [KnownHeader.AUTHORIZATION]: `Bearer ${registered.accessToken.value}` }
        });
        expect(account.status).toBe(200);

        // no email, no password: the device offers the passkey it holds for the site
        const [, options] = await post<PasskeyRequestOptions>('/auth/login-options', {});
        const [status, loggedIn] = await post<JwtAuthData<Roles>>('/auth/login', { response: device.get(options, ORIGIN) });
        expect(status).toBe(200);
        expect(loggedIn.userId).toBe(registered.userId);
    });

    it('refuses a passkey the browser used on another origin, the way a phishing page would get it used', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        await register(device, 'phished@example.com');

        const [, options] = await post<PasskeyRequestOptions>('/auth/login-options', {});
        const phished: PasskeyAuthenticationResponse = device.get(options, 'https://app.examp1e.com');
        const [status] = await post<unknown>('/auth/login', { response: phished });
        expect(status).toBe(401);
    });

    it('takes a passkey as the second factor of an operation', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        const { accessToken } = await register(device, 'second-factor@example.com');
        const authorization: Record<string, string> = { [KnownHeader.AUTHORIZATION]: `Bearer ${accessToken.value}` };

        const [withoutFactor] = await post<unknown>('/account/payment-details', {}, authorization);
        expect(withoutFactor).toBe(401);

        const [, options] = await post<PasskeyRequestOptions>('/auth/2fa/request', {}, authorization);
        const assertion: string = Buffer.from(JsonUtilities.stringify(device.get(options, ORIGIN))).toString('base64url');
        const [withFactor] = await post<unknown>(
            '/account/payment-details',
            {},
            { ...authorization, [inject(ZIBRI_DI_TOKENS.PASSKEY_HEADER)]: assertion }
        );
        expect(withFactor).toBe(200);
    });
});