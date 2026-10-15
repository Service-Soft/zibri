import { AuthControllerAuthenticatorClass } from './auth-controller-authenticator-class.type';
import { AuthControllerClass } from './auth-controller-class.type';
import { AuthControllerOptions } from './auth-controller-options.model';
import { FEDERATED_ROUTE } from './auth-controller-routes.model';
import { AuthControllerStrategyClass } from './auth-controller-strategy-class.type';
import { AuthControllerUtilities } from './auth-controller.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { IsolationLevel } from '../../data-source/data-sources/data-source.interface';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { copyClassProperties } from '../../entity/utilities/copy-class-properties.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { MimeType } from '../../http/mime-type.enum';
import { RedirectResponse } from '../../http/redirect-response.model';
import { $ts } from '../../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { auditReasonFor } from '../../logging/audit-reason-for.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { FileResponse } from '../../parsing/form-data/file-response.model';
import { RateLimited } from '../../rate-limiting/decorators/rate-limited.decorator';
import { AcceptCrossSitePosts } from '../../routing/decorators/accept-cross-site-posts.decorator';
import { Body } from '../../routing/decorators/body.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Newable } from '../../types/newable.type';
import { TwoFactorMethod } from '../2fa/methods/two-factor-method.interface';
import { TwoFactorMethods } from '../2fa/two-factor-methods.model';
import { type TwoFactorServiceInterface } from '../2fa/two-factor-service.interface';
import { type AuthServiceInterface } from '../auth-service.interface';
import { ConnectingAuthenticatorInterface, isConnectingAuthenticator } from '../authenticators/connecting-authenticator.interface';
import { ConnectionCompletingAuthenticatorInterface, isConnectionCompletingAuthenticator } from '../authenticators/connection-completing-authenticator.interface';
import { FederatedAuthenticatorInterface, isFederatedAuthenticator } from '../authenticators/federated/federated-authenticator.interface';
import { FederatedCallbackForm } from '../authenticators/federated/federated-callback-form.model';
import { FederatedRouteUtilities } from '../authenticators/federated/federated-route.utilities';
import { FederatedSignInResult } from '../authenticators/federated/federated-sign-in-result.model';
import { LinkedIdentity } from '../authenticators/linked-identity.model';
import { ConfirmPasswordResetDto } from '../authenticators/password/confirm-password-reset-data.model';
import { PasswordResetTokenInput } from '../authenticators/password/password-reset-token-input.model';
import { PasswordResetTokenValidity } from '../authenticators/password/password-reset-token-validity.model';
import { RequestPasswordResetInput } from '../authenticators/password/request-password-reset-input.model';
import { isSignInOptionsAuthenticator, SignInOptionsAuthenticatorInterface } from '../authenticators/sign-in-options-authenticator.interface';
import { isSignUpAuthenticator, SignUpAuthenticatorInterface } from '../authenticators/sign-up-authenticator.interface';
import { Auth } from '../decorators/auth.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { type BaseUser } from '../models/base-user.model';
import { LogoutResult } from '../models/logout-result.model';
import { PasswordResetToken } from '../models/password-reset-token.model';
import { isAuthStrategy } from '../strategies/auth-strategy.interface';
import { CsrfTokenAuthStrategyInterface, isCsrfTokenAuthStrategy } from '../strategies/csrf-token-auth-strategy.interface';
import { CsrfToken } from '../strategies/csrf-token.model';

/**
 * A model, as a function answering it once the application has started.
 */
type ModelResolver = () => Newable<unknown>;

/**
 * A model a route may answer with, as a function answering it once the application has started, or
 * undefined when it answers with nothing.
 */
type OptionalModelResolver = () => Newable<unknown> | undefined;

/**
 * An authenticator whose identities a user connects to their account.
 */
type ConnectingAuthenticator = ConnectingAuthenticatorInterface<string, BaseUser<string>, unknown, unknown, unknown, {
    /**
     * The id of the identity the connection links.
     */
    id: string
}, unknown, unknown>;

/**
 * An authenticator that finishes connecting with an answer of the client.
 */
type ConnectionCompletingAuthenticator = ConnectionCompletingAuthenticatorInterface<string, BaseUser<string>, unknown, unknown>;

/**
 * An authenticator that signs users in at a provider.
 */
type FederatedAuthenticator = FederatedAuthenticatorInterface<string, BaseUser<string>>;

/**
 * An authenticator that hands out a challenge to sign in with.
 */
type SignInOptionsAuthenticator = SignInOptionsAuthenticatorInterface<string, BaseUser<string>, unknown, unknown>;

/**
 * An authenticator that signs up users by itself.
 */
type SignUpAuthenticator = SignUpAuthenticatorInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown>;

/**
 * A strategy that issues csrf tokens.
 */
type CsrfTokenAuthStrategy = CsrfTokenAuthStrategyInterface<string, BaseUser<string>>;

/**
 * A two factor method, whatever it takes and answers with.
 */
type AnyTwoFactorMethod = TwoFactorMethod<unknown, unknown, unknown, unknown>;

/**
 * The method of a route of `AuthController`, by the members of its class that call for it.
 */
type RouteGroup = {
    /**
     * The methods of the routes.
     */
    routes: string[],
    /**
     * Whether the classes call for the routes.
     */
    present: boolean
};

// eslint-disable-next-line jsdoc/require-returns, jsdoc/require-throws
/**
 * Defines the auth routes of the given strategies, authenticators and two factor methods, below the
 * path of the controller that extends it: logging in, refreshing a login and logging out, and the
 * routes only some of them call for, such as resetting a password, signing in at a provider or
 * enrolling a second factor.
 *
 * The options name exactly what the application registers, which it checks while it starts. Leave out
 * a route with `OmitClass`, and write your own in its place.
 * @param options - The strategies, authenticators and two factor methods the routes are for.
 */
export function AuthController<
    Strategies extends AuthControllerStrategyClass[],
    Authenticators extends AuthControllerAuthenticatorClass[],
    Methods extends TwoFactorMethods
>(options: AuthControllerOptions<Strategies, Authenticators, Methods>): AuthControllerClass<Strategies, Authenticators, Methods> {
    const strategies: AuthControllerStrategyClass[] = options.strategies;
    const authenticators: AuthControllerAuthenticatorClass[] = options.authenticators;
    const twoFactorMethods: TwoFactorMethods = options.twoFactorMethods;
    if (!strategies.length || !authenticators.length) {
        throw new InternalError(
            'AuthController logs in with at least one strategy and one authenticator, and was given none of one of them.'
        );
    }
    // which routes there are is decided here, from the classes, because the decorators run now. What
    // each route reads and answers with is read from the instances, once the application has started
    const csrfStrategies: AuthControllerStrategyClass[] = withMember(strategies, 'resolveCsrfToken');
    const resetting: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'confirmPasswordReset');
    const challenging: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'resolveSignInOptions');
    const signingUp: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'completeSignUp');
    const federated: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'completeSignIn');
    const connecting: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'startConnection');
    const completing: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'completeConnection');
    const linking: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'findIdentities');

    // eslint-disable-next-line jsdoc/require-jsdoc
    class Temp {
        /**
         * What the routes were built from, which also marks the class as the auth controller.
         */
        static readonly authControllerOptions: AuthControllerOptions<Strategies, Authenticators, Methods> = options;

        private get authService(): AuthServiceInterface {
            return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        }

        private get twoFactorService(): TwoFactorServiceInterface {
            return inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
        }

        // read when used rather than injected: only the password reset needs it, and its authenticator
        // names the entity when it is missing
        private get passwordResetTokenRepository(): Repository<PasswordResetToken> {
            return inject(repositoryTokenFor(PasswordResetToken));
        }

        // the routes anyone may call without being anybody yet are unauthenticated by necessity: they
        // stay reachable whichever `defaultAuth` the application declared, and `allowRedundant` because
        // a controller the framework defines cannot know which one that was.
        //
        // They share one budget per caller: a password is the one secret short enough to guess, and
        // checking one costs a deliberately slow hash
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @respondsWith(strategies.map(s => () => inject(s).authDataModel))
        @Post('/login')
        async login(
            @Param.query('authenticator', { type: 'string', required: authenticators.length > 1 })
            authenticator: string | undefined,
            @Param.query('strategy', { type: 'string', required: strategies.length > 1 })
            strategy: string | undefined,
            @bodyOf(authenticators.map(a => () => inject(a).credentialsModel), true)
            credentials: object
        ): Promise<unknown> {
            const authenticatorClass: AuthControllerAuthenticatorClass = AuthControllerUtilities
                .resolveNamed(authenticators, authenticator, 'authenticator');
            // again for the one the request names: the body is the first of the models it fits, which
            // with several of them may be another authenticator's
            await AuthControllerUtilities.validateBody(credentials, inject(authenticatorClass).credentialsModel);
            const strategyClass: AuthControllerStrategyClass = AuthControllerUtilities.resolveNamed(strategies, strategy, 'strategy');
            return await AuthControllerUtilities.runInTransaction(
                strategyClass,
                // eslint-disable-next-line typescript/no-unsafe-return
                async transaction => await this.authService.login(authenticatorClass, strategyClass, credentials, transaction)
            );
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @respondsWith(strategies.map(s => () => inject(s).authDataModel))
        @Post('/refresh-login')
        async refreshLogin(
            @Param.query('strategy', { type: 'string', required: strategies.length > 1 })
            strategy: string | undefined,
            @bodyOf(strategies.map(s => () => inject(s).refreshLoginModel), true)
            data: object
        ): Promise<unknown> {
            const strategyClass: AuthControllerStrategyClass = AuthControllerUtilities.resolveNamed(strategies, strategy, 'strategy');
            await AuthControllerUtilities.validateBody(data, inject(strategyClass).refreshLoginModel);
            return await AuthControllerUtilities.runInTransaction(
                strategyClass,
                // eslint-disable-next-line typescript/no-unsafe-return
                async transaction => await this.authService.refreshLogin(strategyClass, { ...data, transaction })
            );
        }

        // answers where to log out at the provider the login was started at, if any
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @Response.object(LogoutResult)
        @Post('/logout')
        async logout(
            @Param.query('strategy', { type: 'string', required: strategies.length > 1 })
            strategy: string | undefined,
            @bodyOf(strategies.map(s => () => inject(s).logoutModel), true)
            data: object
        ): Promise<LogoutResult> {
            const strategyClass: AuthControllerStrategyClass = AuthControllerUtilities.resolveNamed(strategies, strategy, 'strategy');
            await AuthControllerUtilities.validateBody(data, inject(strategyClass).logoutModel);
            return await AuthControllerUtilities.runInTransaction(
                strategyClass,
                async transaction => await this.authService.logout(strategyClass, { ...data, transaction })
            );
        }

        // how a client that holds the cookies but not the token gets it: after a page reload, or after a
        // login that ended in a redirect rather than a response body. A GET, so the csrf check does not
        // apply, and what keeps another origin from reading the answer is CORS - the same thing that
        // keeps it from reading the login response
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @Response.object(CsrfToken)
        @Get('/csrf-token')
        async csrfToken(
            @Param.query('strategy', { type: 'string', required: csrfStrategies.length > 1 })
            strategy: string | undefined
        ): Promise<CsrfToken> {
            const strategyClass: Newable<CsrfTokenAuthStrategy> = AuthControllerUtilities.resolveCapable(
                csrfStrategies,
                strategy,
                'strategy',
                isCsrfTokenStrategy
            );
            const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
            const csrfToken: string | undefined = context == undefined ? undefined : await inject(strategyClass).resolveCsrfToken(context);
            if (csrfToken == undefined) {
                throw new UnauthorizedError($ts`No valid session`);
            }
            return { csrfToken };
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.empty()
        @Post('/request-password-reset')
        async requestPasswordReset(
            @Body(RequestPasswordResetInput)
            data: RequestPasswordResetInput
        ): Promise<void> {
            const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
                .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
            try {
                // an address nobody has registered gets the same answer as one somebody has. This route
                // is unauthenticated, so anything that distinguishes the two turns it into a list of who
                // holds an account here - and the caller is not entitled to that either way.
                const user: BaseUser<string> | undefined = await inject(ZIBRI_DI_TOKENS.USER_SERVICE)
                    .findByEmail(data.email, { required: false });
                if (user) {
                    await this.authService.requestPasswordReset({ user, transaction });
                }
                await transaction.commit();

                // after the commit, so the outcome describes what happened rather than what was about to
                // be attempted. Recorded here rather than in the service because here is the only place
                // a request for an address nobody holds is still visible - the authenticator is handed a
                // resolved user, so by then those have been filtered out. They are the ones worth seeing:
                // the reply is identical either way, so a run against a list of addresses leaves no other
                // trace anywhere.
                inject(ZIBRI_DI_TOKENS.LOGGER).audit({
                    action: AuditAction.PASSWORD_RESET_REQUESTED,
                    outcome: user ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
                    reason: user ? undefined : AuditReason.NO_SUCH_SUBJECT,
                    subject: data.email,
                    userId: user?.id
                });
            }
            catch (error) {
                await transaction.rollback();
                inject(ZIBRI_DI_TOKENS.LOGGER).audit({
                    action: AuditAction.PASSWORD_RESET_REQUESTED,
                    outcome: AuditOutcome.FAILURE,
                    reason: auditReasonFor(error),
                    subject: data.email
                });
                throw error;
            }
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.object(PasswordResetTokenValidity)
        @Post('/verify-password-reset-token')
        async verifyPasswordResetToken(
            @Body(PasswordResetTokenInput)
            input: PasswordResetTokenInput
        ): Promise<PasswordResetTokenValidity> {
            return { isValid: await this.authService.isPasswordResetTokenValid(input.resetToken) };
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.empty()
        @Post('/confirm-password-reset')
        async confirmPasswordReset(
            @Body(ConfirmPasswordResetDto)
            data: ConfirmPasswordResetDto
        ): Promise<void> {
            const transaction: Transaction = await this.passwordResetTokenRepository.dataSource
                .startTransaction({ isolationLevel: IsolationLevel.READ_COMMITTED });
            try {
                await this.authService.confirmPasswordReset({ ...data, transaction });
                await transaction.commit();
            }
            catch (error) {
                await transaction.rollback();
                throw error;
            }
        }

        // every route anyone may call that stores a challenge shares the login's budget
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @respondsWith(challenging.map(a => () => resolveInstance(a, isSignInOptionsAuthenticator)?.signInOptionsModel))
        @Post('/sign-in-options')
        async signInOptions(
            @Param.query('authenticator', { type: 'string', required: challenging.length > 1 })
            authenticator: string | undefined
        ): Promise<unknown> {
            const authenticatorClass: Newable<SignInOptionsAuthenticator> = AuthControllerUtilities
                .resolveCapable(challenging, authenticator, 'authenticator', isSignInOptionsAuthenticator);
            return await inject(authenticatorClass).resolveSignInOptions();
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @respondsWith(signingUp.map(a => () => resolveInstance(a, isSignUpAuthenticator)?.signUpOptionsModel))
        @Post('/registration-options')
        async registrationOptions(
            @Param.query('authenticator', { type: 'string', required: signingUp.length > 1 })
            authenticator: string | undefined,
            @bodyOf(signingUp.map(a => () => resolveModel(a, isSignUpAuthenticator, s => s.signUpRequestModel)), true)
            request: object
        ): Promise<unknown> {
            const instance: SignUpAuthenticator = inject(AuthControllerUtilities
                .resolveCapable(signingUp, authenticator, 'authenticator', isSignUpAuthenticator));
            await AuthControllerUtilities.validateBody(request, instance.signUpRequestModel);
            return await instance.resolveSignUpOptions(request);
        }

        // answers with the ticket the application's own sign-up route creates the user with
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @respondsWith(signingUp.map(a => () => resolveInstance(a, isSignUpAuthenticator)?.ticketModel))
        @Post('/register')
        async register(
            @Param.query('authenticator', { type: 'string', required: signingUp.length > 1 })
            authenticator: string | undefined,
            @bodyOf(signingUp.map(a => () => resolveModel(a, isSignUpAuthenticator, s => s.signUpAnswerModel)), true)
            answer: object
        ): Promise<unknown> {
            const instance: SignUpAuthenticator = inject(AuthControllerUtilities
                .resolveCapable(signingUp, authenticator, 'authenticator', isSignUpAuthenticator));
            await AuthControllerUtilities.validateBody(answer, instance.signUpAnswerModel);
            return await instance.completeSignUp(answer);
        }

        // the frontend sends the browser here, and the sign-in either logs in on the redirect back or
        // hands the login over by code.
        //
        // With the challenge of a PKCE verifier the frontend keeps, the browser lands on redirectTo
        // with a one-time code only that verifier can take at the login route, so a code that ends up
        // in somebody else's hands logs nobody in. That works for every strategy.
        //
        // Without one, the callback starts the login itself. That only works for a strategy whose login
        // goes out with the response, as cookies do: the callback answers with a redirect, which has no
        // body a frontend could read tokens from, and tokens in the url end up in history, logs and
        // Referer headers. A sign-in for any other strategy is refused here, before the user signs in
        // at the provider for nothing
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.redirect()
        @Get(`${FEDERATED_ROUTE}/authorize`)
        async authorize(
            @Param.query('authenticator', { type: 'string', required: federated.length > 1 })
            authenticator: string | undefined,
            @Param.query('redirectTo')
            redirectTo: string,
            @Param.query('codeChallenge', { type: 'string', required: false })
            codeChallenge: string | undefined,
            @Param.query('strategy', { type: 'string', required: false })
            strategy: string | undefined,
            @Param.query('reauthenticate', { type: 'boolean', required: false })
            reauthenticate: boolean | undefined,
            @Param.query('scopes', { type: 'string', required: false })
            scopes: string | undefined
        ): Promise<RedirectResponse> {
            const authenticatorClass: Newable<FederatedAuthenticator> = AuthControllerUtilities
                .resolveCapable(federated, authenticator, 'authenticator', isFederatedAuthenticator);
            const url: string = await inject(authenticatorClass).startSignIn({
                redirectTo,
                codeChallenge,
                strategy: codeChallenge == undefined ? resolveRedirectStrategy(strategies, strategy) : undefined,
                reauthenticate: reauthenticate === true,
                apiScopes: FederatedRouteUtilities.toApiScopes(scopes)
            });
            return RedirectResponse.to(url);
        }

        // where a provider sends the browser back to. Tokens never travel in a url, so a login that is
        // handed over goes on to the frontend as the one-time code, which it exchanges at the login route
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.redirect()
        @Get(`${FEDERATED_ROUTE}/:provider/callback`)
        async callback(
            @Param.path('provider')
            provider: string
        ): Promise<RedirectResponse> {
            return await this.completeSignIn(provider, FederatedRouteUtilities.resolveCallbackQuery());
        }

        // where a provider that answers with a form post has the browser post its answer. Another site's
        // page sends it, so it is let through with cookies - from that provider's sign-in page only
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @AcceptCrossSitePosts({ acceptedOrigins: async params => await FederatedRouteUtilities.resolveFormPostOrigins(params) })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.redirect()
        @Post(`${FEDERATED_ROUTE}/:provider/callback`)
        async formPostCallback(
            @Param.path('provider')
            provider: string,
            @Body(FederatedCallbackForm, { type: MimeType.FORM_URL_ENCODED, allowAdditionalProperties: true })
            form: FederatedCallbackForm
        ): Promise<RedirectResponse> {
            return await this.completeSignIn(provider, FederatedRouteUtilities.toCallbackParams(form));
        }

        // where the frontend sends the browser to connect a provider to an account, with the url the
        // connect route answered with. The browser is tied to the connection here and goes on to the provider
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.redirect()
        @Get(`${FEDERATED_ROUTE}/:provider/connect`)
        async connectProvider(
            @Param.path('provider')
            provider: string,
            @Param.query('code')
            code: string
        ): Promise<RedirectResponse> {
            return await FederatedRouteUtilities.resolveConnectionRedirect(provider, code);
        }

        // where a provider sends the browser to say the user logged out there, or that it ended its
        // session after a logout here
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.redirect()
        @Get(`${FEDERATED_ROUTE}/:provider/logout`)
        async providerLogout(
            @Param.path('provider')
            provider: string
        ): Promise<RedirectResponse> {
            return await FederatedRouteUtilities.completeProviderLogout(provider);
        }

        // the document the provider is set up with, for a provider whose protocol publishes one
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @Response.file()
        @Get(`${FEDERATED_ROUTE}/:provider/metadata`)
        metadata(
            @Param.path('provider')
            provider: string
        ): FileResponse {
            return FederatedRouteUtilities.toMetadata(provider);
        }

        // guarded the way changing a password is: an identity is a way into the account
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.require2fa({ reauth: true })
        @respondsWith(connecting.map(a => () => resolveInstance(a, isConnectingAuthenticator)?.connectionStartModel))
        @Post('/connect')
        async startConnection(
            @Param.query('authenticator', { type: 'string', required: connecting.length > 1 })
            authenticator: string | undefined,
            @bodyOf(connecting.map(a => () => resolveModel(a, isConnectingAuthenticator, c => c.connectionRequestModel)), true)
            request: object
        ): Promise<unknown> {
            const authenticatorClass: Newable<ConnectingAuthenticator> = AuthControllerUtilities
                .resolveCapable(connecting, authenticator, 'authenticator', isConnectingAuthenticator);
            await AuthControllerUtilities.validateBody(request, inject(authenticatorClass).connectionRequestModel);
            return await this.authService.startConnection(authenticatorClass, request);
        }

        // finishes a connection the connect route started, for the same user
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.empty()
        @Post('/connect/complete')
        async completeConnection(
            @Param.query('authenticator', { type: 'string', required: completing.length > 1 })
            authenticator: string | undefined,
            @bodyOf(completing.map(a => () => resolveModel(a, isConnectionCompletingAuthenticator, c => c.connectionAnswerModel)), true)
            answer: object
        ): Promise<void> {
            const authenticatorClass: Newable<ConnectionCompletingAuthenticator> = AuthControllerUtilities
                .resolveCapable(completing, authenticator, 'authenticator', isConnectionCompletingAuthenticator);
            await AuthControllerUtilities.validateBody(answer, inject(authenticatorClass).connectionAnswerModel);
            await this.authService.completeConnection(authenticatorClass, answer);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.array(LinkedIdentity)
        @Get('/identities')
        async findIdentities(
            @CurrentUser()
            user: BaseUser<string>
        ): Promise<LinkedIdentity[]> {
            return await this.authService.findIdentities(user.id, undefined);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.require2fa({ reauth: true })
        @Response.empty()
        @Delete('/identities/:identityId')
        async unlinkIdentity(
            @CurrentUser()
            user: BaseUser<string>,
            @Param.path('identityId')
            identityId: string
        ): Promise<void> {
            await this.authService.unlinkIdentity(user.id, identityId, undefined);
        }

        // a password must not be enough to add a factor of the attacker's own to an account that has one,
        // so a user who holds one presents it. A user without one could otherwise never enrol their
        // first, and logs in again instead
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.require2fa({ reauth: 'onlyAsFallback' })
        @Response.empty({ mimeTypes: [MimeType.JSON] })
        @respondsWith(twoFactorMethods.map(m => () => inject(m).registrationModel))
        @Post('/2fa/register')
        async requestTwoFactorRegistration(
            @CurrentUser()
            user: BaseUser<string>,
            @Param.query('method', { type: 'string', required: twoFactorMethods.length > 1 })
            method: string | undefined,
            @bodyOf(twoFactorMethods.map(m => () => inject(m).requestRegisterModel), false)
            data: object | undefined
        ): Promise<unknown> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            // a method that takes nothing is sent nothing, or an empty object
            await AuthControllerUtilities.validateBody(data ?? {}, instance.requestRegisterModel);
            return await this.twoFactorService.requestRegisterTwoFactorMethodForUser(user, instance, data);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.empty()
        @Post('/2fa/confirm')
        async confirmTwoFactorRegistration(
            @CurrentUser()
            user: BaseUser<string>,
            @Param.query('method', { type: 'string', required: twoFactorMethods.length > 1 })
            method: string | undefined,
            @bodyOf(twoFactorMethods.map(m => () => inject(m).confirmRegisterModel), true)
            data: object
        ): Promise<void> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            await AuthControllerUtilities.validateBody(data, instance.confirmRegisterModel);
            await this.twoFactorService.confirmRegisterTwoFactorMethodForUser(user, instance, data);
        }

        // with the factor itself rather than a recent login: a password alone must not take it away
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.require2fa()
        @Response.empty()
        @Delete('/2fa/:method')
        async removeTwoFactorMethod(
            @CurrentUser()
            user: BaseUser<string>,
            @Param.path('method')
            method: string
        ): Promise<void> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            await this.twoFactorService.unregisterTwoFactorMethodForUser(user, instance);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.empty({ mimeTypes: [MimeType.JSON] })
        @respondsWith(twoFactorMethods.map(m => () => inject(m).secondFactorStartModel))
        @Post('/2fa/start')
        async startSecondFactor(
            @CurrentUser()
            user: BaseUser<string>,
            @Param.query('method', { type: 'string', required: twoFactorMethods.length > 1 })
            method: string | undefined
        ): Promise<unknown> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            return await this.twoFactorService.startSecondFactor(user, instance);
        }

        private async completeSignIn(provider: string, answer: URLSearchParams): Promise<RedirectResponse> {
            try {
                const authenticatorClass: Newable<FederatedAuthenticator> = FederatedRouteUtilities.resolveAuthenticator(provider);
                const result: FederatedSignInResult = await inject(authenticatorClass).completeSignIn(answer);
                switch (result.type) {
                    case 'handover': {
                        if (result.strategy == undefined) {
                            return FederatedRouteUtilities.toRedirect(result.redirectTo, result.code);
                        }
                        const strategyClass: AuthControllerStrategyClass = AuthControllerUtilities
                            .resolveNamed(strategies, result.strategy, 'strategy');
                        // the code was minted for this browser a moment ago, and the cookie it is bound to
                        // is on this very request
                        await AuthControllerUtilities.runInTransaction(
                            strategyClass,
                            // eslint-disable-next-line typescript/no-unsafe-return
                            async transaction => await this.authService.login(
                                authenticatorClass,
                                strategyClass,
                                { code: result.code },
                                transaction
                            )
                        );
                        return FederatedRouteUtilities.toRedirect(result.redirectTo, undefined);
                    }
                    case 'registration': {
                        return FederatedRouteUtilities.toRegistration(result.ticket);
                    }
                    case 'reauthentication': {
                        return RedirectResponse.to(result.url);
                    }
                    case 'connected': {
                        return FederatedRouteUtilities.toConnection(result.userId, result.redirectTo);
                    }
                }
            }
            catch (error) {
                return FederatedRouteUtilities.toFailure(error);
            }
        }
    }

    const groups: RouteGroup[] = [
        { routes: ['csrfToken'], present: csrfStrategies.length > 0 },
        { routes: ['requestPasswordReset', 'verifyPasswordResetToken', 'confirmPasswordReset'], present: resetting.length > 0 },
        { routes: ['signInOptions'], present: challenging.length > 0 },
        { routes: ['registrationOptions', 'register'], present: signingUp.length > 0 },
        {
            routes: ['authorize', 'callback', 'formPostCallback', 'connectProvider', 'providerLogout', 'metadata'],
            present: federated.length > 0
        },
        { routes: ['startConnection'], present: connecting.length > 0 },
        { routes: ['completeConnection'], present: completing.length > 0 },
        { routes: ['findIdentities', 'unlinkIdentity'], present: linking.length > 0 },
        {
            routes: ['requestTwoFactorRegistration', 'confirmTwoFactorRegistration', 'removeTwoFactorMethod', 'startSecondFactor'],
            present: twoFactorMethods.length > 0
        }
    ];
    const omitted: (keyof Temp)[] = groups
        .filter(g => !g.present)
        .flatMap(g => g.routes)
        .filter((key): key is keyof Temp => key in Temp.prototype);

    // eslint-disable-next-line jsdoc/require-jsdoc
    class AuthControllerRoutes {}
    copyClassProperties(AuthControllerRoutes, Temp, omitted);
    // put together at runtime from the groups the classes call for, which the type works out from their
    // types the same way: nothing in between is something the compiler can follow
    return AuthControllerRoutes as AuthControllerClass<Strategies, Authenticators, Methods>;
}

/**
 * The classes with the given member on their prototype.
 * @param classes - The classes.
 * @param key - The member, a method a capability adds.
 * @returns Those that have it.
 */
function withMember<ClassType extends Newable<unknown>>(classes: ClassType[], key: string): ClassType[] {
    return classes.filter(c => AuthControllerUtilities.hasMember([c], key));
}

/**
 * The instance of a class, when it has a capability.
 * @param cls - The class.
 * @param isCapable - Whether an instance has the capability.
 * @returns The instance, or undefined when it does not have it.
 */
function resolveInstance<Capable>(cls: Newable<unknown>, isCapable: (value: unknown) => value is Capable): Capable | undefined {
    const instance: unknown = inject(cls);
    return isCapable(instance) ? instance : undefined;
}

/**
 * A model an instance of a class declares for a capability.
 * @param cls - The class.
 * @param isCapable - Whether an instance has the capability.
 * @param model - Reads the model from the capable instance.
 * @returns The model.
 * @throws When the instance does not have the capability, which the application refuses to start with.
 */
function resolveModel<Capable>(
    cls: Newable<unknown>,
    isCapable: (value: unknown) => value is Capable,
    model: (capable: Capable) => Newable<unknown>
): Newable<unknown> {
    const instance: Capable | undefined = resolveInstance(cls, isCapable);
    if (instance == undefined) {
        throw new InternalError(`${cls.name} does not declare the models of the routes of AuthController it was given to.`);
    }
    return model(instance);
}

/**
 * The strategy a sign-in at a provider logs in with on the redirect back from it.
 * @param strategies - The strategies of the controller.
 * @param name - The strategy the request names, if any.
 * @returns The name of the strategy.
 * @throws BadRequestError when the strategy cannot log in on a redirect, or none of them can.
 */
function resolveRedirectStrategy(strategies: AuthControllerStrategyClass[], name: string | undefined): string {
    const candidates: AuthControllerStrategyClass[] = name == undefined
        ? strategies.filter(s => inject(s).logsInWithResponse)
        : strategies;
    const strategy: AuthControllerStrategyClass | undefined = candidates.length
        ? AuthControllerUtilities.resolveNamed(candidates, name, 'strategy')
        : undefined;
    if (strategy == undefined || !inject(strategy).logsInWithResponse) {
        throw new BadRequestError(
            // eslint-disable-next-line stylistic/max-len
            $ts`Without a codeChallenge the sign-in logs in on the redirect back from the provider, which only a strategy whose login goes out with the response can do, such as cookies. Send a codeChallenge to have the login handed over by code.`
        );
    }
    return inject(strategy).name;
}

/**
 * Whether a value is a strategy that issues csrf tokens.
 * @param value - The value.
 * @returns True when it is.
 */
function isCsrfTokenStrategy(value: unknown): value is CsrfTokenAuthStrategy {
    return isAuthStrategy(value) && isCsrfTokenAuthStrategy(value);
}

/**
 * Declares a body that is one of the given models: the model itself when there is one.
 * @param models - The models, as functions answering them once the application has started.
 * @param required - Whether a request has to send a body.
 * @returns The decorator.
 */
function bodyOf(models: ModelResolver[], required: boolean): ParameterDecorator {
    if (!models.length) {
        // the route of a group the classes do not call for, which is left out of the controller
        return () => undefined;
    }
    const only: ModelResolver | undefined = models.length === 1 ? models[0] : undefined;
    if (only != undefined) {
        return Body(only, { required });
    }
    return Body.oneOf({ shapes: models.map(cls => ({ type: 'object', cls })), required });
}

/**
 * Declares a route that answers with one of the given models.
 * @param models - The models, as functions answering them once the application has started.
 * @returns The decorator.
 */
function respondsWith(models: OptionalModelResolver[]): MethodDecorator {
    return (target, propertyKey, descriptor) => {
        for (const model of models) {
            Response.object(model)(target, propertyKey, descriptor);
        }
    };
}