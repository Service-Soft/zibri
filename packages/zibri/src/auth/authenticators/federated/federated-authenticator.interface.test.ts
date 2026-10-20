import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource, TestBrowser } from 'zibri-testing';

import type { FederatedAuthenticatorInterface } from './federated-authenticator.interface.ts';
import { FederatedConnectionStart } from './federated-connection-start.model.ts';
import { FederatedCredentials, FederatedHandoverCredentials } from './federated-credentials.model.ts';
import { FederatedIdentity } from './federated-identity.model.ts';
import { FederatedMetadata } from './federated-metadata.model.ts';
import { FederatedProviderLogout } from './federated-provider-logout.model.ts';
import { FederatedRegistration } from './federated-registration.model.ts';
import type { FederatedRouteEndpoint } from './federated-route-endpoint.model.ts';
import type { FederatedRoute } from './federated-route.type.ts';
import { FederatedSignInFailure } from './federated-sign-in-failure.enum.ts';
import { FederatedSignInRequest } from './federated-sign-in-request.model.ts';
import { FederatedSignInResult } from './federated-sign-in-result.model.ts';
import { FederatedSignInError } from './federated-sign-in.error.ts';
import { FederatedSoapLogout } from './federated-soap-logout.model.ts';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity.ts';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { defineProvider } from '../../../di/models/di-provider.model.ts';
import { OmitClass } from '../../../entity/omit-class.model.ts';
import { NotFoundError } from '../../../error-handling/errors/not-found.error.ts';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error.ts';
import { HttpMethod } from '../../../http/http-method.enum.ts';
import { KnownHeader } from '../../../http/known-header.enum.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { Controller } from '../../../routing/decorators/controller.decorator.ts';
import { Newable } from '../../../types/newable.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method.ts';
import { AuthController } from '../../auth-controller/auth-controller.model.ts';
import { Authentication } from '../../models/authentication.model.ts';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy.ts';
import { AuthControllerAuthenticatorInterface } from '../auth-controller-authenticator.interface.ts';

const PUBLIC_URL: string = 'http://zibri.test';
const REDIRECT_TO: string = 'https://app.example.com/signed-in';

/**
 * A sign-in that has been started, or answered.
 */
type DirectSignIn = {
    redirectTo: string,
    codeChallenge: string | undefined
};

/**
 * A provider of the test's own, which signs in whoever `signsIn` names as soon as it is asked. It
 * implements the interface itself rather than extending `BaseFederatedAuthenticator`.
 */
class DirectAuthenticator implements FederatedAuthenticatorInterface<Roles, JwtUser>, AuthControllerAuthenticatorInterface<Roles, JwtUser, FederatedCredentials> {
    readonly name: string = 'direct';

    readonly credentialsModel: Newable<FederatedCredentials> = FederatedHandoverCredentials;

    readonly routes: FederatedRouteEndpoint[] = [{ route: 'callback', method: HttpMethod.GET }];

    // who the next sign-in signs in as
    signsIn: string | undefined;

    private readonly started: Map<string, DirectSignIn> = new Map();

    private readonly answered: Map<string, DirectSignIn & { userId: string }> = new Map();

    resolveRouteUrl(route: FederatedRoute): string {
        return `${PUBLIC_URL}/auth/federated/${this.name}/${route}`;
    }

    async startSignIn(request: FederatedSignInRequest): Promise<string> {
        const state: string = randomBytes(16).toString('hex');
        this.started.set(state, { redirectTo: request.redirectTo, codeChallenge: request.codeChallenge });
        return Promise.resolve(`${this.resolveRouteUrl('callback')}?state=${state}`);
    }

    async completeSignIn(answer: URLSearchParams): Promise<FederatedSignInResult> {
        const signIn: DirectSignIn | undefined = this.started.get(answer.get('state') ?? '');
        if (signIn == undefined || this.signsIn == undefined) {
            return Promise.reject(new FederatedSignInError(FederatedSignInFailure.EXPIRED));
        }
        const code: string = randomBytes(16).toString('hex');
        this.answered.set(code, { ...signIn, userId: this.signsIn });
        return Promise.resolve({ type: 'handover', code, redirectTo: signIn.redirectTo, strategy: undefined });
    }

    async authenticate(credentials: FederatedCredentials): Promise<Authentication<JwtUser>> {
        const signIn: (DirectSignIn & { userId: string }) | undefined = 'code' in credentials ? this.answered.get(credentials.code) : undefined;
        const challenge: string | undefined = credentials.codeVerifier == undefined
            ? undefined
            : createHash('sha256').update(credentials.codeVerifier)
                .digest('base64url');
        if (signIn == undefined || signIn.codeChallenge !== challenge) {
            throw new UnauthorizedError($ts`The code is invalid.`);
        }
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findById(signIn.userId);
        return { user, authenticatedAt: new Date() };
    }

    async continueConnection(): Promise<string> {
        return Promise.reject(new NotFoundError($ts`Nothing can be connected.`));
    }

    async resolveFormPostOrigins(): Promise<string[]> {
        return Promise.resolve([]);
    }

    async resolveMetadata(): Promise<FederatedMetadata | undefined> {
        return Promise.resolve(undefined);
    }

    async createLogoutUrl(): Promise<string | undefined> {
        return Promise.resolve(undefined);
    }

    async readProviderLogout(): Promise<FederatedProviderLogout> {
        return Promise.reject(new NotFoundError($ts`Nothing can be logged out at.`));
    }

    async resolveSoapLogout(): Promise<FederatedSoapLogout> {
        return Promise.reject(new NotFoundError($ts`Nothing can be logged out at.`));
    }

    async resolveRegistration(): Promise<FederatedRegistration> {
        return Promise.reject(new NotFoundError($ts`Nobody registers.`));
    }

    async linkIdentity(): Promise<void> {
        return Promise.reject(new NotFoundError($ts`Nothing is linked.`));
    }

    async startConnection(): Promise<FederatedConnectionStart> {
        return Promise.reject(new NotFoundError($ts`Nothing can be connected.`));
    }

    async findIdentities(): Promise<FederatedIdentity[]> {
        return Promise.resolve([]);
    }

    async unlinkIdentity(): Promise<void> {
        return Promise.reject(new NotFoundError($ts`Nothing is linked.`));
    }
}

/**
 * Gives out a callback no route of the application answers.
 */
class LostDirectAuthenticator extends DirectAuthenticator {
    override resolveRouteUrl(route: FederatedRoute): string {
        return `${PUBLIC_URL}/nowhere/${route}`;
    }
}

/**
 * Has the browser sent to the SOAP logout route, which the federated controller only answers when a
 * provider posts to it.
 */
class RedirectedSoapLogoutDirectAuthenticator extends DirectAuthenticator {
    override readonly routes: FederatedRouteEndpoint[] = [
        { route: 'callback', method: HttpMethod.GET },
        { route: 'logout/soap', method: HttpMethod.GET }
    ];
}

/**
 * The auth routes of an application signing in through the given provider. The provider connects
 * nothing to an account, so the route starting a connection is left out.
 * @param authenticator - The provider's authenticator.
 * @returns The controller.
 */
function defineAuthController(authenticator: Newable<DirectAuthenticator>): Newable<unknown> {
    // an orphan for every case that boots with another one
    @Controller('/auth', { allowOrphan: true, versions: 'all' })
    class DirectAuthController extends OmitClass(
            AuthController({ strategies: [JwtAuthStrategy], authenticators: [authenticator], twoFactorMethods: [OtpTwoFactorMethod] }),
            ['startConnection']
        ) {}
    return DirectAuthController;
}

/**
 * Starts an application signing in through the given provider, at the routes of the auth controller.
 * @param authenticator - The provider's authenticator.
 * @returns The server and the url it listens at.
 */
async function startApp(authenticator: Newable<DirectAuthenticator>): Promise<[StartedTestServer, string]> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities, allowOrphan: true });
    const server: StartedTestServer = await startTestServer({
        baseUrl: PUBLIC_URL,
        dataSources: [dataSourceClass],
        authStrategies: [JwtAuthStrategy],
        authenticators: [authenticator],
        controllers: [defineAuthController(authenticator)],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET, useFactory: () => 'test-cookie-secret' }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.FEDERATION_OPTIONS,
                useValue: {
                    allowedRedirects: ['https://app.example.com'],
                    registrationUrl: 'https://app.example.com/register',
                    errorUrl: 'https://app.example.com/sign-in-failed',
                    maxAuthenticationAgeInMs: 3600000
                }
            })
        ]
    });
    try {
        return [server, await server.start()];
    }
    catch (error) {
        // a start the application refuses still leaves it initialized, which only the test can end
        await server.shutdown();
        throw error;
    }
}

/**
 * Starts an application a case expects to be refused, and ends it again when it starts anyway, so the
 * case fails rather than leaving it running.
 * @param authenticator - The provider's authenticator.
 */
async function startThenShutDown(authenticator: Newable<DirectAuthenticator>): Promise<void> {
    const [server] = await startApp(authenticator);
    await server.shutdown();
}

describe('FederatedAuthenticatorInterface — an authenticator of the application\'s own', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        [server, baseUrl] = await startApp(DirectAuthenticator);
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('signs in through the routes of the auth controller', async () => {
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
            .create({ email: `${randomBytes(6).toString('hex')}@example.com`, roles: [Roles.USER] });
        inject(DirectAuthenticator).signsIn = user.id;
        const verifier: string = randomBytes(32).toString('base64url');
        const codeChallenge: string = createHash('sha256').update(verifier)
            .digest('base64url');
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const landing: string = await browser.follow(await browser.follow(
            `${PUBLIC_URL}/auth/federated/authorize?${new URLSearchParams({ redirectTo: REDIRECT_TO, codeChallenge }).toString()}`
        ));
        const res: Response = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { [KnownHeader.CONTENT_TYPE]: 'application/json' },
            body: JsonUtilities.stringify({ code: new URL(landing).searchParams.get('code'), codeVerifier: verifier })
        });

        expect(res.status).toBe(200);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const body: { userId: string } = await res.json();
        expect(body.userId).toBe(user.id);
    });
});

describe('FederatedAuthenticatorInterface — starting', () => {
    it('refuses to start when a url an authenticator of the application\'s own gives out reaches no route', async () => {
        await expect(startThenShutDown(LostDirectAuthenticator))
            .rejects.toThrow(/LostDirectAuthenticator[\S\s]*http:\/\/zibri\.test\/nowhere\/callback/);
    }, 20000);

    it('refuses to start when the route answering a url an authenticator of the application\'s own gives out takes another method', async () => {
        await expect(startThenShutDown(RedirectedSoapLogoutDirectAuthenticator))
            .rejects.toThrow(/RedirectedSoapLogoutDirectAuthenticator[\S\s]*http:\/\/zibri\.test\/auth\/federated\/direct\/logout\/soap[\S\s]*GET[\S\s]*POST/);
    }, 20000);
});