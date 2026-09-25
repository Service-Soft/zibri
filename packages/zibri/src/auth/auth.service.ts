import { AuthServiceInterface } from './auth-service.interface';
import { ZibriApplication } from '../application/application';
import { DefaultAuth } from '../application/application-options.model';
import { register } from '../di/register.function';
import { type TwoFactorServiceInterface } from './2fa/two-factor-service.interface';
import { BaseUser } from './models/base-user.model';
import { HasRoleMetadata, SkipHasRoleMetadata } from './models/has-role-metadata.model';
import { IsLoggedInMetadata, SkipIsLoggedInMetadata } from './models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata, SkipIsNotLoggedInMetadata } from './models/is-not-logged-in-metadata.model';
import { Require2faMetadata, SkipRequire2faMetadata } from './models/require-2fa-metadata.model';
import { ResolvedAuthMetadata, ResolvedRouteAuth } from './models/resolved-auth-metadata.model';
import { RouteAuthConfiguration } from './models/route-auth-configuration.model';
import { SkipAuthMetadata } from './models/skip-auth-metadata.model';
import { AuthStrategies } from './strategies/auth-strategies.model';
import { AuthStrategyInterface } from './strategies/auth-strategy.interface';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { ForbiddenError } from '../error-handling/errors/forbidden.error';
import { InvalidDecoratorCombinationError } from '../error-handling/errors/invalid-decorator-combination.error';
import { UnauthorizedError } from '../error-handling/errors/unauthorized.error';
import { BeforeAppInit } from '../global/before-app-init.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { RouteRegistry } from '../global/route-registry/route.registry';
import { $ts } from '../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../logging/audit-event.model';
import { auditReasonFor } from '../logging/audit-reason-for.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';

/**
 * The account a set of credentials names, as far as the framework can tell.
 *
 * Credentials are whatever the strategy defined them to be, so this is a best effort: `email` is the
 * shape both builtin strategies use, and a strategy that identifies its users some other way records
 * no subject rather than a wrong one.
 * @param credentials - Whatever was handed to the strategy.
 * @returns The named account, or undefined if the credentials do not name one.
 */
function auditSubject(credentials: unknown): string | undefined {
    if (typeof credentials !== 'object' || credentials == undefined || !('email' in credentials)) {
        return undefined;
    }
    return typeof credentials.email === 'string' ? credentials.email : undefined;
}

/**
 * The account a successful login turned out to be for.
 * @param authData - Whatever the strategy returned.
 * @returns The id of the account, or undefined if the returned data does not carry one.
 */
function auditUserId(authData: unknown): string | undefined {
    if (typeof authData !== 'object' || authData == undefined || !('userId' in authData)) {
        return undefined;
    }
    return typeof authData.userId === 'string' ? authData.userId : undefined;
}

const AUTH_SKIP_LABEL: string = '@Auth.skip';
const AUTH_IS_LOGGED_IN_LABEL: string = '@Auth.isLoggedIn';
const AUTH_IS_NOT_LOGGED_IN_LABEL: string = '@Auth.isNotLoggedIn';
const AUTH_HAS_ROLE_LABEL: string = '@Auth.hasRole';
const AUTH_REQUIRE_2FA_LABEL: string = '@Auth.require2fa';

/**
 * Default auth service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class AuthService implements AuthServiceInterface, BeforeAppInit, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly strategies: AuthStrategies = [];

    /**
     * What a route with no `@Auth` decorator of its own requires, as the application declared it.
     *
     * Left without a fallback on purpose: the option exists precisely because the framework does not
     * get to pick one.
     */
    private defaultAuth!: DefaultAuth;

    /**
     * Who each request is from, for as long as it is being handled.
     *
     * Keyed by the context so an entry is gone when the request is, and nothing has to clear it.
     */
    private readonly principals: WeakMap<
        HttpRequestContext | WebsocketRequestContext,
        Map<string, Promise<BaseUser<string> | undefined>>
    > = new WeakMap();

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE)
        private readonly twoFactorService: TwoFactorServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.REVALIDATE_USER_ON_AUTH_CHECK)
        private readonly revalidateUsers: boolean
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    beforeAppInit(app: ZibriApplication): void {
        // before rather than on init, and this is the whole reason the hook is implemented at all:
        // what a route declared is resolved while the route is registered, and the router is
        // initialized before this service is. Read any later and every route would have been
        // resolved against a default the application had not stated yet.
        this.defaultAuth = app.options.defaultAuth;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        const { authStrategies } = app.options;
        for (const strategy of authStrategies) {
            register({ token: strategy, useClass: strategy });
            this.strategies.push(strategy);
        }
        if (authStrategies.length) {
            this.logger.info(
                `initializes ${authStrategies.length} ${authStrategies.length > 1 ? 'auth strategies' : 'auth strategy'}`
            );
            for (const strategy of authStrategies) {
                this.logger.info(`  - ${strategy.name}`);
                await inject(strategy).init?.(app);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async login<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        credentials: CredentialsType
    ): Promise<AuthDataType> {
        // recorded here rather than in the strategies, so that a custom strategy is audited without
        // having to remember to be
        const subject: string | undefined = auditSubject(credentials);
        try {
            const authData: AuthDataType = await inject(strategy).login(credentials);
            this.logger.audit({
                action: AuditAction.LOGIN,
                outcome: AuditOutcome.SUCCESS,
                subject,
                userId: auditUserId(authData)
            });
            return authData;
        }
        catch (error) {
            this.logger.audit({
                action: AuditAction.LOGIN,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error),
                subject
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refreshLogin<
        Role extends string,
        UserType extends BaseUser<Role>,
        RefreshLoginDataType,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: RefreshLoginDataType
    ): Promise<AuthDataType> {
        try {
            const authData: AuthDataType = await inject(strategy).refreshLogin(data);
            this.logger.audit({
                action: AuditAction.REFRESH_LOGIN,
                outcome: AuditOutcome.SUCCESS,
                userId: auditUserId(authData)
            });
            return authData;
        }
        catch (error) {
            // a refused refresh is only an expired or unknown credential here. The one that matters -
            // a credential presented after it was already exchanged - is recorded by the strategy
            // that detects it, because only it can tell reuse from expiry.
            this.logger.audit({
                action: AuditAction.REFRESH_LOGIN,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error)
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async getCurrentUser<
        Role extends string,
        UserType extends BaseUser<Role>,
        B extends boolean = true
    >(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        required: B
    ): Promise<B extends false ? UserType | undefined : UserType> {
        // deliberately not short circuited on the CURRENT_USER token. That token is resolved for
        // whatever the route asked for, and answering a call that named different strategies with it
        // hands back a user the caller said it would not accept - and skips the `required` check
        // below, so a route declaring it needs a user could be handed undefined instead of a 401.
        // The memo underneath keys on what the answer depends on, which is the same saving without
        // the confusion.
        //
        // the same resolution the checks run, so a route that already established who this is does
        // not read the account again to hand it to the handler. Always the authoritative one: a
        // handler asking for the current user wants the row, not what a credential claims about it.
        const currentUser: UserType | undefined = await this.memoized(
            context,
            `resolved:${allowedStrategies.map(s => s.name).join(',')}`,
            async () => await this.readResolvedUser(context, allowedStrategies)
        ) as UserType | undefined;
        if (currentUser === undefined && required) {
            throw new UnauthorizedError($ts`Could not resolve the currently logged in user.`);
        }
        return currentUser as B extends false ? UserType | undefined : UserType;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestPasswordReset<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: RequestPasswordResetDataType
    ): Promise<void> {
        // deliberately not audited here. A reset is only requested *through* this method when the
        // address turned out to belong to somebody, so an event recorded here would be missing
        // exactly the requests worth watching - the ones probing addresses that do not exist. The
        // controllers record the request instead, where every request is still visible.
        await inject(strategy).requestPasswordReset(data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPasswordReset<
        Role extends string,
        UserType extends BaseUser<Role>,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        RefreshLoginDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: ConfirmPasswordResetDataType
    ): Promise<void> {
        try {
            await inject(strategy).confirmPasswordReset(data);
            this.logger.audit({ action: AuditAction.PASSWORD_RESET_CONFIRMED, outcome: AuditOutcome.SUCCESS });
        }
        catch (error) {
            // no subject: the request carries a reset token and a new password, and nothing that
            // names an account. Guessing tokens is what this event is for.
            this.logger.audit({
                action: AuditAction.PASSWORD_RESET_CONFIRMED,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error)
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async checkAccess(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        // read rather than resolved: the route's declaration cannot have changed since it was
        // registered, and resolving one warns and refuses along the way
        const { metadata, requiresLogin }: ResolvedRouteAuth = RouteRegistry.get(controllerClass, controllerMethod).auth;
        await this.runChecks(metadata, requiresLogin, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveRouteAuth(controllerClass: Newable<unknown>, controllerMethod: string): ResolvedRouteAuth {
        const metadata: ResolvedAuthMetadata = {
            isLoggedIn: this.resolveIsLoggedInMetadata(controllerClass, controllerMethod),
            isNotLoggedIn: this.resolveIsNotLoggedInMetadata(controllerClass, controllerMethod),
            hasRole: this.resolveHasRoleMetadata(controllerClass, controllerMethod),
            require2fa: this.resolveRequire2faMetadata(controllerClass, controllerMethod)
        };
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(controllerClass, controllerMethod);
        const controllerSkip: SkipAuthMetadata | undefined = MetadataUtilities.getControllerSkipAuth(controllerClass);

        this.warnAboutRedundantSkips(controllerClass, controllerMethod, routeSkip, controllerSkip);

        return {
            metadata,
            requiresLogin: this.requiresLoginFor(controllerClass, controllerMethod, metadata, routeSkip, controllerSkip)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async checkRouteAccess(
        auth: RouteAuthConfiguration | undefined,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        // the same gate a controller route goes through, reached with the two halves already known
        // rather than read off a class that does not exist here
        const metadata: ResolvedAuthMetadata = this.toResolvedAuthMetadata(auth);
        await this.runChecks(metadata, this.requiresLoginGiven(metadata, this.defaultAuthAppliesTo(auth)), context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    requiresRouteAuthentication(auth: RouteAuthConfiguration | undefined): boolean {
        return this.requiresLoginGiven(this.toResolvedAuthMetadata(auth), this.defaultAuthAppliesTo(auth));
    }

    /**
     * Reads a route's declaration into the shape the checks are written against.
     * @param auth - What the route declared, if anything.
     * @returns The four checks, each present only where the route asked for it.
     */
    private toResolvedAuthMetadata(auth: RouteAuthConfiguration | undefined): ResolvedAuthMetadata {
        return {
            isLoggedIn: auth?.isLoggedIn,
            isNotLoggedIn: auth?.isNotLoggedIn,
            hasRole: auth?.hasRole,
            require2fa: auth?.require2fa
        };
    }

    /**
     * Whether the application's default requirement reaches a manually registered route.
     * @param auth - What the route declared, if anything.
     * @returns True when the route has not opted out of it.
     */
    private defaultAuthAppliesTo(auth: RouteAuthConfiguration | undefined): boolean {
        return this.defaultAuth === 'requireLogin' && auth?.skip !== true;
    }

    /**
     * Runs the checks a route declared, in the order a caller meets them.
     *
     * Shared by both kinds of route on purpose. What a route says differs - decorators on a class, a
     * configuration object on a manually registered one - but what saying it *means* must not, or a
     * route would be protected by which way it was written down.
     * @param metadata - What the route resolved to.
     * @param requiresLogin - Whether a caller has to be authenticated, default included.
     * @param context - The request being checked.
     * @throws When one of the checks refuses the caller.
     */
    private async runChecks(
        metadata: ResolvedAuthMetadata,
        requiresLogin: boolean,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        const isLoggedInMetadata: IsLoggedInMetadata | undefined = metadata.isLoggedIn;
        const isNotLoggedInMetadata: IsNotLoggedInMetadata | undefined = metadata.isNotLoggedIn;
        const hasRoleMetadata: HasRoleMetadata | undefined = metadata.hasRole;
        const require2faMetadata: Require2faMetadata | undefined = metadata.require2fa;

        // isLoggedIn
        if (
            requiresLogin
            && !await this.isLoggedIn(context, isLoggedInMetadata?.allowedStrategies ?? this.strategies)
        ) {
            await this.auditDenied(context, isLoggedInMetadata?.allowedStrategies ?? this.strategies, AuditReason.NOT_LOGGED_IN);
            throw new UnauthorizedError($ts`You need to be logged in to access this route.`);
        }
        // isNotLoggedIn
        if (
            isNotLoggedInMetadata
            && await this.isLoggedIn(context, isNotLoggedInMetadata.allowedStrategies ?? this.strategies)
        ) {
            await this.auditDenied(context, isNotLoggedInMetadata.allowedStrategies ?? this.strategies, AuditReason.ALREADY_LOGGED_IN);
            throw new ForbiddenError($ts`You cannot be logged in when accessing this route.`);
        }

        // hasRole
        if (
            hasRoleMetadata
            && !await this.hasRole(context, hasRoleMetadata.allowedStrategies ?? this.strategies, hasRoleMetadata.allowedRoles)
        ) {
            await this.auditDenied(context, hasRoleMetadata.allowedStrategies ?? this.strategies, AuditReason.MISSING_ROLE);
            // which roles open a route is the authorization model, and the caller who just proved
            // they hold none of them is the last one it should be described to - walking the routes
            // with any account at all would otherwise map which role guards which endpoint. The
            // audit event above keeps the distinction, named and attributed, where it is useful
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }

        // require2fa
        if (require2faMetadata) {
            const user: BaseUser<string> = await this.getCurrentUser(context, this.strategies, true);
            if (!await this.twoFactorService.has2fa(user, context, require2faMetadata.allowedMethods)) {
                this.logger.audit({
                    action: AuditAction.AUTHORIZATION,
                    outcome: AuditOutcome.FAILURE,
                    reason: AuditReason.SECOND_FACTOR_MISSING,
                    userId: user.id
                });
                throw new UnauthorizedError($ts`You need to provide a second factor to access this route.`);
            }
        }

        // ownership is not checked here at all. It is declared on the entity as a `scope` and
        // enforced by the repository, which is the only place that sees the queries a handler
        // actually runs - a check here could only cover the routes that name a single row in their
        // path, which left every list endpoint to filter itself and one forgotten filter to be a
        // cross-account leak.
    }

    /**
     * Records that a route refused a caller.
     *
     * Only denials. A line per allowed request would be an access log, which is a different thing
     * with a different volume, and burying the refusals in it would defeat the purpose.
     * @param context - The request that was refused.
     * @param allowedStrategies - The strategies the failed check was willing to accept.
     * @param reason - Which check said no.
     */
    private async auditDenied(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        reason: AuditReason
    ): Promise<void> {
        // resolvePrincipal is memoized per request, so naming who was refused costs nothing beyond
        // the lookup the check that refused them already did
        const principal: BaseUser<string> | undefined = await this.resolvePrincipal(context, allowedStrategies);
        this.logger.audit({
            action: AuditAction.AUTHORIZATION,
            outcome: AuditOutcome.FAILURE,
            reason,
            userId: principal?.id
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isLoggedIn(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<boolean> {
        // the IS_LOGGED_IN token answers for the route's strategies, and this is asked with a set
        // per check - so reading it here would answer "logged in" for a credential the caller
        // excluded. resolvePrincipal memoizes per strategy set instead.
        return await this.resolvePrincipal(context, allowedStrategies) != undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async hasRole(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies,
        allowedRoles: string[]
    ): Promise<boolean> {
        const principal: BaseUser<string> | undefined = await this.resolvePrincipal(context, allowedStrategies);
        if (!principal) {
            return false;
        }
        return principal.roles.some(r => allowedRoles.includes(r));
    }

    /**
     * Refuses a controller that both declares a check and skips everything.
     *
     * The route level pair - `@Auth.isLoggedIn()` beside `@Auth.skip()` on the same method - has
     * always been a hard error, and the class level one only became expressible when `@Auth.skip`
     * gained a class form. Left undetected it resolves in favour of the check, so the skip reads
     * like it opens the controller and does nothing at all.
     * @param controllerClass - The controller to check.
     * @param controllerMetadata - The controller level check, if it declared one. Only its presence
     * matters here.
     * @param label - How to name that check in the error.
     * @throws When the controller carries both.
     */
    private validateControllerSkipDoesNotConflict(
        controllerClass: Newable<unknown>,
        controllerMetadata: object | undefined,
        label: string
    ): void {
        if (controllerMetadata && MetadataUtilities.getControllerSkipAuth(controllerClass)) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [label, AUTH_SKIP_LABEL]);
        }
    }

    /**
     * Warns about a skip that skips nothing.
     *
     * Only reachable under a `'public'` default: with `'requireLogin'` there is always something to
     * skip, because the skip is what makes the route public. A controller shipped by a library
     * cannot know which default the application picked and has to state its posture either way,
     * which is what `allowRedundant` is for.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The route to check.
     * @param routeSkip - The skip on the route, if it has one.
     * @param controllerSkip - The skip on the controller, if it has one.
     */
    private warnAboutRedundantSkips(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        routeSkip: SkipAuthMetadata | undefined,
        controllerSkip: SkipAuthMetadata | undefined
    ): void {
        if (
            this.defaultAuth !== 'public'
            || MetadataUtilities.getControllerIsLoggedIn(controllerClass)
            || MetadataUtilities.getControllerIsNotLoggedIn(controllerClass)
            || MetadataUtilities.getControllerHasRole(controllerClass)
            || MetadataUtilities.getControllerRequire2fa(controllerClass)
        ) {
            return;
        }
        if (routeSkip && !routeSkip.allowRedundant) {
            this.logger.warn(`Useless @Auth.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (controllerSkip && !controllerSkip.allowRedundant) {
            this.logger.warn(`Useless @Auth.skip on controller ${controllerClass.name}`);
        }
    }

    /**
     * Whether a route that carries no auth decorators of its own falls back to the application wide
     * default - the one decision the framework refuses to make on its own.
     *
     * A skip is how a route says "nothing" on purpose rather than by omission, and
     * `@Auth.isLoggedIn.skip` counts as one: it exists to undo a login requirement, so letting the
     * application wide requirement survive it would quietly turn that decorator into a no-op.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The route to check.
     * @param routeSkip - The skip on the route, if it has one.
     * @param controllerSkip - The skip on the controller, if it has one.
     * @returns Whether the route requires a logged in user because the application said so.
     */
    private defaultAuthApplies(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        routeSkip: SkipAuthMetadata | undefined,
        controllerSkip: SkipAuthMetadata | undefined
    ): boolean {
        return this.defaultAuth === 'requireLogin'
            && !routeSkip
            && !controllerSkip
            && !MetadataUtilities.getRouteSkipIsLoggedIn(controllerClass, controllerMethod)
            && !MetadataUtilities.getControllerSkipIsLoggedIn(controllerClass);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    requiresAuthentication(controllerClass: Newable<unknown>, controllerMethod: string): boolean {
        return RouteRegistry.get(controllerClass, controllerMethod).auth.requiresLogin;
    }

    /**
     * The login gate, for metadata that has already been resolved.
     *
     * The single answer to "does a caller have to authenticate", shared by the runtime check and by
     * whoever describes the route to the outside. Not the same question as "does it carry an auth
     * decorator": under a `'requireLogin'` default a route that carries nothing requires a login too,
     * and answering the wrong one of those documented every undecorated route as public.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The route to check.
     * @param metadata - What the route resolved to.
     * @param routeSkip - The skip on the route, if it has one.
     * @param controllerSkip - The skip on the controller, if it has one.
     * @returns Whether a caller has to be logged in.
     */
    private requiresLoginFor(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        metadata: ResolvedAuthMetadata,
        routeSkip: SkipAuthMetadata | undefined,
        controllerSkip: SkipAuthMetadata | undefined
    ): boolean {
        return this.requiresLoginGiven(
            metadata,
            this.defaultAuthApplies(controllerClass, controllerMethod, routeSkip, controllerSkip)
        );
    }

    /**
     * The login gate once both halves of it are known.
     *
     * Split out from the metadata lookup so a route that carries its declaration as data reaches the
     * same answer as one that carries it as decorators. Only *where the default applies* is read
     * differently; what the declaration means is decided once, here.
     * @param metadata - What the route resolved to.
     * @param defaultApplies - Whether the application's `defaultAuth` reaches this route.
     * @returns Whether a caller has to be logged in.
     */
    private requiresLoginGiven(metadata: ResolvedAuthMetadata, defaultApplies: boolean): boolean {
        if (metadata.isLoggedIn || metadata.hasRole || metadata.require2fa) {
            return true;
        }
        if (metadata.isNotLoggedIn) {
            // it says the opposite, and it says it itself - a route only reachable while logged out
            // is not one the default requirement applies to
            return false;
        }
        return defaultApplies;
    }

    /**
     * Resolves who the request is from, once per request.
     *
     * Every check is the same question about the same caller, so it is asked once: a route requiring
     * a login, a role and ownership resolved three times over before this. Keyed by the strategies
     * allowed for the check as well as by the request, because a route may narrow which of them
     * count - the same request with two different lists is two different questions.
     *
     * The authoritative answer is shared with getCurrentUser, which asks for exactly the same thing,
     * so a handler taking the current user does not pay for a second read of it.
     * @param context - The request to resolve for.
     * @param allowedStrategies - The strategies that may answer.
     * @returns Who the request is from, or undefined when no strategy recognizes it.
     */
    private async resolvePrincipal(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseUser<string> | undefined> {
        // a claimed principal is a different value than a resolved one, so the two never share an
        // entry - only the checks may take the claimed one, and getCurrentUser must not
        const key: string = `${this.revalidateUsers ? 'resolved' : 'claimed'}:${allowedStrategies.map(s => s.name).join(',')}`;
        return await this.memoized(context, key, async () => await this.readPrincipal(context, allowedStrategies));
    }

    /**
     * Runs the given resolution once per request, however often it is asked for.
     * @param context - The request the answer belongs to.
     * @param key - What is being resolved, including whatever it depends on.
     * @param resolve - Produces the answer when it is not known yet.
     * @returns The answer.
     */
    private async memoized(
        context: HttpRequestContext | WebsocketRequestContext,
        key: string,
        resolve: () => Promise<BaseUser<string> | undefined>
    ): Promise<BaseUser<string> | undefined> {
        const perRequest: Map<string, Promise<BaseUser<string> | undefined>> = this.principals.get(context)
            ?? new Map<string, Promise<BaseUser<string> | undefined>>();
        this.principals.set(context, perRequest);

        const pending: Promise<BaseUser<string> | undefined> | undefined = perRequest.get(key);
        if (pending) {
            return await pending;
        }
        const resolving: Promise<BaseUser<string> | undefined> = resolve();
        perRequest.set(key, resolving);
        return await resolving;
    }

    private async readPrincipal(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseUser<string> | undefined> {
        // eslint-disable-next-line stylistic/max-len
        const strategy: AuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown, unknown> | undefined = this.strategyFor(context, allowedStrategies);
        if (!strategy) {
            return undefined;
        }
        // the account, unless this deployment said it would rather trust the credential. A strategy
        // that cannot name a caller without reading does not offer the second one, and stays
        // authoritative whatever the setting says.
        if (this.revalidateUsers || strategy.resolveClaimedUser == undefined) {
            return await strategy.resolveUser(context);
        }
        return await strategy.resolveClaimedUser(context);
    }

    private async readResolvedUser(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): Promise<BaseUser<string> | undefined> {
        return await this.strategyFor(context, allowedStrategies)?.resolveUser(context);
    }

    /**
     * The one strategy a request addresses.
     *
     * Chosen by which credential is present rather than by asking every strategy to resolve, so a
     * request costs one lookup instead of one per registered strategy.
     * @param context - The request to look at.
     * @param allowedStrategies - The strategies that may answer.
     * @returns The strategy, or undefined when the request carries no credential any of them knows.
     * @throws When the request carries several, which names several callers.
     */
    private strategyFor(
        context: HttpRequestContext | WebsocketRequestContext,
        allowedStrategies: AuthStrategies
    ): AuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown, unknown> | undefined {
        // eslint-disable-next-line stylistic/max-len
        const strategies: AuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown, unknown, unknown, unknown>[] = allowedStrategies
            .map(s => inject(s))
            .filter(s => s.hasCredential(context));

        if (strategies.length > 1) {
            // a request addressing two strategies at once names two callers, and any pick between
            // them is arbitrary. Picking one is how a request ends up authorized as the stronger
            // identity while acting as the weaker: a browser attaches its session cookie to
            // everything, so whoever supplies the second credential decides which half of that pair
            // a route sees. Refused instead, before anything is read.
            throw new UnauthorizedError(
                $ts`This request carries more than one credential (${strategies.map(s => s.name).join(', ')}). Send exactly one.`
            );
        }
        return strategies[0];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveIsLoggedInMetadata(controllerClass: Newable<unknown>, controllerMethod: string): IsLoggedInMetadata | undefined {
        const controllerIsLoggedIn: IsLoggedInMetadata | undefined = MetadataUtilities.getControllerIsLoggedIn(controllerClass);
        const routeIsLoggedIn: IsLoggedInMetadata | undefined = MetadataUtilities.getRouteIsLoggedIn(
            controllerClass,
            controllerMethod
        );
        const controllerSkipIsLoggedIn: SkipIsLoggedInMetadata | undefined = MetadataUtilities.getControllerSkipIsLoggedIn(controllerClass);
        const routeSkipIsLoggedIn: SkipIsLoggedInMetadata | undefined = MetadataUtilities.getRouteSkipIsLoggedIn(
            controllerClass,
            controllerMethod
        );
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeIsLoggedIn && routeSkip) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_IS_LOGGED_IN_LABEL, AUTH_SKIP_LABEL]
            );
        }
        if (routeIsLoggedIn && routeSkipIsLoggedIn) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_IS_LOGGED_IN_LABEL, '@Auth.isLoggedIn.skip']
            );
        }
        if (controllerIsLoggedIn && controllerSkipIsLoggedIn) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [AUTH_IS_LOGGED_IN_LABEL, '@Auth.isLoggedIn.skip']);
        }
        this.validateControllerSkipDoesNotConflict(controllerClass, controllerIsLoggedIn, AUTH_IS_LOGGED_IN_LABEL);

        // the same condition @Auth.skip's warning hangs off, and for the same reason: under a
        // `requireLogin` default there is always a login to skip, so this decorator is what makes the
        // route reachable rather than a leftover. The other four per check skips stay unconditional -
        // none of them say anything about a login, so none of them become meaningful.
        if (this.defaultAuth === 'public' && !routeIsLoggedIn && !controllerIsLoggedIn && routeSkipIsLoggedIn) {
            this.logger.warn(`Useless @Auth.isLoggedIn.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (this.defaultAuth === 'public' && !controllerIsLoggedIn && controllerSkipIsLoggedIn) {
            this.logger.warn(`Useless @Auth.isLoggedIn.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipIsLoggedIn || routeSkip) {
            return undefined;
        }
        if (routeIsLoggedIn) {
            return routeIsLoggedIn;
        }
        if (controllerSkipIsLoggedIn) {
            return undefined;
        }
        return controllerIsLoggedIn;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveIsNotLoggedInMetadata(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): IsNotLoggedInMetadata | undefined {
        const controllerIsNotLoggedIn: IsNotLoggedInMetadata | undefined = MetadataUtilities.getControllerIsNotLoggedIn(controllerClass);
        const routeIsNotLoggedIn: IsNotLoggedInMetadata | undefined = MetadataUtilities.getRouteIsNotLoggedIn(
            controllerClass,
            controllerMethod
        );
        const controllerSkipIsNotLoggedIn: SkipIsNotLoggedInMetadata | undefined
            = MetadataUtilities.getControllerSkipIsNotLoggedIn(controllerClass);
        const routeSkipIsNotLoggedIn: SkipIsNotLoggedInMetadata | undefined = MetadataUtilities.getRouteSkipIsNotLoggedIn(
            controllerClass,
            controllerMethod
        );
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeIsNotLoggedIn && routeSkip) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_IS_NOT_LOGGED_IN_LABEL, AUTH_SKIP_LABEL]
            );
        }
        if (routeIsNotLoggedIn && routeSkipIsNotLoggedIn) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_IS_NOT_LOGGED_IN_LABEL, '@Auth.isNotLoggedIn.skip']
            );
        }
        if (controllerIsNotLoggedIn && controllerSkipIsNotLoggedIn) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [AUTH_IS_NOT_LOGGED_IN_LABEL, '@Auth.isNotLoggedIn.skip']);
        }
        this.validateControllerSkipDoesNotConflict(controllerClass, controllerIsNotLoggedIn, AUTH_IS_NOT_LOGGED_IN_LABEL);

        if (!routeIsNotLoggedIn && !controllerIsNotLoggedIn && routeSkipIsNotLoggedIn) {
            this.logger.warn(`Useless @Auth.isNotLoggedIn.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerIsNotLoggedIn && controllerSkipIsNotLoggedIn) {
            this.logger.warn(`Useless @Auth.isNotLoggedIn.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipIsNotLoggedIn || routeSkip) {
            return undefined;
        }
        if (routeIsNotLoggedIn) {
            return routeIsNotLoggedIn;
        }
        if (controllerSkipIsNotLoggedIn) {
            return undefined;
        }
        return controllerIsNotLoggedIn;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveHasRoleMetadata(controllerClass: Newable<unknown>, controllerMethod: string): HasRoleMetadata | undefined {
        const controllerHasRole: HasRoleMetadata | undefined = MetadataUtilities.getControllerHasRole(controllerClass);
        const routeHasRole: HasRoleMetadata | undefined = MetadataUtilities.getRouteHasRole(
            controllerClass,
            controllerMethod
        );
        const controllerSkipHasRole: SkipHasRoleMetadata | undefined = MetadataUtilities.getControllerSkipHasRole(controllerClass);
        const routeSkipHasRole: SkipHasRoleMetadata | undefined = MetadataUtilities.getRouteSkipHasRole(
            controllerClass,
            controllerMethod
        );
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeHasRole && routeSkip) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_HAS_ROLE_LABEL, AUTH_SKIP_LABEL]
            );
        }

        if (routeHasRole && routeSkipHasRole) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_HAS_ROLE_LABEL, '@Auth.hasRole.skip']
            );
        }
        if (controllerHasRole && controllerSkipHasRole) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [AUTH_HAS_ROLE_LABEL, '@Auth.hasRole.skip']);
        }
        this.validateControllerSkipDoesNotConflict(controllerClass, controllerHasRole, AUTH_HAS_ROLE_LABEL);

        if (!routeHasRole && !controllerHasRole && routeSkipHasRole) {
            this.logger.warn(`Useless @Auth.hasRole.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerHasRole && controllerSkipHasRole) {
            this.logger.warn(`Useless @Auth.hasRole.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipHasRole || routeSkip) {
            return undefined;
        }
        if (routeHasRole) {
            return routeHasRole;
        }
        if (controllerSkipHasRole) {
            return undefined;
        }
        return controllerHasRole;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveRequire2faMetadata(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): Require2faMetadata | undefined {
        const controllerRequire2fa: Require2faMetadata | undefined = MetadataUtilities.getControllerRequire2fa(
            controllerClass
        );
        const routeRequire2fa: Require2faMetadata | undefined = MetadataUtilities.getRouteRequire2fa(
            controllerClass,
            controllerMethod
        );
        const controllerSkipRequire2fa: SkipRequire2faMetadata | undefined = MetadataUtilities.getControllerSkipRequire2fa(controllerClass);
        const routeSkipRequire2fa: SkipRequire2faMetadata | undefined = MetadataUtilities.getRouteSkipRequire2fa(
            controllerClass,
            controllerMethod
        );
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        if (routeRequire2fa && routeSkip) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`, [AUTH_REQUIRE_2FA_LABEL, AUTH_SKIP_LABEL]
            );
        }
        if (routeRequire2fa && routeSkipRequire2fa) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [AUTH_REQUIRE_2FA_LABEL, '@Auth.require2fa.skip']
            );
        }
        if (controllerRequire2fa && controllerSkipRequire2fa) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [AUTH_REQUIRE_2FA_LABEL, '@Auth.require2fa.skip']);
        }
        this.validateControllerSkipDoesNotConflict(controllerClass, controllerRequire2fa, AUTH_REQUIRE_2FA_LABEL);

        if (!routeRequire2fa && !controllerRequire2fa && routeSkipRequire2fa) {
            this.logger.warn(`Useless @Auth.require2fa.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (!controllerRequire2fa && controllerSkipRequire2fa) {
            this.logger.warn(`Useless @Auth.require2fa.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipRequire2fa || routeSkip) {
            return undefined;
        }
        if (routeRequire2fa) {
            return routeRequire2fa;
        }
        if (controllerSkipRequire2fa) {
            return undefined;
        }
        return controllerRequire2fa;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async logout<
        Role extends string,
        UserType extends BaseUser<Role>,
        RefreshLoginDataType,
        AuthDataType,
        CredentialsType,
        RequestPasswordResetDataType,
        ConfirmPasswordResetDataType,
        LogoutDataType
    >(
        strategy: Newable<
            AuthStrategyInterface<
                Role,
                UserType,
                AuthDataType,
                CredentialsType,
                RequestPasswordResetDataType,
                ConfirmPasswordResetDataType,
                RefreshLoginDataType,
                LogoutDataType
            >
        >,
        data: LogoutDataType
    ): Promise<void> {
        try {
            await inject(strategy).logout(data);
            this.logger.audit({ action: AuditAction.LOGOUT, outcome: AuditOutcome.SUCCESS });
        }
        catch (error) {
            // the endpoint still answers as if it worked - a client that cannot log out has nothing
            // useful to do with the failure, and telling it would only leave the session it was
            // trying to drop. The record is what makes it visible at all: a logout that revoked
            // nothing is a live credential somebody believes is dead.
            this.logger.audit({
                action: AuditAction.LOGOUT,
                outcome: AuditOutcome.FAILURE,
                reason: auditReasonFor(error)
            });
        }
    }
}