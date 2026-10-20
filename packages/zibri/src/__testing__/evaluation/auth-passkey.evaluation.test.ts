import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, FakePasskeyDevice, InMemoryDataSource } from 'zibri-testing';

import { PasskeyTwoFactorMethod } from '../../auth/2fa/methods/passkey/passkey.two-factor-method.ts';
import { AuthController } from '../../auth/auth-controller/auth-controller.model.ts';
import { type AuthServiceInterface } from '../../auth/auth-service.interface.ts';
import { PasskeyAuthenticationResponse } from '../../auth/authenticators/passkey/passkey-authentication-response.model.ts';
import { PasskeyChallenge } from '../../auth/authenticators/passkey/passkey-challenge.model.ts';
import { PasskeyCreationOptions } from '../../auth/authenticators/passkey/passkey-creation-options.model.ts';
import { PasskeyTicketCredentials } from '../../auth/authenticators/passkey/passkey-credentials.model.ts';
import { PasskeyRegistrationResponse } from '../../auth/authenticators/passkey/passkey-registration-response.model.ts';
import { PasskeyRegistrationTicket } from '../../auth/authenticators/passkey/passkey-registration-ticket.model.ts';
import { PasskeyRegistration } from '../../auth/authenticators/passkey/passkey-registration.model.ts';
import { PasskeyRequestOptions } from '../../auth/authenticators/passkey/passkey-request-options.model.ts';
import { PasskeyAuthenticator } from '../../auth/authenticators/passkey/passkey.authenticator.ts';
import { Passkey } from '../../auth/authenticators/passkey/passkey.model.ts';
import { Auth } from '../../auth/decorators/auth.decorator.ts';
import { JwtAuthData } from '../../auth/strategies/jwt/jwt-auth-data.model.ts';
import { JwtAuthStrategy } from '../../auth/strategies/jwt/jwt.auth-strategy.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { KnownHeader } from '../../http/known-header.enum.ts';
import { Body } from '../../routing/decorators/body.decorator.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Post } from '../../routing/decorators/post.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { JwtUser } from '../mocks/entities/jwt-user.entity.ts';
import { Roles } from '../mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

const ORIGIN: string = 'https://app.example.com';

@Controller('/auth', { allowOrphan: true, versions: 'all' })
class EvaluationAuthController extends AuthController({
        strategies: [JwtAuthStrategy],
        authenticators: [PasskeyAuthenticator],
        twoFactorMethods: [PasskeyTwoFactorMethod]
    }) {}

@Controller('/users', { allowOrphan: true })
class SignUpController {
    // what an application writes: a sign-up with nothing but a passkey, the same three steps as a
    // first sign-in through a provider
    @Auth.skip({ allowRedundant: true })
    @Post('/sign-up-with-passkey')
    async signUp(
        @Body(PasskeyTicketCredentials)
        input: PasskeyTicketCredentials
    ): Promise<JwtAuthData<Roles>> {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const registration: PasskeyRegistration = await authService.resolveRegistration(PasskeyAuthenticator, input, undefined);
        const user: JwtUser = await inject(repositoryTokenFor(JwtUser)).create({ email: registration.name, roles: [Roles.USER] });
        await authService.linkIdentity(PasskeyAuthenticator, input, user.id, undefined);
        return await authService.login(PasskeyAuthenticator<Roles, JwtUser>, JwtAuthStrategy<Roles, JwtUser>, input, undefined);
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
            allowOrphan: true
        });
        server = await startTestServer({
            dataSources: [dataSourceClass],
            authStrategies: [JwtAuthStrategy],
            authenticators: [PasskeyAuthenticator],
            twoFactorMethods: [PasskeyTwoFactorMethod],
            controllers: [EvaluationAuthController, SignUpController, AccountController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.PASSKEY_OPTIONS,
                    useValue: { relyingPartyId: 'example.com', relyingPartyName: 'Example', origins: [ORIGIN] }
                })
            ]
        });
        baseUrl = await server.start();
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

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

    async function signUp(device: FakePasskeyDevice, email: string): Promise<JwtAuthData<Roles>> {
        const [, options] = await post<PasskeyCreationOptions>('/auth/registration-options', { name: email });
        const response: PasskeyRegistrationResponse = device.create(options, ORIGIN);
        const [, { ticket }] = await post<{ ticket: string }>('/auth/register', { response });
        const [status, auth] = await post<JwtAuthData<Roles>>('/users/sign-up-with-passkey', { ticket });
        expect(status).toBe(200);
        return auth;
    }

    it('signs a user up with nothing but a passkey, which logs them in, and signs them in with it later', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        const signedUp: JwtAuthData<Roles> = await signUp(device, 'passkey-only@example.com');
        const account: Response = await fetch(`${baseUrl}/account`, {
            headers: { [KnownHeader.AUTHORIZATION]: `Bearer ${signedUp.accessToken.value}` }
        });
        expect(account.status).toBe(200);

        // no email, no password: the device offers the passkey it holds for the site
        const [, options] = await post<PasskeyRequestOptions>('/auth/sign-in-options', {});
        const [status, signedIn] = await post<JwtAuthData<Roles>>('/auth/login', { response: device.get(options, ORIGIN) });
        expect(status).toBe(200);
        expect(signedIn.userId).toBe(signedUp.userId);
    });

    it('refuses a passkey the browser used on another origin, the way a phishing page would get it used', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        await signUp(device, 'phished@example.com');

        const [, options] = await post<PasskeyRequestOptions>('/auth/sign-in-options', {});
        const phished: PasskeyAuthenticationResponse = device.get(options, 'https://app.examp1e.com');
        const [status] = await post<unknown>('/auth/login', { response: phished });
        expect(status).toBe(401);
    });

    it('takes a passkey as the second factor of an operation', async () => {
        const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
        const { accessToken } = await signUp(device, 'second-factor@example.com');
        const authorization: Record<string, string> = { [KnownHeader.AUTHORIZATION]: `Bearer ${accessToken.value}` };

        const [withoutFactor] = await post<unknown>('/account/payment-details', {}, authorization);
        expect(withoutFactor).toBe(401);

        const [, options] = await post<PasskeyRequestOptions>('/auth/2fa/start', {}, authorization);
        const assertion: string = Buffer.from(JsonUtilities.stringify(device.get(options, ORIGIN))).toString('base64url');
        const [withFactor] = await post<unknown>(
            '/account/payment-details',
            {},
            { ...authorization, [inject(ZIBRI_DI_TOKENS.PASSKEY_HEADER)]: assertion }
        );
        expect(withFactor).toBe(200);
    });
});