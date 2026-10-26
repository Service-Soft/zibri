import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, TestBrowser } from 'zibri-testing';

import type { FederatedAuthenticatorInterface } from './federated-authenticator.interface';
import { FederatedCredentials, FederatedHandoverCredentials } from './federated-credentials.model';
import { FederatedIdentity } from './federated-identity.model';
import { FederatedLinkIdentityStart } from './federated-link-identity-start.model';
import { FederatedMetadata } from './federated-metadata.model';
import { FederatedProviderLogout } from './federated-provider-logout.model';
import { FederatedRegistration } from './federated-registration.model';
import type { FederatedRouteEndpoint } from './federated-route-endpoint.model';
import type { FederatedRoute } from './federated-route.type';
import { FederatedSessionMatch } from './federated-session-match.model';
import { FederatedLoginFailure } from './federated-login-failure.enum';
import { FederatedLoginRequest } from './federated-login-request.model';
import { FederatedLoginResult } from './federated-login-result.model';
import { FederatedLoginError } from './federated-login.error';
import { FederatedSoapLogout } from './federated-soap-logout.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { JwtUser } from '../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { OmitClass } from '../../../entity/omit-class.model';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { HttpMethod } from '../../../http/http-method.enum';
import { KnownHeader } from '../../../http/known-header.enum';
import { $ts } from '../../../localization/translate.function';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Newable } from '../../../types/newable.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { OtpTwoFactorMethod } from '../../2fa/methods/otp/otp.two-factor-method';
import { AuthController } from '../../auth-controller/auth-controller.model';
import { Authentication } from '../../models/authentication.model';
import { JwtAuthStrategy } from '../../strategies/jwt/jwt.auth-strategy';
import { AuthControllerAuthenticatorInterface } from '../auth-controller-authenticator.interface';

const PUBLIC_URL: string = 'http://zibri.test';
const REDIRECT_TO: string = 'https://app.example.com/logged-in';

/**
 * A login that has been started, or answered.
 */
type DirectLogin = {
    redirectTo: string,
    codeChallenge: string | undefined
};

/**
 * A provider of the test's own, which logs in whoever `logsInAs` names as soon as it is asked. It
 * implements the interface itself rather than extending `BaseFederatedAuthenticator`.
 */
class DirectAuthenticator implements FederatedAuthenticatorInterface<string, JwtUser>, AuthControllerAuthenticatorInterface<string, JwtUser, FederatedCredentials> {
    readonly name: string = 'direct';

    readonly credentialsModel: Newable<FederatedCredentials> = FederatedHandoverCredentials;

    readonly routes: FederatedRouteEndpoint[] = [{ route: 'callback', method: HttpMethod.GET }];

    // who the next login logs in as
    logsInAs: string | undefined;

    private readonly started: Map<string, DirectLogin> = new Map();

    private readonly answered: Map<string, DirectLogin & { userId: string }> = new Map();

    resolveRouteUrl(route: FederatedRoute): string {
        return `${PUBLIC_URL}/auth/federated/${this.name}/${route}`;
    }

    async requestProviderLogin(request: FederatedLoginRequest): Promise<string> {
        const state: string = randomBytes(16).toString('hex');
        this.started.set(state, { redirectTo: request.redirectTo, codeChallenge: request.codeChallenge });
        return Promise.resolve(`${this.resolveRouteUrl('callback')}?state=${state}`);
    }

    async confirmProviderLogin(answer: URLSearchParams): Promise<FederatedLoginResult> {
        const login: DirectLogin | undefined = this.started.get(answer.get('state') ?? '');
        if (login == undefined || this.logsInAs == undefined) {
            return Promise.reject(new FederatedLoginError(FederatedLoginFailure.EXPIRED));
        }
        const code: string = randomBytes(16).toString('hex');
        this.answered.set(code, { ...login, userId: this.logsInAs });
        return Promise.resolve({ type: 'handover', code, redirectTo: login.redirectTo, strategy: undefined });
    }

    async authenticate(credentials: FederatedCredentials): Promise<Authentication<JwtUser>> {
        const login: (DirectLogin & { userId: string }) | undefined = 'code' in credentials ? this.answered.get(credentials.code) : undefined;
        const challenge: string | undefined = credentials.codeVerifier == undefined
            ? undefined
            : createHash('sha256').update(credentials.codeVerifier)
                .digest('base64url');
        if (login == undefined || login.codeChallenge !== challenge) {
            throw new UnauthorizedError($ts`The code is invalid.`);
        }
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findById(login.userId);
        return { user, authenticatedAt: new Date() };
    }

    async continueLinkIdentity(): Promise<string> {
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

    async resolveBackChannelLogout(): Promise<FederatedSessionMatch> {
        return Promise.reject(new NotFoundError($ts`Nothing can be logged out at.`));
    }

    async resolveRegistration(): Promise<FederatedRegistration> {
        return Promise.reject(new NotFoundError($ts`Nobody registers.`));
    }

    async linkTicketIdentity(): Promise<void> {
        return Promise.reject(new NotFoundError($ts`Nothing is linked.`));
    }

    async requestLinkIdentity(): Promise<FederatedLinkIdentityStart> {
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
 * The auth routes of an application logging in through the given provider. The provider connects
 * nothing to an account, so the route requesting a link is left out.
 * @param authenticator - The provider's authenticator.
 * @returns The controller.
 */
function defineAuthController(authenticator: Newable<DirectAuthenticator>): Newable<unknown> {
    // an orphan for every case that boots with another one
    @Controller('/auth', { allowOrphan: true, versions: 'all' })
    class DirectAuthController extends OmitClass(
            AuthController({ strategies: [JwtAuthStrategy], authenticators: [authenticator], twoFactorMethods: [OtpTwoFactorMethod] }),
            ['requestLinkIdentity']
        ) {}
    return DirectAuthController;
}

/**
 * Starts an application logging in through the given provider, at the routes of the auth controller.
 * @param authenticator - The provider's authenticator.
 * @returns The server and the url it listens at.
 */
async function startApp(authenticator: Newable<DirectAuthenticator>): Promise<[StartedTestServer, string]> {
    const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true });
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
                    errorUrl: 'https://app.example.com/login-failed',
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
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('logs in through the routes of the auth controller', async () => {
        const user: JwtUser = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser))
            .create({ email: `${randomBytes(6).toString('hex')}@example.com`, roles: [Roles.USER] });
        inject(DirectAuthenticator).logsInAs = user.id;
        const verifier: string = randomBytes(32).toString('base64url');
        const codeChallenge: string = createHash('sha256').update(verifier)
            .digest('base64url');
        const browser: TestBrowser = new TestBrowser(baseUrl, PUBLIC_URL);

        const landing: string = await browser.follow(await browser.follow(
            `${PUBLIC_URL}/auth/federated/login/request?${new URLSearchParams({ redirectTo: REDIRECT_TO, codeChallenge }).toString()}`
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
    }, TestTimeouts.inMemory.start);

    it('refuses to start when the route answering a url an authenticator of the application\'s own gives out takes another method', async () => {
        await expect(startThenShutDown(RedirectedSoapLogoutDirectAuthenticator))
            .rejects.toThrow(/RedirectedSoapLogoutDirectAuthenticator[\S\s]*http:\/\/zibri\.test\/auth\/federated\/direct\/logout\/soap[\S\s]*GET[\S\s]*POST/);
    }, TestTimeouts.inMemory.start);
});