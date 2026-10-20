import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { FederatedAnswerContext } from './federated-answer-context.model.ts';
import { FederatedAuthenticatorInterface, isFederatedAuthenticator } from './federated-authenticator.interface.ts';
import { FederatedCleanupCronJob } from './federated-cleanup.cron-job.ts';
import { FederatedConnectionCode, FederatedConnectionCodeCreateData } from './federated-connection-code.model.ts';
import { FederatedConnectionRequest } from './federated-connection-request.model.ts';
import { FederatedConnectionStart } from './federated-connection-start.model.ts';
import { FederatedCredentials, FederatedHandoverCredentials, FederatedTicketCredentials } from './federated-credentials.model.ts';
import { FederatedHandoverCode, FederatedHandoverCodeCreateData } from './federated-handover-code.model.ts';
import { FederatedIdentity, FederatedIdentityCreateData } from './federated-identity.model.ts';
import { FederatedLoginAttempt, FederatedLoginAttemptCreateData } from './federated-login-attempt.model.ts';
import { FederatedMetadata } from './federated-metadata.model.ts';
import { FederatedProviderIdentity } from './federated-provider-identity.model.ts';
import { FederatedProviderLogoutMessage } from './federated-provider-logout-message.model.ts';
import { FederatedProviderLogout } from './federated-provider-logout.model.ts';
import { FederatedProviderSession } from './federated-provider-session.model.ts';
import { FederatedReauthentication } from './federated-reauthentication.model.ts';
import { FederatedRegistrationTicket, FederatedRegistrationTicketCreateData } from './federated-registration-ticket.model.ts';
import { FederatedRegistration } from './federated-registration.model.ts';
import { FederatedRouteEndpoint } from './federated-route-endpoint.model.ts';
import { FederatedRoute } from './federated-route.type.ts';
import { FederatedSessionMatch } from './federated-session-match.model.ts';
import { FederatedSession } from './federated-session.model.ts';
import { FederatedSignInAction } from './federated-sign-in-action.type.ts';
import { FederatedSignInFailure } from './federated-sign-in-failure.enum.ts';
import { FederatedSignInRequest } from './federated-sign-in-request.model.ts';
import { FederatedSignInResult } from './federated-sign-in-result.model.ts';
import { FederatedSignInStart } from './federated-sign-in-start.model.ts';
import { FederatedSignInError } from './federated-sign-in.error.ts';
import { FederatedSignIn } from './federated-sign-in.model.ts';
import { FederatedSoapLogout } from './federated-soap-logout.model.ts';
import { FederationOptions } from './federation-options.model.ts';
import { ProviderTokenGrant } from './provider-token-grant.model.ts';
import { ZibriApplication } from '../../../application/application.ts';
import { HttpRequestContext } from '../../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../../context/request/websocket-request.context.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { Transaction } from '../../../data-source/transaction/transaction.model.ts';
import { UniqueConstraintViolationError } from '../../../data-source/unique-constraint-violation.error.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { NoProviderError } from '../../../di/errors/no-provider.error.ts';
import { inject } from '../../../di/inject.function.ts';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error.ts';
import { NotFoundError } from '../../../error-handling/errors/not-found.error.ts';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { HttpMethod } from '../../../http/http-method.enum.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { AuditAction } from '../../../logging/audit-event.model.ts';
import { ControllerUtilities } from '../../../routing/controller.utilities.ts';
import { Newable } from '../../../types/newable.type.ts';
import { validateEntitiesRegistered } from '../../../utilities/validate-entities-registered.function.ts';
import { FEDERATED_ROUTE } from '../../auth-controller/auth-controller-routes.model.ts';
import { isAuthControllerClass } from '../../auth-controller/is-auth-controller-class.function.ts';
import { type HashServiceInterface } from '../../hash/hash-service.interface.ts';
import type { HashString } from '../../hash/hash.utilities.ts';
import { Sha256HashStrategy } from '../../hash/strategies/sha256.hash-strategy.ts';
import { Authentication } from '../../models/authentication.model.ts';
import { BaseUser } from '../../models/base-user.model.ts';
import { type UserServiceInterface } from '../../user/user-service.interface.ts';
import { AuthControllerAuthenticatorInterface } from '../auth-controller-authenticator.interface.ts';
import { ConnectingAuthenticatorInterface } from '../connecting-authenticator.interface.ts';

/**
 * The options with every default filled in.
 */
export type ResolvedFederationOptions = Required<Omit<FederationOptions, 'signedOutUrl'>> & Pick<FederationOptions, 'signedOutUrl'>;

/**
 * What a handover code or a registration ticket is spent with: the cookie of the browser the
 * sign-in was started in, or the verifier of the frontend's PKCE challenge.
 */
type FederatedGrantProof = {
    /**
     * The hash of the cookie's secret, when the cookie is the proof.
     */
    binding: HashString | undefined | null,
    /**
     * The name of the cookie, when the cookie is the proof.
     */
    bindingCookie: string | undefined | null,
    /**
     * The PKCE challenge, when the verifier is the proof.
     */
    codeChallenge: string | undefined | null
};

/**
 * What a handover code or a registration ticket is created with to be spent with, before the cookie's
 * secret is hashed.
 */
type FederatedGrantProofData = Pick<FederatedHandoverCodeCreateData, 'binding' | 'bindingCookie' | 'codeChallenge'>;

/**
 * What a handover code or a registration ticket keeps of the session at the provider.
 */
type FederatedSessionData = Pick<FederatedHandoverCodeCreateData, 'subjectKey' | 'sessionKey' | 'sessionLogout'>;

/**
 * What the cookie a sign-in is tied to the browser with is named, followed by the attempt's id.
 */
const BINDING_COOKIE_PREFIX: string = 'zibri-federated-';

/**
 * A PKCE challenge as S256 makes it: a sha256, in base64url without padding.
 */
const CODE_CHALLENGE_PATTERN: RegExp = /^[\w-]{43}$/;

/**
 * What a provider's name has to look like, since it is part of the urls of its routes.
 */
const PROVIDER_NAME_PATTERN: RegExp = /^[\da-z-]+$/;

/**
 * Authenticates a user by a sign-in at a provider: the browser is sent there, and comes back with an
 * answer the provider proves who signed in with.
 *
 * What every protocol shares: the sign-in tied to the browser it was started in and taken once, the
 * identities linked to users, the ticket a first sign-in continues with at the registration, the code
 * a login is handed over with, and connecting a provider to an account. Extend `BaseOAuthAuthenticator`
 * for OAuth and OpenID Connect, or `BaseSamlAuthenticator` for SAML. The sign-in itself runs through the
 * routes of `AuthController`, or routes of your own that `resolveRouteUrl` names.
 */
export abstract class BaseFederatedAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> implements FederatedAuthenticatorInterface<RoleType, UserType>,
    ConnectingAuthenticatorInterface<
        RoleType,
        UserType,
        FederatedCredentials,
        FederatedTicketCredentials,
        FederatedRegistration,
        FederatedIdentity,
        FederatedConnectionRequest,
        FederatedConnectionStart
    >,
    AuthControllerAuthenticatorInterface<RoleType, UserType, FederatedCredentials> {
    /**
     * The name of the provider, which its routes are reached under. Lowercase letters, digits and dashes.
     */
    abstract readonly name: string;

    /**
     * The issuer the provider's identities are known by, eg. `https://accounts.google.com`.
     */
    abstract readonly issuer: string;

    /**
     * The scopes of the provider's apis a sign-in or a connection may ask for, whose tokens are then
     * kept for calling those apis. None by default.
     */
    readonly apiScopes: string[] = [];

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    get routes(): FederatedRouteEndpoint[] {
        return [
            { route: 'callback', method: this.answersWithFormPost() ? HttpMethod.POST : HttpMethod.GET },
            { route: 'connect', method: HttpMethod.GET }
        ];
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly credentialsModel: Newable<FederatedCredentials> = FederatedHandoverCredentials;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly connectionRequestModel: Newable<FederatedConnectionRequest> = FederatedConnectionRequest;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly connectionStartModel: Newable<FederatedConnectionStart> = FederatedConnectionStart;

    // the declared controller the provider sends the browser back to, found while the application starts
    private routesController: Newable<unknown> | undefined;

    // read when used rather than injected: an application extends this class, and a constructor it
    // has to pass through would be one more thing to get wrong in every provider
    private get attemptRepository(): Repository<FederatedLoginAttempt, FederatedLoginAttemptCreateData> {
        return inject(repositoryTokenFor(FederatedLoginAttempt));
    }

    private get handoverCodeRepository(): Repository<FederatedHandoverCode, FederatedHandoverCodeCreateData> {
        return inject(repositoryTokenFor(FederatedHandoverCode));
    }

    private get registrationTicketRepository(): Repository<FederatedRegistrationTicket, FederatedRegistrationTicketCreateData> {
        return inject(repositoryTokenFor(FederatedRegistrationTicket));
    }

    private get connectionCodeRepository(): Repository<FederatedConnectionCode, FederatedConnectionCodeCreateData> {
        return inject(repositoryTokenFor(FederatedConnectionCode));
    }

    private get hashService(): HashServiceInterface {
        return inject(ZIBRI_DI_TOKENS.HASH_SERVICE);
    }

    private get userService(): UserServiceInterface {
        return inject(ZIBRI_DI_TOKENS.USER_SERVICE);
    }

    /**
     * Where the identities linked to users are kept.
     * @returns The repository.
     */
    protected get identityRepository(): Repository<FederatedIdentity, FederatedIdentityCreateData> {
        return inject(repositoryTokenFor(FederatedIdentity));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    init(app: ZibriApplication): void {
        validateEntitiesRegistered(
            this.constructor.name,
            app,
            FederatedLoginAttempt,
            FederatedIdentity,
            FederatedHandoverCode,
            FederatedRegistrationTicket,
            FederatedConnectionCode
        );
        this.resolveOptions();
        this.validateName(app);
        // the provider is sent to the routes of the auth controller the application declares, at its
        // path. None is no mistake yet: a subclass resolving urls of its own needs none, and the
        // application checks every url while it starts
        this.routesController = app.options.controllers.find(isAuthControllerClass);
        if (!app.options.cronJobs.includes(FederatedCleanupCronJob)) {
            app.options.cronJobs.push(FederatedCleanupCronJob);
        }
    }

    /**
     * The url the provider sends the browser back to, which has to be registered there exactly like this.
     * @returns The url `resolveRouteUrl` resolves for the `callback` route.
     * @throws When the application has not been started yet, or declares no auth controller.
     */
    getCallbackUrl(): string {
        return this.resolveRouteUrl('callback');
    }

    /**
     * The url of one of the provider's routes: the application's `baseUrl`, followed by the path of
     * the auth controller and `/federated/{name}/{route}`, eg. `/auth/federated/{name}/callback`.
     *
     * Override it to serve the routes from controllers of your own, and override `routes` to name the
     * ones those serve.
     * @param route - The route.
     * @returns The url.
     * @throws When the application has not been started yet, or declares no controller defined by
     * `AuthController`.
     */
    resolveRouteUrl(route: FederatedRoute): string {
        if (this.routesController == undefined) {
            throw new InternalError([
                `${this.constructor.name} gives out the urls of its routes ${this.routes.map(r => r.route).join(', ')}, and found no`,
                'controller defined by AuthController to serve them while the application started.',
                'Declare one, or override resolveRouteUrl to name routes of your own.'
            ]);
        }
        return `${ControllerUtilities.resolveUrl(this.routesController)}${FEDERATED_ROUTE}/${this.name}/${route}`;
    }

    /**
     * Starts a sign-in at the provider.
     *
     * Ties the sign-in to the browser with a cookie, so it can only be completed there.
     * @param request - Where the sign-in goes afterwards, how it is handed over, and which scopes of the
     * provider's apis it asks for.
     * @returns The url at the provider to send the browser to.
     * @throws When `redirectTo` is not allowed, the challenge is not one S256 makes, or a scope is not
     * one of the `apiScopes`.
     */
    async startSignIn(request: FederatedSignInRequest): Promise<string> {
        const options: ResolvedFederationOptions = this.resolveOptions();
        this.validateRedirect(request.redirectTo, options.allowedRedirects);
        if (request.codeChallenge != undefined && !CODE_CHALLENGE_PATTERN.test(request.codeChallenge)) {
            throw new BadRequestError($ts`The code challenge has to be the S256 challenge of a PKCE verifier.`);
        }
        // the scopes of a sign-in come from its url, which anyone can make up and send a user
        const notAllowed: string[] = this.findScopesNotAllowed(request.apiScopes);
        if (notAllowed.length) {
            throw new BadRequestError($ts`The scopes ${notAllowed.join(', ')} cannot be asked for.`);
        }
        return await this.startAttempt(request, undefined, true, options);
    }

    /**
     * Starts connecting the provider to the account of a user: so that a sign-in through it logs in as
     * them from then on, so that its apis can be called for them, or both.
     * `AuthServiceInterface.startConnection` calls it for the user logged in with the request.
     *
     * Answers with the url of the `connect` route `resolveRouteUrl` resolves. The browser goes on to
     * the provider from there, the user signs in,
     * and the browser lands on `redirectTo` once the identity is linked.
     * @param userId - The user the provider is connected to.
     * @param connection - Where the browser goes once the provider is connected, whether the identity
     * signs in, and the scopes of the provider's apis to keep tokens for.
     * @returns The url to send the browser to, which is good once and for a short time.
     * @throws BadRequestError when `redirectTo` is not allowed, a scope is not one of the `apiScopes`,
     * or the connection is for neither signing in nor any scope.
     */
    async startConnection(userId: string, connection: FederatedConnectionRequest): Promise<FederatedConnectionStart> {
        const options: ResolvedFederationOptions = this.resolveOptions();
        this.validateRedirect(connection.redirectTo, options.allowedRedirects);
        const apiScopes: string[] = connection.scopes ?? [];
        // the client names these when it calls the connect route of AuthController, so a wrong one is
        // refused like a scope in the url of a sign-in
        const notAllowed: string[] = this.findScopesNotAllowed(apiScopes);
        if (notAllowed.length) {
            throw new BadRequestError($ts`The scopes ${notAllowed.join(', ')} cannot be asked for.`);
        }
        if (!connection.signIn && !apiScopes.length) {
            throw new BadRequestError($ts`A connection that does not sign in has to ask for scopes.`);
        }
        const code: string = randomBytes(32).toString('base64url');
        await this.connectionCodeRepository.create({
            value: code,
            provider: this.name,
            userId,
            redirectTo: connection.redirectTo,
            signIn: connection.signIn,
            apiScopes,
            spent: false,
            expirationDate: new Date(Date.now() + options.connectionCodeExpiresInMs)
        });
        const url: URL = new URL(this.resolveRouteUrl('connect'));
        url.searchParams.set('code', code);
        return { url: url.toString() };
    }

    /**
     * Sends a connection started with `startConnection` on to the provider, and ties it to the browser.
     *
     * The user is always asked to sign in at the provider, rather than it reusing a session it has.
     * @param code - The one-time code of the connection.
     * @returns The url at the provider to send the browser to.
     * @throws FederatedSignInError when the code is unknown, spent or expired.
     */
    async continueConnection(code: string): Promise<string> {
        const options: ResolvedFederationOptions = this.resolveOptions();
        const connection: FederatedConnectionCode | undefined = await this.connectionCodeRepository.findOne({
            where: { value: await this.hashService.hash(code, { strategy: Sha256HashStrategy }), provider: this.name },
            required: false
        });
        if (connection == undefined || connection.spent || new Date(connection.expirationDate).getTime() <= Date.now()) {
            throw new FederatedSignInError(FederatedSignInFailure.EXPIRED, { action: AuditAction.IDENTITY_LINKED });
        }
        await this.claim(
            async () => await this.connectionCodeRepository.updateById(connection.id, { spent: true }, { where: { spent: false } }),
            AuditAction.IDENTITY_LINKED
        );
        // the cookie is set here, by the application's own origin in a top level navigation, rather
        // than by startConnection: that answers a request the frontend sends, which may come from
        // another site, and a browser keeps a cookie set there as a third party one or not at all.
        // The user signs in at the provider whatever session it has, so they see which account they
        // connect - a session somebody else left in a shared browser would otherwise be linked to them
        return await this.startAttempt(
            {
                redirectTo: connection.redirectTo,
                reauthenticate: true,
                codeChallenge: undefined,
                strategy: undefined,
                apiScopes: connection.apiScopes
            },
            connection.userId,
            connection.signIn,
            options
        );
    }

    /**
     * Takes the provider's answer to a sign-in.
     *
     * Checks that it answers a sign-in this browser started, has the provider prove who signed in, and
     * finds the user linked to the identity.
     * @param answer - What the provider sent the browser back with: the query of a redirect, or the
     * fields of a form post.
     * @returns The code that hands the login over, the ticket the registration continues with, or that
     * the provider is connected.
     * @throws FederatedSignInError saying why, when the answer cannot be taken.
     */
    async completeSignIn(answer: URLSearchParams): Promise<FederatedSignInResult> {
        const options: ResolvedFederationOptions = this.resolveOptions();
        const state: string | null = this.readState(answer);
        if (state == undefined) {
            throw new FederatedSignInError(FederatedSignInFailure.EXPIRED);
        }
        const attempt: FederatedLoginAttempt | undefined = await this.attemptRepository.findOne({
            where: { state: await this.hashService.hash(state, { strategy: Sha256HashStrategy }), provider: this.name },
            required: false
        });
        if (attempt == undefined || attempt.spent || new Date(attempt.expirationDate).getTime() <= Date.now()) {
            throw new FederatedSignInError(FederatedSignInFailure.EXPIRED);
        }
        const action: FederatedSignInAction = attempt.userId == undefined ? AuditAction.LOGIN : AuditAction.IDENTITY_LINKED;
        const bindingCookie: string = this.getBindingCookieName(attempt.id);
        const binding: string | undefined = this.findCookie(bindingCookie);
        // a callback from another browser than the one the sign-in started in is how an attacker logs
        // a victim into the attacker's own account: they send the victim the answer to their sign-in.
        // For a connection, it is how they would link their own identity to the victim's account
        if (binding == undefined || !await this.hashService.equal(binding, attempt.binding)) {
            throw new FederatedSignInError(FederatedSignInFailure.EXPIRED, { action });
        }
        await this.claim(
            async () => await this.attemptRepository.updateById(attempt.id, { spent: true }, { where: { spent: false } }),
            action
        );

        const failure: FederatedSignInFailure | undefined = this.findProviderFailure(answer);
        if (failure != undefined) {
            this.clearCookie(bindingCookie);
            throw new FederatedSignInError(failure, { action });
        }

        const verified: FederatedSignIn | FederatedReauthentication = await this.verifyAnswer(answer, {
            state,
            binding,
            apiScopes: attempt.apiScopes,
            maxAuthenticationAgeInMs: options.maxAuthenticationAgeInMs,
            action
        });
        if ('reauthenticate' in verified) {
            this.clearCookie(bindingCookie);
            // a provider that ignored being asked once would be asked forever
            if (attempt.reauthenticate) {
                throw new FederatedSignInError(FederatedSignInFailure.INVALID, { action });
            }
            const url: string = await this.startAttempt(
                {
                    redirectTo: attempt.redirectTo,
                    reauthenticate: true,
                    codeChallenge: attempt.codeChallenge ?? undefined,
                    strategy: attempt.strategy ?? undefined,
                    apiScopes: attempt.apiScopes
                },
                attempt.userId ?? undefined,
                attempt.signIn,
                options
            );
            return { type: 'reauthentication', url };
        }
        const signIn: FederatedSignIn = verified;
        const signedIn: FederatedProviderIdentity = signIn.identity;
        // only what the sign-in asked for access to is kept: the tokens of a plain sign-in are good
        // for reading who signed in, which is done
        const tokens: ProviderTokenGrant | undefined = attempt.apiScopes.length ? signIn.tokens : undefined;
        if (attempt.userId != undefined) {
            this.clearCookie(bindingCookie);
            await this.linkConnectedIdentity(attempt.userId, signedIn, attempt.signIn, tokens);
            return { type: 'connected', userId: attempt.userId, redirectTo: attempt.redirectTo };
        }
        const proof: FederatedGrantProofData = attempt.codeChallenge == undefined
            ? { binding, bindingCookie, codeChallenge: undefined }
            : { binding: undefined, bindingCookie: undefined, codeChallenge: attempt.codeChallenge };
        if (attempt.codeChallenge != undefined) {
            // the frontend's verifier is the proof from here on
            this.clearCookie(bindingCookie);
        }

        const session: FederatedSessionData = this.toSessionData(signedIn, signIn.session);
        const identity: FederatedIdentity | undefined = await this.findIdentity(signedIn.issuer, signedIn.subject);
        if (identity != undefined) {
            this.validateSignsIn(identity, bindingCookie);
            if (tokens != undefined) {
                await this.keepProviderTokens(identity, tokens, undefined);
            }
            const code: string = randomBytes(32).toString('base64url');
            await this.handoverCodeRepository.create({
                value: code,
                provider: this.name,
                userId: identity.userId,
                authenticatedAt: signedIn.authenticatedAt,
                ...session,
                binding: proof.binding,
                bindingCookie: proof.bindingCookie,
                codeChallenge: proof.codeChallenge,
                spent: false,
                expirationDate: new Date(Date.now() + options.handoverCodeExpiresInMs)
            });
            return { type: 'handover', code, redirectTo: attempt.redirectTo, strategy: attempt.strategy ?? undefined };
        }
        const ticket: string = await this.startRegistration(signedIn, tokens, session, proof, attempt.redirectTo, options);
        return { type: 'registration', ticket };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async authenticate(credentials: FederatedCredentials, transaction: Transaction | undefined): Promise<Authentication<UserType>> {
        if ('code' in credentials) {
            const handover: FederatedHandoverCode = await this.findHandoverCode(credentials.code, credentials.codeVerifier, transaction);
            await this.claim(async () => await this.handoverCodeRepository.updateById(
                handover.id,
                { spent: true },
                { where: { spent: false }, transaction }
            ), AuditAction.LOGIN);
            this.clearProofCookie(handover);
            return {
                user: await this.resolveUser(handover.userId),
                authenticatedAt: new Date(handover.authenticatedAt),
                federatedSession: this.toFederatedSession(handover)
            };
        }

        const ticket: FederatedRegistrationTicket = await this.findRegistrationTicket(credentials, transaction);
        // read in the login's transaction, which is where a registration has just linked it. Only one
        // that signs in: one connected for apis only in the meantime would otherwise log in as its user
        const identity: FederatedIdentity | undefined = await this.identityRepository.findOne({
            where: { issuer: ticket.issuer, subject: ticket.subject, signIn: true },
            transaction,
            required: false
        });
        if (identity == undefined) {
            throw new UnauthorizedError($ts`No user is linked to this sign-in.`);
        }
        await this.claim(async () => await this.registrationTicketRepository.updateById(
            ticket.id,
            { spent: true },
            { where: { spent: false }, transaction }
        ), AuditAction.LOGIN);
        this.clearProofCookie(ticket);
        return {
            user: await this.resolveUser(identity.userId),
            authenticatedAt: new Date(ticket.authenticatedAt),
            federatedSession: this.toFederatedSession(ticket)
        };
    }

    /**
     * Reads who signed in at the provider, for creating the user they become. Does not spend the ticket.
     * @param credentials - The ticket, and the PKCE verifier when the sign-in was started with a challenge.
     * @param transaction - The transaction the registration runs in, if any.
     * @returns Who signed in, as the provider reports them.
     * @throws When the ticket is unknown, spent or expired, or the proof is missing.
     */
    async resolveRegistration(
        credentials: FederatedTicketCredentials,
        transaction: Transaction | undefined
    ): Promise<FederatedRegistration> {
        const ticket: FederatedRegistrationTicket = await this.findRegistrationTicket(credentials, transaction);
        return {
            provider: ticket.provider,
            issuer: ticket.issuer,
            subject: ticket.subject,
            email: ticket.email ?? undefined,
            emailVerified: ticket.emailVerified ?? undefined,
            name: ticket.name ?? undefined,
            givenName: ticket.givenName ?? undefined,
            familyName: ticket.familyName ?? undefined,
            redirectTo: ticket.redirectTo
        };
    }

    /**
     * Links the identity a registration ticket names to a user, so the ticket can log them in and every
     * later sign-in through the provider finds them. Keeps the tokens of the provider's apis the sign-in
     * asked for. Does not spend the ticket.
     * @param credentials - The ticket, and the PKCE verifier when the sign-in was started with a challenge.
     * @param userId - The user to link the identity to.
     * @param transaction - The transaction the registration runs in, if any.
     * @throws When the ticket is unknown, spent or expired, or the proof is missing.
     */
    async linkIdentity(credentials: FederatedTicketCredentials, userId: string, transaction: Transaction | undefined): Promise<void> {
        const ticket: FederatedRegistrationTicket = await this.findRegistrationTicket(credentials, transaction);
        const identity: FederatedIdentity = await this.identityRepository.create(
            { issuer: ticket.issuer, subject: ticket.subject, userId, signIn: true, grantedScopes: [] },
            { transaction }
        );
        if (ticket.accessToken != undefined) {
            await this.keepProviderTokens(identity, {
                accessToken: ticket.accessToken,
                refreshToken: ticket.refreshToken,
                accessTokenExpirationDate: ticket.accessTokenExpirationDate,
                grantedScopes: ticket.grantedScopes
            }, transaction);
        }
    }

    /**
     * Finds the identities at the provider that are linked to a user.
     * @param userId - The user.
     * @param transaction - The transaction to read in, if any.
     * @returns The identities, none when the user has none at the provider.
     */
    async findIdentities(userId: string, transaction: Transaction | undefined): Promise<FederatedIdentity[]> {
        const identities: FederatedIdentity[] = await this.identityRepository.findAll({ where: { userId }, transaction });
        return identities.filter(identity => this.isOwnIssuer(identity.issuer));
    }

    /**
     * Unlinks an identity at the provider from a user, so a sign-in through it no longer logs in as them.
     * @param userId - The user.
     * @param identityId - The id of the identity, as `findIdentities` answers with it.
     * @param transaction - The transaction to unlink in, if any.
     * @throws NotFoundError when the user has no identity of that id at the provider.
     */
    async unlinkIdentity(userId: string, identityId: string, transaction: Transaction | undefined): Promise<void> {
        const identity: FederatedIdentity = await this.findOwnIdentity(userId, identityId, transaction);
        await this.identityRepository.deleteById(identity.id, { transaction });
    }

    /**
     * The origins the provider's answer may be posted to the callback from: the origin of its sign-in
     * page, when it answers with a form post. None when it redirects.
     * @returns The origins.
     * @throws When the provider cannot be reached to read where its sign-in page is.
     */
    abstract resolveFormPostOrigins(): Promise<string[]>;

    /**
     * The document the authenticator publishes about the application at the `metadata` route, for the
     * provider to be set up with. None by default.
     * @returns The document, or undefined when the protocol has none.
     */
    // eslint-disable-next-line typescript/require-await
    async resolveMetadata(): Promise<FederatedMetadata | undefined> {
        return undefined;
    }

    /**
     * The url at the provider that ends the session there a login was started from, once the login has
     * ended here. None by default, for a protocol that cannot be told.
     * @param session - The session the login kept.
     * @returns The url to send the browser to, or undefined when the provider cannot be told.
     */
    // eslint-disable-next-line typescript/require-await
    async createLogoutUrl(
        // eslint-disable-next-line no-unused-vars
        session: FederatedSession
    ): Promise<string | undefined> {
        return undefined;
    }

    /**
     * Reads what the provider sent the browser to the `logout` route with: that the user logged out
     * there, or the answer to a logout that started here.
     * @param message - The query of a redirect, or the fields of a posted form.
     * @returns What the provider said.
     * @throws NotFoundError for a protocol without logout at the provider.
     * @throws UnauthorizedError when what the provider sent cannot be verified.
     */
    // eslint-disable-next-line typescript/require-await
    async readProviderLogout(
        // eslint-disable-next-line no-unused-vars
        message: FederatedProviderLogoutMessage
    ): Promise<FederatedProviderLogout> {
        throw new NotFoundError($ts`The provider "${this.name}" cannot be logged out at.`);
    }

    /**
     * Reads a logout request the provider sent server to server in a SOAP envelope, and answers which
     * logins end and the envelope to answer the provider with.
     * @param envelope - The envelope, exactly as it arrived.
     * @returns The logins that end, and the answer.
     * @throws NotFoundError for a protocol without such logout requests.
     * @throws UnauthorizedError when the request cannot be verified.
     */
    // eslint-disable-next-line typescript/require-await
    async resolveSoapLogout(
        // eslint-disable-next-line no-unused-vars
        envelope: string
    ): Promise<FederatedSoapLogout> {
        throw new NotFoundError($ts`The provider "${this.name}" takes no logout requests sent server to server.`);
    }

    /**
     * Builds the url at the provider the browser is sent to for a sign-in.
     *
     * Everything the provider has to echo back in its answer is either `state` or derived from the
     * binding with `deriveFromBinding`, so the stored attempt holds nothing a reader of the database
     * could finish the sign-in with.
     * @param start - What the sign-in is started with.
     * @returns The url.
     * @throws When the provider cannot be reached to build it.
     */
    protected abstract createSignInUrl(start: FederatedSignInStart): Promise<string>;

    /**
     * Has the provider prove who signed in, from its answer to a sign-in this browser started.
     * @param answer - Everything the provider sent the browser back with.
     * @param context - What the answer is checked with.
     * @returns Who signed in and when, and the tokens of the apis the sign-in asked for. Or that the
     * user signed in at the provider longer ago than `maxAuthenticationAgeInMs` allows, for a protocol
     * that cannot ask the provider beforehand, which starts the sign-in again with `reauthenticate`.
     * @throws FederatedSignInError when the provider cannot be reached or does not prove who signed in.
     */
    protected abstract verifyAnswer(
        answer: URLSearchParams,
        context: FederatedAnswerContext
    ): Promise<FederatedSignIn | FederatedReauthentication>;

    /**
     * Whether the provider sends its answer back as a page posting it to the callback, which another
     * site's page does: the cookie of the sign-in is then made one a browser sends along with that.
     * @returns True for a form post, false for a redirect.
     */
    protected abstract answersWithFormPost(): boolean;

    /**
     * Reads what the provider handed back to find the sign-in again.
     * @param answer - Everything the provider sent the browser back with.
     * @returns The state, or null when the answer has none.
     */
    protected readState(answer: URLSearchParams): string | null {
        return answer.get('state');
    }

    /**
     * Reads why the provider did not sign the user in, when its answer says it did not.
     * @param answer - Everything the provider sent the browser back with.
     * @returns The failure, or undefined when the answer is to be verified.
     */
    protected findProviderFailure(
        // eslint-disable-next-line no-unused-vars
        answer: URLSearchParams
    ): FederatedSignInFailure | undefined {
        return undefined;
    }

    /**
     * Keeps the tokens of the provider's apis for an identity. Only called with tokens a sign-in of an
     * authenticator with `apiScopes` was granted.
     * @param identity - The identity.
     * @param tokens - The tokens.
     * @param transaction - The transaction to write in, if any.
     * @throws When the authenticator keeps no tokens.
     */
    // eslint-disable-next-line typescript/require-await
    protected async keepProviderTokens(
        identity: FederatedIdentity,
        // eslint-disable-next-line no-unused-vars
        tokens: ProviderTokenGrant,
        // eslint-disable-next-line no-unused-vars
        transaction: Transaction | undefined
    ): Promise<void> {
        throw new InternalError(`${this.constructor.name} keeps no tokens, but was handed some for the identity ${identity.id}.`);
    }

    /**
     * Finds an identity of a user at the provider.
     * @param userId - The user.
     * @param identityId - The id of the identity.
     * @param transaction - The transaction to read in, if any.
     * @returns The identity.
     * @throws NotFoundError when the user has no identity of that id at the provider.
     */
    protected async findOwnIdentity(userId: string, identityId: string, transaction: Transaction | undefined): Promise<FederatedIdentity> {
        const identity: FederatedIdentity | undefined = await this.identityRepository.findOne({
            where: { id: identityId, userId },
            transaction,
            required: false
        });
        if (identity == undefined || !this.isOwnIssuer(identity.issuer)) {
            throw new NotFoundError($ts`The user has no such identity at this provider.`);
        }
        return identity;
    }

    /**
     * Derives a value the provider has to echo back from the secret of the sign-in's cookie, so that only
     * the browser holding the cookie can complete the sign-in.
     * @param binding - The secret of the cookie.
     * @param purpose - What the value is for, which keeps values of different purposes apart.
     * @returns The value, in base64url.
     */
    protected deriveFromBinding(binding: string, purpose: string): string {
        return createHmac('sha256', binding).update(purpose)
            .digest('base64url');
    }

    /**
     * What identifies a person at the provider, and one session of theirs there, without naming them.
     * A login keeps both, and a logout at the provider finds its logins by them.
     * @param subject - Who the person is at the provider.
     * @param sessionId - The provider's id of the session, if it names one.
     * @returns The keys.
     */
    protected resolveSessionKeys(subject: string, sessionId: string | undefined): FederatedSessionMatch {
        const toKey: (parts: string[]) => string = parts => createHash('sha256').update(JSON.stringify(parts))
            .digest('base64url');
        return {
            provider: this.name,
            subjectKey: toKey([this.issuer, subject]),
            sessionKey: sessionId == undefined ? undefined : toKey([this.issuer, subject, sessionId])
        };
    }

    /**
     * The S256 challenge of a PKCE verifier.
     * @param codeVerifier - The verifier.
     * @returns The challenge.
     */
    protected toCodeChallenge(codeVerifier: string): string {
        return createHash('sha256').update(codeVerifier)
            .digest('base64url');
    }

    /**
     * The options every provider shares, with the defaults filled in.
     * @returns The options.
     * @throws When `FEDERATION_OPTIONS` is not provided.
     */
    protected resolveOptions(): ResolvedFederationOptions {
        const options: FederationOptions | undefined = inject(ZIBRI_DI_TOKENS.FEDERATION_OPTIONS);
        if (options == undefined) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.FEDERATION_OPTIONS, []);
        }
        return {
            ...options,
            loginAttemptExpiresInMs: options.loginAttemptExpiresInMs ?? 600000,
            registrationTicketExpiresInMs: options.registrationTicketExpiresInMs ?? 1800000,
            handoverCodeExpiresInMs: options.handoverCodeExpiresInMs ?? 60000,
            connectionCodeExpiresInMs: options.connectionCodeExpiresInMs ?? 60000
        };
    }

    private async startAttempt(
        request: FederatedSignInRequest,
        userId: string | undefined,
        signIn: boolean,
        options: ResolvedFederationOptions
    ): Promise<string> {
        const state: string = randomBytes(32).toString('base64url');
        const binding: string = randomBytes(32).toString('base64url');
        // built before anything is stored, so a provider that cannot be reached leaves nothing behind
        const url: string = await this.createSignInUrl({
            state,
            binding,
            reauthenticate: request.reauthenticate,
            apiScopes: request.apiScopes,
            maxAuthenticationAgeInMs: options.maxAuthenticationAgeInMs
        });
        const attempt: FederatedLoginAttempt = await this.attemptRepository.create({
            state,
            binding,
            provider: this.name,
            redirectTo: request.redirectTo,
            reauthenticate: request.reauthenticate,
            codeChallenge: request.codeChallenge,
            strategy: request.strategy,
            userId,
            signIn,
            apiScopes: request.apiScopes,
            spent: false,
            expirationDate: new Date(Date.now() + options.loginAttemptExpiresInMs)
        });
        // a provider posting its answer does so from its own page, which is another site: a browser
        // sends a cookie along with that only when it is SameSite=None. The cookie still only counts
        // together with the state of the same attempt, which another site cannot make up
        this.setBindingCookie(
            this.getBindingCookieName(attempt.id),
            binding,
            options.loginAttemptExpiresInMs,
            this.answersWithFormPost() ? 'none' : 'lax'
        );
        return url;
    }

    /**
     * Links the identity a connection signed in with to the user who connected the provider, unless it
     * is linked to them already, and keeps the tokens of the apis the connection asked for.
     *
     * A connection that signs in turns signing in on for an identity linked to the user already. One
     * that does not leaves it as it is.
     * @param userId - The user.
     * @param signedIn - Who signed in at the provider.
     * @param signIn - Whether the identity signs in as the user.
     * @param tokens - The tokens to keep, if the connection asked for any apis.
     * @throws FederatedSignInError when the identity is linked to another user, or the user no longer exists.
     */
    private async linkConnectedIdentity(
        userId: string,
        signedIn: FederatedProviderIdentity,
        signIn: boolean,
        tokens: ProviderTokenGrant | undefined
    ): Promise<void> {
        if (await this.userService.findById<RoleType, UserType, false>(userId, { required: false }) == undefined) {
            throw new FederatedSignInError(FederatedSignInFailure.EXPIRED, { action: AuditAction.IDENTITY_LINKED });
        }
        let linked: FederatedIdentity | undefined = await this.findIdentity(signedIn.issuer, signedIn.subject);
        if (linked == undefined) {
            try {
                linked = await this.identityRepository.create({
                    issuer: signedIn.issuer,
                    subject: signedIn.subject,
                    userId,
                    signIn,
                    grantedScopes: []
                });
            }
            catch (error) {
                // linked in the meantime, by a second answer for the same user or by somebody else,
                // which the read below tells apart
                if (!(error instanceof UniqueConstraintViolationError)) {
                    throw error;
                }
                linked = await this.findIdentity(signedIn.issuer, signedIn.subject);
            }
        }
        // never moved from one user to another: whoever it signs in as now would lose it to whoever
        // connected it last
        if (linked?.userId !== userId) {
            throw new FederatedSignInError(FederatedSignInFailure.ALREADY_LINKED, { action: AuditAction.IDENTITY_LINKED });
        }
        if (signIn && !linked.signIn) {
            linked = await this.identityRepository.updateById(linked.id, { signIn: true });
        }
        if (tokens != undefined) {
            await this.keepProviderTokens(linked, tokens, undefined);
        }
    }

    /**
     * Refuses a sign-in with an identity that is linked to its user for the provider's apis only.
     *
     * Not sent to the registration either: an identity is linked to one user, so it could not be
     * linked to another.
     * @param identity - The identity.
     * @param bindingCookie - The cookie of the sign-in, which is of no use once it is refused.
     * @throws FederatedSignInError when the identity does not sign in.
     */
    private validateSignsIn(identity: FederatedIdentity, bindingCookie: string): void {
        if (!identity.signIn) {
            this.clearCookie(bindingCookie);
            throw new FederatedSignInError(FederatedSignInFailure.NOT_FOR_SIGN_IN);
        }
    }

    /**
     * Hands out the ticket a sign-in with an identity no user is linked to continues with at the
     * registration, holding who signed in and the tokens of the apis it asked for.
     * @param signedIn - Who signed in at the provider.
     * @param tokens - The tokens to keep once the identity is linked, if the sign-in asked for apis.
     * @param session - What the login keeps of the session at the provider.
     * @param proof - What the ticket is spent with.
     * @param redirectTo - Where the sign-in was to go once it was done.
     * @param options - The options.
     * @returns The ticket.
     */
    private async startRegistration(
        signedIn: FederatedProviderIdentity,
        tokens: ProviderTokenGrant | undefined,
        session: FederatedSessionData,
        proof: FederatedGrantProofData,
        redirectTo: string,
        options: ResolvedFederationOptions
    ): Promise<string> {
        const ticket: string = randomBytes(32).toString('base64url');
        await this.registrationTicketRepository.create({
            value: ticket,
            provider: this.name,
            issuer: signedIn.issuer,
            subject: signedIn.subject,
            ...signedIn.profile,
            redirectTo,
            authenticatedAt: signedIn.authenticatedAt,
            ...session,
            binding: proof.binding,
            bindingCookie: proof.bindingCookie,
            codeChallenge: proof.codeChallenge,
            // until there is a user to keep them for, which linkIdentity moves them to
            accessToken: tokens?.accessToken,
            refreshToken: tokens?.refreshToken,
            accessTokenExpirationDate: tokens?.accessTokenExpirationDate,
            grantedScopes: tokens?.grantedScopes ?? [],
            spent: false,
            expirationDate: new Date(Date.now() + options.registrationTicketExpiresInMs)
        });
        if (proof.bindingCookie != undefined && proof.binding != undefined) {
            // kept for as long as the registration may take, which is longer than the sign-in. Lax
            // whichever way the provider answered: the registration is the application's own page
            this.setBindingCookie(proof.bindingCookie, proof.binding, options.registrationTicketExpiresInMs, 'lax');
        }
        return ticket;
    }

    /**
     * What a handover code or a registration ticket keeps of the session at the provider, for the login
     * it becomes.
     * @param signedIn - Who signed in.
     * @param session - The session the provider says they have, if it can be ended.
     * @returns The columns.
     */
    private toSessionData(signedIn: FederatedProviderIdentity, session: FederatedProviderSession | undefined): FederatedSessionData {
        if (session == undefined) {
            return { subjectKey: undefined, sessionKey: undefined, sessionLogout: undefined };
        }
        const keys: FederatedSessionMatch = this.resolveSessionKeys(signedIn.subject, session.id);
        return { subjectKey: keys.subjectKey, sessionKey: keys.sessionKey, sessionLogout: session.logout };
    }

    private toFederatedSession(grant: FederatedSessionData): FederatedSession | undefined {
        if (grant.subjectKey == undefined) {
            return undefined;
        }
        return {
            provider: this.name,
            subjectKey: grant.subjectKey,
            sessionKey: grant.sessionKey ?? undefined,
            logout: grant.sessionLogout ?? undefined
        };
    }

    private async findIdentity(issuer: string, subject: string): Promise<FederatedIdentity | undefined> {
        return await this.identityRepository.findOne({ where: { issuer, subject }, required: false });
    }

    private findScopesNotAllowed(scopes: string[]): string[] {
        return scopes.filter(scope => !this.apiScopes.includes(scope));
    }

    /**
     * Whether an identity's issuer is this provider.
     *
     * Compared as urls: the issuer an identity is stored with is the one the provider publishes, which
     * may differ from the configured one by a trailing slash.
     * @param issuer - The issuer of an identity.
     * @returns True when it is this provider.
     */
    private isOwnIssuer(issuer: string): boolean {
        return new URL(issuer).href === new URL(this.issuer).href;
    }

    private async findHandoverCode(
        code: string,
        codeVerifier: string | undefined,
        transaction: Transaction | undefined
    ): Promise<FederatedHandoverCode> {
        const handover: FederatedHandoverCode | undefined = await this.handoverCodeRepository.findOne({
            where: { value: await this.hashService.hash(code, { strategy: Sha256HashStrategy }), provider: this.name },
            transaction,
            required: false
        });
        if (handover == undefined || handover.spent || new Date(handover.expirationDate).getTime() <= Date.now()) {
            throw new UnauthorizedError($ts`The code is invalid or has expired.`);
        }
        await this.validateProof(handover, codeVerifier);
        return handover;
    }

    private async findRegistrationTicket(
        credentials: FederatedTicketCredentials,
        transaction: Transaction | undefined
    ): Promise<FederatedRegistrationTicket> {
        const ticket: FederatedRegistrationTicket | undefined = await this.registrationTicketRepository.findOne({
            where: { value: await this.hashService.hash(credentials.ticket, { strategy: Sha256HashStrategy }), provider: this.name },
            transaction,
            required: false
        });
        if (ticket == undefined || ticket.spent || new Date(ticket.expirationDate).getTime() <= Date.now()) {
            throw new UnauthorizedError($ts`The ticket is invalid or has expired.`);
        }
        await this.validateProof(ticket, credentials.codeVerifier);
        return ticket;
    }

    /**
     * Checks that whoever spends a code or a ticket is who the sign-in was started by.
     *
     * Without it, a code or a ticket copied out of a url - a browser history, a referrer - would log in
     * whoever copied it.
     * @param grant - The code or the ticket.
     * @param codeVerifier - The verifier sent with it, if any.
     * @throws When the proof is missing or wrong.
     */
    private async validateProof(grant: FederatedGrantProof, codeVerifier: string | undefined): Promise<void> {
        if (grant.codeChallenge != undefined) {
            if (codeVerifier == undefined || !this.equalsInConstantTime(this.toCodeChallenge(codeVerifier), grant.codeChallenge)) {
                throw new UnauthorizedError($ts`The code verifier does not match.`);
            }
            return;
        }
        const binding: string | undefined = grant.bindingCookie == undefined ? undefined : this.findCookie(grant.bindingCookie);
        if (binding == undefined || grant.binding == undefined || !await this.hashService.equal(binding, grant.binding)) {
            throw new UnauthorizedError($ts`The sign-in was started in another browser.`);
        }
    }

    /**
     * Marks a code, a ticket or an attempt as spent, if nobody else did first.
     *
     * The read before takes no lock, so two requests carrying the same one both get this far - the
     * condition on the write decides between them.
     * @param spend - The write, which only finds it while it is not spent.
     * @param action - What the sign-in it belongs to is for.
     * @throws When it was spent meanwhile.
     */
    private async claim(spend: () => Promise<unknown>, action: FederatedSignInAction): Promise<void> {
        try {
            await spend();
        }
        catch (error) {
            if (!(error instanceof NotFoundError)) {
                throw error;
            }
            throw new FederatedSignInError(FederatedSignInFailure.EXPIRED, { cause: error, action });
        }
    }

    private async resolveUser(userId: string): Promise<UserType> {
        const user: UserType | undefined = await this.userService.findById<RoleType, UserType, false>(userId, { required: false });
        if (user == undefined) {
            throw new UnauthorizedError($ts`No user is linked to this sign-in.`);
        }
        return user;
    }

    /**
     * Refuses a name that cannot be part of a url, or that another provider already has.
     * @param app - The application.
     * @throws When the name is not usable.
     */
    private validateName(app: ZibriApplication): void {
        if (!PROVIDER_NAME_PATTERN.test(this.name)) {
            throw new InternalError(
                `The name "${this.name}" of ${this.constructor.name} can only have lowercase letters, digits and dashes.`
            );
        }
        const sharing: string[] = app.options.authenticators
            .filter(authenticator => {
                const instance: unknown = inject(authenticator);
                return isFederatedAuthenticator(instance) && instance.name === this.name;
            })
            .map(authenticator => authenticator.name);
        if (sharing.length > 1) {
            throw new InternalError(`${sharing.join(', ')} share the name "${this.name}". Every provider needs a name of its own.`);
        }
    }

    /**
     * Refuses a redirect that is not under one of the allowed ones, which would make the sign-in an
     * open redirect: a link to the application's own sign-in that ends on somebody else's page.
     * @param redirectTo - Where the sign-in should go.
     * @param allowedRedirects - Where it may go.
     * @throws When it may not go there.
     */
    private validateRedirect(redirectTo: string, allowedRedirects: string[]): void {
        let target: URL;
        try {
            target = new URL(redirectTo);
        }
        catch {
            throw new BadRequestError($ts`redirectTo has to be an absolute url.`);
        }
        const allowed: boolean = allowedRedirects.some(entry => {
            const permitted: URL = new URL(entry);
            const below: string = permitted.pathname.endsWith('/') ? permitted.pathname : `${permitted.pathname}/`;
            return target.origin === permitted.origin
                && (target.pathname === permitted.pathname || target.pathname.startsWith(below));
        });
        if (!allowed) {
            throw new BadRequestError($ts`redirectTo is not one of the allowed redirects.`);
        }
    }

    private equalsInConstantTime(a: string, b: string): boolean {
        const left: Buffer = Buffer.from(a);
        const right: Buffer = Buffer.from(b);
        return left.length === right.length && timingSafeEqual(left, right);
    }

    private getBindingCookieName(attemptId: string): string {
        return `${BINDING_COOKIE_PREFIX}${attemptId}`;
    }

    private resolveHttpContext(): HttpRequestContext {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!(context instanceof HttpRequestContext)) {
            throw new InternalError('A sign-in at a provider runs inside an http request.');
        }
        return context;
    }

    private findCookie(name: string): string | undefined {
        // eslint-disable-next-line typescript/no-unsafe-member-access
        const value: unknown = this.resolveHttpContext().request.cookies?.[name];
        return typeof value === 'string' ? value : undefined;
    }

    private setBindingCookie(name: string, value: string, maxAge: number, sameSite: 'lax' | 'none'): void {
        const context: HttpRequestContext = this.resolveHttpContext();
        // lax by default, which a browser still sends when the provider sends it back with a top level
        // GET. A browser refuses SameSite=None on a cookie that is not secure
        context.response.cookie(name, value, {
            httpOnly: true,
            sameSite,
            secure: sameSite === 'none' || context.request.secure,
            maxAge,
            path: '/'
        });
    }

    private clearCookie(name: string): void {
        const context: HttpRequestContext = this.resolveHttpContext();
        context.response.clearCookie(name, { httpOnly: true, sameSite: 'lax', secure: context.request.secure, path: '/' });
    }

    private clearProofCookie(grant: FederatedGrantProof): void {
        if (grant.bindingCookie != undefined) {
            this.clearCookie(grant.bindingCookie);
        }
    }
}