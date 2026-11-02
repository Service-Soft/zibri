import { AuthControllerAuthenticatorClass } from './auth-controller-authenticator-class.type';
import { AuthControllerClass } from './auth-controller-class.type';
import { AuthControllerOptions } from './auth-controller-options.model';
import { FEDERATED_ROUTE } from './auth-controller-routes.model';
import { AuthControllerStrategyClass } from './auth-controller-strategy-class.type';
import { AuthControllerUtilities } from './auth-controller.utilities';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { IsolationLevel } from '../../data-source/data-sources/data-source.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { ClassPropertyUtilities } from '../../entity/utilities/class-property.utilities';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { findHeader } from '../../http/find-header.function';
import { MimeType } from '../../http/mime-type.enum';
import { RedirectResponse } from '../../http/redirect-response.model';
import { $ts } from '../../localization/translate.function';
import { ResponseDecorator } from '../../open-api/decorators/response-decorator.type';
import { Response } from '../../open-api/decorators/response.decorator';
import { FileResponse } from '../../parsing/form-data/file-response.model';
import { HtmlResponse } from '../../parsing/html/html-response.model';
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
import { FederatedAuthenticatorInterface, isFederatedAuthenticator } from '../authenticators/federated/federated-authenticator.interface';
import { FederatedCallbackForm } from '../authenticators/federated/federated-callback-form.model';
import { FederatedLoginResult } from '../authenticators/federated/federated-login-result.model';
import { FederatedLogoutTokenForm } from '../authenticators/federated/federated-logout-token-form.model';
import { FederatedProviderLogoutMessage } from '../authenticators/federated/federated-provider-logout-message.model';
import { FederatedRouteUtilities } from '../authenticators/federated/federated-route.utilities';
import { isLinkIdentityConfirmingAuthenticator, LinkIdentityConfirmingAuthenticatorInterface } from '../authenticators/link-identity-confirming-authenticator.interface';
import { isLinkIdentityRequestingAuthenticator, LinkIdentityRequestingAuthenticatorInterface } from '../authenticators/link-identity-requesting-authenticator.interface';
import { LinkedIdentity } from '../authenticators/linked-identity.model';
import { isLoginOptionsAuthenticator, LoginOptionsAuthenticatorInterface } from '../authenticators/login-options-authenticator.interface';
import { ChangePasswordAtLoginInput } from '../authenticators/password/change-password-at-login-input.model';
import { ChangePasswordDto } from '../authenticators/password/change-password-data.model';
import { ConfirmPasswordResetDto } from '../authenticators/password/confirm-password-reset-data.model';
import { PasswordResetTokenInput } from '../authenticators/password/password-reset-token-input.model';
import { PasswordResetTokenValidity } from '../authenticators/password/password-reset-token-validity.model';
import { RequestPasswordResetInput } from '../authenticators/password/request-password-reset-input.model';
import { isRegistrationAuthenticator, RegistrationAuthenticatorInterface } from '../authenticators/registration-authenticator.interface';
import { Auth } from '../decorators/auth.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { type EmailVerificationServiceInterface } from '../email-verification/email-verification-service.interface';
import { EmailVerificationTokenInput } from '../email-verification/email-verification-token-input.model';
import { RequestEmailChangeInput } from '../email-verification/request-email-change-input.model';
import { type BaseUser } from '../models/base-user.model';
import { LogoutResult } from '../models/logout-result.model';
import { UserLogin } from '../models/user-login.model';
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
 * An authenticator whose identities a user links to their account.
 */
type LinkIdentityRequestingAuthenticator = LinkIdentityRequestingAuthenticatorInterface<
    string,
    BaseUser<string>,
    unknown,
    unknown,
    unknown,
    {
        /**
         * The id of the identity the link links.
         */
        id: string
    },
    unknown,
    unknown
>;

/**
 * An authenticator that confirms a link with an answer of the client.
 */
type LinkIdentityConfirmingAuthenticator = LinkIdentityConfirmingAuthenticatorInterface<string, BaseUser<string>, unknown, unknown>;

/**
 * An authenticator that logs users in at a provider.
 */
type FederatedAuthenticator = FederatedAuthenticatorInterface<string, BaseUser<string>>;

/**
 * An authenticator that hands out a challenge to log in with.
 */
type LoginOptionsAuthenticator = LoginOptionsAuthenticatorInterface<string, BaseUser<string>, unknown, unknown>;

/**
 * An authenticator that registers users by itself.
 */
type RegistrationAuthenticator = RegistrationAuthenticatorInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown>;

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
 * routes only some of them call for, such as resetting a password, logging in at a provider or
 * enrolling a second factor.
 *
 * The options name exactly what the application registers, which it checks while it starts. Leave out
 * a route with `OmitClass`, and write your own in its place.
 * @param options - The strategies, authenticators and two factor methods the routes are for.
 */
export function AuthController<
    Strategies extends AuthControllerStrategyClass[],
    Authenticators extends AuthControllerAuthenticatorClass[],
    Methods extends TwoFactorMethods,
    EmailVerification extends boolean = false
>(
    options: AuthControllerOptions<Strategies, Authenticators, Methods, EmailVerification>
): AuthControllerClass<Strategies, Authenticators, Methods, EmailVerification> {
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
    const challenging: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'resolveLoginOptions');
    const registering: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'confirmRegistration');
    const federated: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'confirmProviderLogin');
    const requestingLinks: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'requestLinkIdentity');
    const confirmingLinks: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'confirmLinkIdentity');
    const linking: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'findIdentities');
    const changing: AuthControllerAuthenticatorClass[] = withMember(authenticators, 'changePassword');
    const listing: AuthControllerStrategyClass[] = withMember(strategies, 'findLogins');

    // eslint-disable-next-line jsdoc/require-jsdoc
    class Temp {
        /**
         * What the routes were built from, which also marks the class as the auth controller.
         */
        static readonly authControllerOptions: AuthControllerOptions<Strategies, Authenticators, Methods, EmailVerification> = options;

        private get authService(): AuthServiceInterface {
            return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        }

        private get twoFactorService(): TwoFactorServiceInterface {
            return inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE);
        }

        private get emailVerificationService(): EmailVerificationServiceInterface {
            return inject(ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_SERVICE);
        }

        // the routes anyone may call without being anybody yet are unauthenticated by necessity: they
        // stay reachable whichever `defaultAuth` the application declared, and `allowRedundant` because
        // a controller the framework defines cannot know which one that was.
        //
        // They share one budget per caller: a password is the one secret short enough to guess, and
        // checking one costs a deliberately slow hash. A login that succeeds is given back, so the
        // budget counts guesses rather than people: an office behind one address logs in as often as
        // it likes, and still gets twenty wrong passwords across all its accounts before it waits
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER, { refundOnSuccess: true })
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
                // eslint-disable-next-line typescript/no-unsafe-return
                async transaction => await this.authService.login(authenticatorClass, strategyClass, credentials, transaction),
                { isolationLevel: IsolationLevel.READ_COMMITTED }
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
                // eslint-disable-next-line typescript/no-unsafe-return
                async transaction => await this.authService.refreshLogin(strategyClass, { ...data, transaction }),
                { isolationLevel: IsolationLevel.READ_COMMITTED }
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
                async transaction => await this.authService.logout(strategyClass, { ...data, transaction }),
                { isolationLevel: IsolationLevel.READ_COMMITTED }
            );
        }

        // every login of the user, the one asking included, such as after a device went missing
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.empty()
        @Post('/logout-everywhere')
        async logoutEverywhere(
            @CurrentUser()
            user: CurrentUser
        ): Promise<void> {
            await this.authService.endOwnLogins(user.id, undefined);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.array(UserLogin)
        @Get('/logins')
        async findLogins(
            @CurrentUser()
            user: CurrentUser
        ): Promise<UserLogin[]> {
            return await this.authService.findLogins(user.id, inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT), undefined);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.empty()
        @Delete('/logins/:loginId')
        async endLogin(
            @CurrentUser()
            user: CurrentUser,
            @Param.path('loginId')
            loginId: string
        ): Promise<void> {
            await this.authService.endLogin(user.id, loginId, undefined);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.empty()
        @Post('/request-email-verification')
        async requestEmailVerification(
            @CurrentUser()
            user: CurrentUser
        ): Promise<void> {
            await this.emailVerificationService.requestEmailVerification(user.id, undefined);
        }

        // by the link alone, which is followed in whatever browser opens the mail
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.empty()
        @Post('/confirm-email-verification')
        async confirmEmailVerification(
            @Body(EmailVerificationTokenInput)
            input: EmailVerificationTokenInput
        ): Promise<void> {
            await AuthControllerUtilities.runInTransaction(
                async transaction => await this.emailVerificationService.confirmEmailVerification(input.token, transaction)
            );
        }

        // with a second factor or a recent login, like linking an identity: the address is where a
        // password reset goes, so changing it is how a session somebody got hold of becomes the account
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.require2fa({ reauth: true })
        @Response.empty()
        @Post('/request-email-change')
        async requestEmailChange(
            @CurrentUser()
            user: CurrentUser,
            @Body(RequestEmailChangeInput)
            input: RequestEmailChangeInput
        ): Promise<void> {
            await this.emailVerificationService.requestEmailChange(user.id, input.newEmail, undefined);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.empty()
        @Post('/confirm-email-change')
        async confirmEmailChange(
            @Body(EmailVerificationTokenInput)
            input: EmailVerificationTokenInput
        ): Promise<void> {
            await AuthControllerUtilities.runInTransaction(
                async transaction => await this.emailVerificationService.confirmEmailChange(input.token, transaction)
            );
        }

        // on the login's budget, and counted against the account like a wrong password at a login: a
        // session somebody else got hold of is otherwise a place to guess the password at
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER, { refundOnSuccess: true })
        @Response.empty()
        @Post('/change-password')
        async changePassword(
            @CurrentUser()
            user: CurrentUser,
            @Body(ChangePasswordDto)
            data: ChangePasswordDto
        ): Promise<void> {
            await AuthControllerUtilities.runInTransaction(
                async transaction => await this.authService.changePassword(
                    user.id,
                    { ...data, transaction },
                    inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT)
                )
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
            // an address nobody has registered gets the same answer as one somebody has, in what it
            // says and in how long it takes. This route is unauthenticated, so anything that
            // distinguishes the two turns it into a list of who holds an account here
            await this.authService.requestPasswordResetForEmail(data.email);
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
            await AuthControllerUtilities.runInTransaction(
                async transaction => await this.authService.confirmPasswordReset({ ...data, transaction }),
                { isolationLevel: IsolationLevel.READ_COMMITTED }
            );
        }

        // every route anyone may call that stores a challenge shares the login's budget
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @respondsWith(challenging.map(a => () => resolveInstance(a, isLoginOptionsAuthenticator)?.loginOptionsModel))
        @Post('/login-options')
        async loginOptions(
            @Param.query('authenticator', { type: 'string', required: challenging.length > 1 })
            authenticator: string | undefined
        ): Promise<unknown> {
            const authenticatorClass: Newable<LoginOptionsAuthenticator> = AuthControllerUtilities
                .resolveCapable(challenging, authenticator, 'authenticator', isLoginOptionsAuthenticator);
            return await inject(authenticatorClass).resolveLoginOptions();
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @respondsWith(registering.map(a => () => resolveInstance(a, isRegistrationAuthenticator)?.registrationOptionsModel))
        @Post('/registration/request')
        async requestRegistration(
            @Param.query('authenticator', { type: 'string', required: registering.length > 1 })
            authenticator: string | undefined,
            @bodyOf(registering.map(a => () => resolveModel(a, isRegistrationAuthenticator, r => r.registrationRequestModel)), true)
            request: object
        ): Promise<unknown> {
            const instance: RegistrationAuthenticator = inject(AuthControllerUtilities
                .resolveCapable(registering, authenticator, 'authenticator', isRegistrationAuthenticator));
            await AuthControllerUtilities.validateBody(request, instance.registrationRequestModel);
            return await instance.requestRegistration(request);
        }

        // answers with the ticket the application's own registration route creates the user with
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @respondsWith(registering.map(a => () => resolveInstance(a, isRegistrationAuthenticator)?.ticketModel))
        @Post('/registration/confirm')
        async confirmRegistration(
            @Param.query('authenticator', { type: 'string', required: registering.length > 1 })
            authenticator: string | undefined,
            @bodyOf(registering.map(a => () => resolveModel(a, isRegistrationAuthenticator, r => r.registrationAnswerModel)), true)
            answer: object
        ): Promise<unknown> {
            const instance: RegistrationAuthenticator = inject(AuthControllerUtilities
                .resolveCapable(registering, authenticator, 'authenticator', isRegistrationAuthenticator));
            await AuthControllerUtilities.validateBody(answer, instance.registrationAnswerModel);
            return await instance.confirmRegistration(answer);
        }

        // the frontend sends the browser here, and the login either completes on the redirect back or
        // hands the login over by code.
        //
        // With the challenge of a PKCE verifier the frontend keeps, the browser lands on redirectTo
        // with a one-time code only that verifier can take at the login route, so a code that ends up
        // in somebody else's hands logs nobody in. That works for every strategy.
        //
        // Without one, the callback starts the login itself. That only works for a strategy whose login
        // goes out with the response, as cookies do: the callback answers with a redirect, which has no
        // body a frontend could read tokens from, and tokens in the url end up in history, logs and
        // Referer headers. A login for any other strategy is refused here, before the user logs in
        // at the provider for nothing
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.redirect()
        @Get(`${FEDERATED_ROUTE}/login/request`)
        async requestProviderLogin(
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
            const url: string = await inject(authenticatorClass).requestProviderLogin({
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
            return await this.confirmProviderLogin(provider, FederatedRouteUtilities.resolveCallbackQuery());
        }

        // where a provider that answers with a form post has the browser post its answer. Another site's
        // page sends it, so it is let through with cookies - from that provider's login page only
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
            return await this.confirmProviderLogin(provider, FederatedRouteUtilities.toCallbackParams(form));
        }

        // where the frontend sends the browser to link a provider to an account, with the url the
        // link-identity/request route answered with. The browser is tied to the link here and goes on
        // to the provider
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.redirect()
        @Get(`${FEDERATED_ROUTE}/:provider/link-identity`)
        async continueLinkIdentity(
            @Param.path('provider')
            provider: string,
            @Param.query('code')
            code: string
        ): Promise<RedirectResponse> {
            return await FederatedRouteUtilities.resolveLinkIdentityRedirect(provider, code);
        }

        // where a provider sends the browser to say the user logged out there, or that it ended its
        // session after a logout here
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.redirect()
        @Response.html()
        @Get(`${FEDERATED_ROUTE}/:provider/logout`)
        async providerLogout(
            @Param.path('provider')
            provider: string
        ): Promise<RedirectResponse | HtmlResponse> {
            return await FederatedRouteUtilities.completeProviderLogout(provider, FederatedRouteUtilities.resolveRedirectedLogout());
        }

        // the same, for a provider whose page posts it. Another site's page sends it, so it is let
        // through with cookies - from that provider's pages only
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @AcceptCrossSitePosts({ acceptedOrigins: async params => await FederatedRouteUtilities.resolveFormPostOrigins(params) })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.redirect()
        @Response.html()
        @Post(`${FEDERATED_ROUTE}/:provider/logout`)
        async postedProviderLogout(
            @Param.path('provider')
            provider: string,
            @Body(FederatedCallbackForm, { type: MimeType.FORM_URL_ENCODED, allowAdditionalProperties: true })
            form: FederatedCallbackForm
        ): Promise<RedirectResponse | HtmlResponse> {
            const message: FederatedProviderLogoutMessage = { binding: 'post', form: FederatedRouteUtilities.toCallbackParams(form) };
            return await FederatedRouteUtilities.completeProviderLogout(provider, message);
        }

        // where a provider sends a logout request server to server, without a browser
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.file()
        @Post(`${FEDERATED_ROUTE}/:provider/logout/soap`)
        async soapProviderLogout(
            @Param.path('provider')
            provider: string,
            @Body({ type: MimeType.XML, raw: true })
            envelope: string
        ): Promise<FileResponse> {
            return await FederatedRouteUtilities.completeSoapLogout(provider, envelope);
        }

        // where an OpenID Connect provider sends a logout token server to server, without a browser
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER)
        @Response.empty()
        @Post(`${FEDERATED_ROUTE}/:provider/logout/back-channel`)
        async backChannelProviderLogout(
            @Param.path('provider')
            provider: string,
            @Body(FederatedLogoutTokenForm, { type: MimeType.FORM_URL_ENCODED })
            form: FederatedLogoutTokenForm
        ): Promise<void> {
            await FederatedRouteUtilities.completeBackChannelLogout(provider, form.logout_token);
        }

        // the document the provider is set up with, for a provider whose protocol publishes one
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @Response.file()
        @Get(`${FEDERATED_ROUTE}/:provider/metadata`)
        async metadata(
            @Param.path('provider')
            provider: string
        ): Promise<FileResponse> {
            return await FederatedRouteUtilities.toMetadata(provider);
        }

        // guarded the way changing a password is: an identity is a way into the account
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.require2fa({ reauth: true })
        @respondsWith(requestingLinks.map(a => () => resolveInstance(a, isLinkIdentityRequestingAuthenticator)?.linkIdentityStartModel))
        @Post('/link-identity/request')
        async requestLinkIdentity(
            @Param.query('authenticator', { type: 'string', required: requestingLinks.length > 1 })
            authenticator: string | undefined,
            @bodyOf(
                requestingLinks.map(a => () => resolveModel(a, isLinkIdentityRequestingAuthenticator, l => l.linkIdentityRequestModel)),
                true
            )
            request: object
        ): Promise<unknown> {
            const authenticatorClass: Newable<LinkIdentityRequestingAuthenticator> = AuthControllerUtilities
                .resolveCapable(requestingLinks, authenticator, 'authenticator', isLinkIdentityRequestingAuthenticator);
            await AuthControllerUtilities.validateBody(request, inject(authenticatorClass).linkIdentityRequestModel);
            return await this.authService.requestLinkIdentity(authenticatorClass, request);
        }

        // confirms a link the link-identity/request route requested, for the same user
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.empty()
        @Post('/link-identity/confirm')
        async confirmLinkIdentity(
            @Param.query('authenticator', { type: 'string', required: confirmingLinks.length > 1 })
            authenticator: string | undefined,
            @bodyOf(
                confirmingLinks.map(a => () => resolveModel(a, isLinkIdentityConfirmingAuthenticator, l => l.linkIdentityAnswerModel)),
                true
            )
            answer: object
        ): Promise<void> {
            const authenticatorClass: Newable<LinkIdentityConfirmingAuthenticator> = AuthControllerUtilities
                .resolveCapable(confirmingLinks, authenticator, 'authenticator', isLinkIdentityConfirmingAuthenticator);
            await AuthControllerUtilities.validateBody(answer, inject(authenticatorClass).linkIdentityAnswerModel);
            await this.authService.confirmLinkIdentity(authenticatorClass, answer);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.array(LinkedIdentity)
        @Get('/identities')
        async findIdentities(
            @CurrentUser()
            user: CurrentUser
        ): Promise<LinkedIdentity[]> {
            return await this.authService.findIdentities(user.id, undefined);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.require2fa({ reauth: true })
        @Response.empty()
        @Delete('/identities/:identityId')
        async unlinkIdentity(
            @CurrentUser()
            user: CurrentUser,
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
        @respondsWith(twoFactorMethods.map(m => () => inject(m).registrationRequestResultModel))
        @Post('/2fa/registration/request')
        async requestTwoFactorRegistration(
            @CurrentUser()
            user: CurrentUser,
            @Param.query('method', { type: 'string', required: twoFactorMethods.length > 1 })
            method: string | undefined,
            @bodyOf(twoFactorMethods.map(m => () => inject(m).registrationRequestModel), false)
            data: object | undefined
        ): Promise<unknown> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            // a method that takes nothing is sent nothing, or an empty object
            await AuthControllerUtilities.validateBody(data ?? {}, instance.registrationRequestModel);
            return await this.twoFactorService.requestTwoFactorRegistration(user, instance, data);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.empty()
        @Post('/2fa/registration/confirm')
        async confirmTwoFactorRegistration(
            @CurrentUser()
            user: CurrentUser,
            @Param.query('method', { type: 'string', required: twoFactorMethods.length > 1 })
            method: string | undefined,
            @bodyOf(twoFactorMethods.map(m => () => inject(m).registrationConfirmModel), true)
            data: object
        ): Promise<void> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            await AuthControllerUtilities.validateBody(data, instance.registrationConfirmModel);
            await this.twoFactorService.confirmTwoFactorRegistration(user, instance, data);
        }

        // with the factor itself rather than a recent login: a password alone must not take it away
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.require2fa()
        @Response.empty()
        @Delete('/2fa/registration/:method')
        async removeTwoFactorRegistration(
            @CurrentUser()
            user: CurrentUser,
            @Param.path('method')
            method: string
        ): Promise<void> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            await this.twoFactorService.removeTwoFactorRegistration(user, instance);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.isLoggedIn()
        @Response.empty({ mimeTypes: [MimeType.JSON] })
        @respondsWith(twoFactorMethods.map(m => () => inject(m).secondFactorRequestModel))
        @Post('/2fa/request')
        async requestSecondFactor(
            @CurrentUser()
            user: CurrentUser,
            @Param.query('method', { type: 'string', required: twoFactorMethods.length > 1 })
            method: string | undefined
        ): Promise<unknown> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            return await this.twoFactorService.requestSecondFactor(user, instance);
        }

        // the routes a login that waits for its second factor continues at, each reached with the
        // ticket the login answered with. Unauthenticated by necessity, like the login itself
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @Response.empty({ mimeTypes: [MimeType.JSON] })
        @respondsWith(twoFactorMethods.map(m => () => inject(m).secondFactorRequestModel))
        @Post('/login/2fa/request')
        async requestSecondFactorAtLogin(
            @Param.query('method', { type: 'string', required: twoFactorMethods.length > 1 })
            method: string | undefined
        ): Promise<unknown> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            return await this.authService.requestSecondFactorAtLogin(this.resolveLoginTicket(), instance);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @Response.empty({ mimeTypes: [MimeType.JSON] })
        @respondsWith(twoFactorMethods.map(m => () => inject(m).registrationRequestResultModel))
        @Post('/login/2fa/registration/request')
        async requestTwoFactorRegistrationAtLogin(
            @Param.query('method', { type: 'string', required: twoFactorMethods.length > 1 })
            method: string | undefined,
            @bodyOf(twoFactorMethods.map(m => () => inject(m).registrationRequestModel), false)
            data: object | undefined
        ): Promise<unknown> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            await AuthControllerUtilities.validateBody(data ?? {}, instance.registrationRequestModel);
            return await this.authService.requestTwoFactorRegistrationAtLogin(this.resolveLoginTicket(), instance, data);
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @Response.empty()
        @Post('/login/2fa/registration/confirm')
        async confirmTwoFactorRegistrationAtLogin(
            @Param.query('method', { type: 'string', required: twoFactorMethods.length > 1 })
            method: string | undefined,
            @bodyOf(twoFactorMethods.map(m => () => inject(m).registrationConfirmModel), true)
            data: object
        ): Promise<void> {
            const instance: AnyTwoFactorMethod = inject(AuthControllerUtilities.resolveNamed(twoFactorMethods, method, 'method'));
            await AuthControllerUtilities.validateBody(data, instance.registrationConfirmModel);
            await this.authService.confirmTwoFactorRegistrationAtLogin(this.resolveLoginTicket(), instance, data);
        }

        // on the login's budget: a factor is guessed at here, with a ticket a password already paid for
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER, { refundOnSuccess: true })
        @respondsWith(strategies.map(s => () => inject(s).authDataModel))
        @Post('/login/2fa/confirm')
        async confirmSecondFactorAtLogin(
            @Param.query('strategy', { type: 'string', required: strategies.length > 1 })
            strategy: string | undefined
        ): Promise<unknown> {
            const strategyClass: AuthControllerStrategyClass = AuthControllerUtilities.resolveNamed(strategies, strategy, 'strategy');
            const ticket: string = this.resolveLoginTicket();
            return await AuthControllerUtilities.runInTransaction(
                // eslint-disable-next-line typescript/no-unsafe-return
                async transaction => await this.authService.confirmSecondFactorAtLogin(ticket, strategyClass, transaction),
                { isolationLevel: IsolationLevel.READ_COMMITTED }
            );
        }

        // where a login waiting for a new password continues, with the ticket it answered with. On the
        // login's budget, like the second factor: the ticket stands in for a password already checked
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Auth.skip({ allowRedundant: true })
        @RateLimited(ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER, { refundOnSuccess: true })
        @respondsWith(strategies.map(s => () => inject(s).authDataModel))
        @Post('/login/change-password')
        async changePasswordAtLogin(
            @Param.query('strategy', { type: 'string', required: strategies.length > 1 })
            strategy: string | undefined,
            @Body(ChangePasswordAtLoginInput)
            input: ChangePasswordAtLoginInput
        ): Promise<unknown> {
            const strategyClass: AuthControllerStrategyClass = AuthControllerUtilities.resolveNamed(strategies, strategy, 'strategy');
            const ticket: string = this.resolveLoginTicket();
            return await AuthControllerUtilities.runInTransaction(
                // eslint-disable-next-line typescript/no-unsafe-return
                async transaction => await this.authService.changePasswordAtLogin(ticket, input.newPassword, strategyClass, transaction),
                { isolationLevel: IsolationLevel.READ_COMMITTED }
            );
        }

        private async confirmProviderLogin(provider: string, answer: URLSearchParams): Promise<RedirectResponse> {
            try {
                const authenticatorClass: Newable<FederatedAuthenticator> = FederatedRouteUtilities.resolveAuthenticator(provider);
                const result: FederatedLoginResult = await inject(authenticatorClass).confirmProviderLogin(answer);
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
                            // eslint-disable-next-line typescript/no-unsafe-return
                            async transaction => await this.authService.login(
                                authenticatorClass,
                                strategyClass,
                                { code: result.code },
                                transaction
                            ),
                            { isolationLevel: IsolationLevel.READ_COMMITTED }
                        );
                        return FederatedRouteUtilities.toRedirect(result.redirectTo, undefined);
                    }
                    case 'registration': {
                        return FederatedRouteUtilities.toRegistration(result.ticket);
                    }
                    case 'reauthentication': {
                        return RedirectResponse.to(result.url);
                    }
                    case 'linked': {
                        return FederatedRouteUtilities.toLinkedIdentity(result.userId, result.redirectTo);
                    }
                }
            }
            catch (error) {
                return FederatedRouteUtilities.toFailure(error);
            }
        }

        // read from the request rather than declared as a header parameter: the header's name is a
        // token so that it can be renamed, and a decorator runs before any token is registered
        private resolveLoginTicket(): string {
            const header: string = inject(ZIBRI_DI_TOKENS.LOGIN_TICKET_HEADER);
            const ticket: string | undefined = findHeader(AlsUtilities.getCurrentRequestContext()?.request.headers, header);
            if (!ticket) {
                throw new UnauthorizedError($ts`"${header}" header not found`);
            }
            return ticket;
        }
    }

    const groups: RouteGroup[] = [
        { routes: ['csrfToken'], present: csrfStrategies.length > 0 },
        { routes: ['requestPasswordReset', 'verifyPasswordResetToken', 'confirmPasswordReset'], present: resetting.length > 0 },
        { routes: ['changePassword', 'changePasswordAtLogin'], present: changing.length > 0 },
        {
            routes: ['requestEmailVerification', 'confirmEmailVerification', 'requestEmailChange', 'confirmEmailChange'],
            present: options.emailVerification === true
        },
        { routes: ['findLogins', 'endLogin'], present: listing.length > 0 },
        { routes: ['loginOptions'], present: challenging.length > 0 },
        { routes: ['requestRegistration', 'confirmRegistration'], present: registering.length > 0 },
        {
            routes: [
                'requestProviderLogin',
                'callback',
                'formPostCallback',
                'continueLinkIdentity',
                'providerLogout',
                'postedProviderLogout',
                'soapProviderLogout',
                'backChannelProviderLogout',
                'metadata'
            ],
            present: federated.length > 0
        },
        { routes: ['requestLinkIdentity'], present: requestingLinks.length > 0 },
        { routes: ['confirmLinkIdentity'], present: confirmingLinks.length > 0 },
        { routes: ['findIdentities', 'unlinkIdentity'], present: linking.length > 0 },
        {
            routes: [
                'requestTwoFactorRegistration',
                'confirmTwoFactorRegistration',
                'removeTwoFactorRegistration',
                'requestSecondFactor',
                'requestSecondFactorAtLogin',
                'requestTwoFactorRegistrationAtLogin',
                'confirmTwoFactorRegistrationAtLogin',
                'confirmSecondFactorAtLogin'
            ],
            present: twoFactorMethods.length > 0
        }
    ];
    const omitted: (keyof Temp)[] = groups
        .filter(g => !g.present)
        .flatMap(g => g.routes)
        .filter((key): key is keyof Temp => key in Temp.prototype);

    // eslint-disable-next-line jsdoc/require-jsdoc
    class AuthControllerRoutes {}
    ClassPropertyUtilities.copy(AuthControllerRoutes, Temp, omitted);
    // put together at runtime from the groups the classes call for, which the type works out from their
    // types the same way: nothing in between is something the compiler can follow
    return AuthControllerRoutes as AuthControllerClass<Strategies, Authenticators, Methods, EmailVerification>;
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
 * The strategy a login at a provider logs in with on the redirect back from it.
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
            $ts`Without a codeChallenge the user is logged in on the redirect back from the provider, which only a strategy whose login goes out with the response can do, such as cookies. Send a codeChallenge to have the login handed over by code.`
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
    return only != undefined ? Body(only, { required }) : Body.oneOf({ shapes: models.map(cls => ({ type: 'object', cls })), required });
}

/**
 * Declares a route that answers with one of the given models.
 * @param models - The models, as functions answering them once the application has started.
 * @returns The decorator.
 */
function respondsWith(models: OptionalModelResolver[]): ResponseDecorator<unknown> {
    return (target, propertyKey, descriptor) => {
        for (const model of models) {
            Response.object(model)(target, propertyKey, descriptor);
        }
    };
}