import { DeclaredChecks } from './models/declared-checks.model';
import { HasPermissionMetadata } from './models/has-permission-metadata.model';
import { IsLoggedInMetadata } from './models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata } from './models/is-not-logged-in-metadata.model';
import { Require2faMetadata } from './models/require-2fa-metadata.model';
import { ResolvedAuthMetadata, ResolvedRouteAuth } from './models/resolved-auth-metadata.model';
import { RouteAuthConfiguration } from './models/route-auth-configuration.model';
import { SkipAuthMetadata, SkipMetadata } from './models/skip-auth-metadata.model';
import { type Permission } from './roles/permission.type';
import { type PlatformPermission } from './roles/platform-permission.type';
import { RoleLevel } from './roles/role-level.type';
import { type RoleServiceInterface } from './roles/role-service.interface';
import { RouteAuthServiceInterface } from './route-auth-service.interface';
import { ZibriApplication } from '../application/application';
import { DefaultAuth } from '../application/application-options.model';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InvalidDecoratorCombinationError } from '../error-handling/errors/invalid-decorator-combination.error';
import { InternalError } from '../error-handling/internal-error.model';
import { BeforeAppInit } from '../global/before-app-init.interface';
import { RouteRegistry } from '../global/route-registry/route.registry';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';

const AUTH_SKIP_LABEL: string = '@Auth.skip';
const AUTH_IS_LOGGED_IN_LABEL: string = '@Auth.isLoggedIn';
const AUTH_IS_NOT_LOGGED_IN_LABEL: string = '@Auth.isNotLoggedIn';
const AUTH_HAS_PERMISSION_LABEL: string = '@Auth.hasPermission';
const AUTH_HAS_PLATFORM_PERMISSION_LABEL: string = '@Auth.hasPlatformPermission';
const AUTH_REQUIRE_2FA_LABEL: string = '@Auth.require2fa';
const PERMISSIONS_TOKEN: string = 'ZIBRI_DI_TOKENS.PERMISSIONS';

/**
 * Default implementation of what routes declare about who may reach them, resolved while they are
 * registered.
 */
@Injectable({ register: 'onUse' })
export class RouteAuthService implements RouteAuthServiceInterface, BeforeAppInit {
    /**
     * What a route with no `@Auth` decorator of its own requires, as the application declared it.
     *
     * Left without a fallback on purpose: the option exists precisely because the framework does not
     * get to pick one.
     */
    private defaultAuth!: DefaultAuth;

    private get roleService(): RoleServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
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
    resolveRouteAuth(controllerClass: Newable<unknown>, controllerMethod: string): ResolvedRouteAuth {
        const metadata: ResolvedAuthMetadata = {
            isLoggedIn: this.resolveIsLoggedInMetadata(controllerClass, controllerMethod),
            isNotLoggedIn: this.resolveIsNotLoggedInMetadata(controllerClass, controllerMethod),
            hasPermission: this.resolveHasPermissionMetadata(controllerClass, controllerMethod),
            hasPlatformPermission: this.resolveHasPlatformPermissionMetadata(controllerClass, controllerMethod),
            require2fa: this.resolveRequire2faMetadata(controllerClass, controllerMethod)
        };
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(controllerClass, controllerMethod);
        const controllerSkip: SkipAuthMetadata | undefined = MetadataUtilities.getControllerSkipAuth(controllerClass);

        this.warnAboutRedundantSkips(controllerClass, controllerMethod, routeSkip, controllerSkip);

        return {
            metadata,
            requiresLogin: this.requiresLoginGiven(
                metadata,
                this.defaultAuthApplies(controllerClass, controllerMethod, routeSkip, controllerSkip)
            )
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveManualRouteAuth(auth: RouteAuthConfiguration | undefined): ResolvedRouteAuth {
        // the same gate a controller route goes through, reached with the two halves already known
        // rather than read off a class that does not exist here
        const metadata: ResolvedAuthMetadata = {
            isLoggedIn: auth?.isLoggedIn,
            isNotLoggedIn: auth?.isNotLoggedIn,
            hasPermission: auth?.hasPermission,
            hasPlatformPermission: auth?.hasPlatformPermission,
            require2fa: auth?.require2fa
        };
        return { metadata, requiresLogin: this.requiresLoginGiven(metadata, this.defaultAuth === 'isLoggedIn' && auth?.skip !== true) };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    requiresAuthentication(controllerClass: Newable<unknown>, controllerMethod: string): boolean {
        return RouteRegistry.get(controllerClass, controllerMethod).auth.requiresLogin;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    requiresRouteAuthentication(auth: RouteAuthConfiguration | undefined): boolean {
        return this.resolveManualRouteAuth(auth).requiresLogin;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateRouteAuth(auth: RouteAuthConfiguration | undefined, route: string): void {
        this.validateRoutePermissionIsDeclared('tenant', auth?.hasPermission, route, 'auth.hasPermission');
        this.validateRoutePermissionIsDeclared('platform', auth?.hasPlatformPermission, route, 'auth.hasPlatformPermission');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validatePermissionIsDeclared(level: RoleLevel, permission: string, usedBy: string): void {
        // a declared permission no role carries is let through: nobody passes what asks for it, which
        // is a statement the application may be making on purpose
        if (level === 'tenant' ? !this.roleService.isPermission(permission) : !this.roleService.isPlatformPermission(permission)) {
            throw new InternalError([
                `${usedBy} names the permission '${permission}',`,
                `which is not declared as a ${level} permission in ${PERMISSIONS_TOKEN}.`
            ]);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveIsLoggedInMetadata(controllerClass: Newable<unknown>, controllerMethod: string): IsLoggedInMetadata | undefined {
        return this.resolveCheckMetadata(
            controllerClass,
            controllerMethod,
            AUTH_IS_LOGGED_IN_LABEL,
            {
                controller: MetadataUtilities.getControllerIsLoggedIn(controllerClass),
                route: MetadataUtilities.getRouteIsLoggedIn(controllerClass, controllerMethod),
                controllerSkip: MetadataUtilities.getControllerSkipIsLoggedIn(controllerClass),
                routeSkip: MetadataUtilities.getRouteSkipIsLoggedIn(controllerClass, controllerMethod)
            },
            // the same condition @Auth.skip's warning hangs off, and for the same reason: under a
            // `isLoggedIn` default there is always a login to skip, so this decorator is what makes
            // the route reachable rather than a leftover. The other four per check skips stay
            // unconditional - none of them say anything about a login, so none of them become meaningful.
            this.defaultAuth === 'public'
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveIsNotLoggedInMetadata(controllerClass: Newable<unknown>, controllerMethod: string): IsNotLoggedInMetadata | undefined {
        return this.resolveCheckMetadata(
            controllerClass,
            controllerMethod,
            AUTH_IS_NOT_LOGGED_IN_LABEL,
            {
                controller: MetadataUtilities.getControllerIsNotLoggedIn(controllerClass),
                route: MetadataUtilities.getRouteIsNotLoggedIn(controllerClass, controllerMethod),
                controllerSkip: MetadataUtilities.getControllerSkipIsNotLoggedIn(controllerClass),
                routeSkip: MetadataUtilities.getRouteSkipIsNotLoggedIn(controllerClass, controllerMethod)
            },
            true
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveHasPermissionMetadata(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): HasPermissionMetadata<Permission> | undefined {
        const metadata: HasPermissionMetadata<Permission> | undefined = this.resolveCheckMetadata(
            controllerClass,
            controllerMethod,
            AUTH_HAS_PERMISSION_LABEL,
            {
                controller: MetadataUtilities.getControllerHasPermission(controllerClass),
                route: MetadataUtilities.getRouteHasPermission(controllerClass, controllerMethod),
                controllerSkip: MetadataUtilities.getControllerSkipHasPermission(controllerClass),
                routeSkip: MetadataUtilities.getRouteSkipHasPermission(controllerClass, controllerMethod)
            },
            true
        );
        this.validateRoutePermissionIsDeclared(
            'tenant',
            metadata,
            `${controllerClass.name}.${controllerMethod}`,
            AUTH_HAS_PERMISSION_LABEL
        );
        return metadata;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveHasPlatformPermissionMetadata(
        controllerClass: Newable<unknown>,
        controllerMethod: string
    ): HasPermissionMetadata<PlatformPermission> | undefined {
        const metadata: HasPermissionMetadata<PlatformPermission> | undefined = this.resolveCheckMetadata(
            controllerClass,
            controllerMethod,
            AUTH_HAS_PLATFORM_PERMISSION_LABEL,
            {
                controller: MetadataUtilities.getControllerHasPlatformPermission(controllerClass),
                route: MetadataUtilities.getRouteHasPlatformPermission(controllerClass, controllerMethod),
                controllerSkip: MetadataUtilities.getControllerSkipHasPlatformPermission(controllerClass),
                routeSkip: MetadataUtilities.getRouteSkipHasPlatformPermission(controllerClass, controllerMethod)
            },
            true
        );
        this.validateRoutePermissionIsDeclared(
            'platform',
            metadata,
            `${controllerClass.name}.${controllerMethod}`,
            AUTH_HAS_PLATFORM_PERMISSION_LABEL
        );
        return metadata;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveRequire2faMetadata(controllerClass: Newable<unknown>, controllerMethod: string): Require2faMetadata | undefined {
        return this.resolveCheckMetadata(
            controllerClass,
            controllerMethod,
            AUTH_REQUIRE_2FA_LABEL,
            {
                controller: MetadataUtilities.getControllerRequire2fa(controllerClass),
                route: MetadataUtilities.getRouteRequire2fa(controllerClass, controllerMethod),
                controllerSkip: MetadataUtilities.getControllerSkipRequire2fa(controllerClass),
                routeSkip: MetadataUtilities.getRouteSkipRequire2fa(controllerClass, controllerMethod)
            },
            true
        );
    }

    /**
     * Resolves what a check declared on a route and its controller means, with the skips applied -
     * the same for a login, no login, a permission and a second factor.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The route to resolve.
     * @param label - How the decorator is named in errors and warnings.
     * @param declared - What the route and its controller declare.
     * @param warnsOfUselessSkips - Whether a skip with no check to skip is warned about.
     * @returns The check that applies, or undefined when none does.
     * @throws When a check and a skip of it are declared together.
     */
    private resolveCheckMetadata<Check extends object>(
        controllerClass: Newable<unknown>,
        controllerMethod: string,
        label: string,
        declared: DeclaredChecks<Check>,
        warnsOfUselessSkips: boolean
    ): Check | undefined {
        const controllerCheck: Check | undefined = declared.controller;
        const routeCheck: Check | undefined = declared.route;
        const controllerSkipCheck: SkipMetadata | undefined = declared.controllerSkip;
        const routeSkipCheck: SkipMetadata | undefined = declared.routeSkip;
        const routeSkip: SkipAuthMetadata | undefined = MetadataUtilities.getRouteSkipAuth(
            controllerClass,
            controllerMethod
        );

        // contradicting declarations are refused while the route registers: a deploy can still be
        // stopped at boot, while a 500 would reach whoever calls the route first
        if (routeCheck && routeSkip) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [label, AUTH_SKIP_LABEL]
            );
        }

        if (routeCheck && routeSkipCheck) {
            throw new InvalidDecoratorCombinationError(
                `${controllerClass.name}.${controllerMethod}`,
                [label, `${label}.skip`]
            );
        }
        if (controllerCheck && controllerSkipCheck) {
            throw new InvalidDecoratorCombinationError(controllerClass.name, [label, `${label}.skip`]);
        }
        this.validateControllerSkipDoesNotConflict(controllerClass, controllerCheck, label);

        if (warnsOfUselessSkips && !routeCheck && !controllerCheck && routeSkipCheck) {
            this.logger.warn(`Useless ${label}.skip on route ${controllerClass.name}.${controllerMethod}`);
        }
        if (warnsOfUselessSkips && !controllerCheck && controllerSkipCheck) {
            this.logger.warn(`Useless ${label}.skip on controller ${controllerClass.name}`);
        }

        if (routeSkipCheck || routeSkip) {
            return undefined;
        }
        if (routeCheck) {
            return routeCheck;
        }
        return controllerSkipCheck ? undefined : controllerCheck;
    }

    /**
     * Refuses a route naming a permission nobody declared at the level its check asks at.
     * @param level - The level the check asks at.
     * @param metadata - What the route resolved to, if it names a permission.
     * @param route - How to name the route in the error.
     * @param label - How to name the declaration in the error.
     * @throws When the permission is not declared at that level.
     */
    private validateRoutePermissionIsDeclared(
        level: RoleLevel,
        metadata: HasPermissionMetadata | undefined,
        route: string,
        label: string
    ): void {
        if (metadata != undefined) {
            this.validatePermissionIsDeclared(level, metadata.permission, `${route} in ${label}`);
        }
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
     * Only reachable under a `'public'` default: with `'isLoggedIn'` there is always something to
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
            || MetadataUtilities.getControllerHasPermission(controllerClass)
            || MetadataUtilities.getControllerHasPlatformPermission(controllerClass)
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
        return this.defaultAuth === 'isLoggedIn'
            && !routeSkip
            && !controllerSkip
            && !MetadataUtilities.getRouteSkipIsLoggedIn(controllerClass, controllerMethod)
            && !MetadataUtilities.getControllerSkipIsLoggedIn(controllerClass);
    }

    /**
     * The login gate once both halves of it are known.
     *
     * The single answer to "does a caller have to authenticate", shared by the runtime check and by
     * whoever describes the route to the outside, for a route carrying its declaration as decorators
     * and one carrying it as data. Not the same question as "does it carry an auth decorator": under
     * a `'isLoggedIn'` default a route that carries nothing requires a login too, and answering the
     * wrong one of those documented every undecorated route as public.
     * @param metadata - What the route resolved to.
     * @param defaultApplies - Whether the application's `defaultAuth` reaches this route.
     * @returns Whether a caller has to be logged in.
     */
    private requiresLoginGiven(metadata: ResolvedAuthMetadata, defaultApplies: boolean): boolean {
        return metadata.isLoggedIn != undefined
            || metadata.hasPermission != undefined
            || metadata.hasPlatformPermission != undefined
            || metadata.require2fa != undefined
            // the default, unless it says the opposite, and says it itself - a route only reachable
            // while logged out is not one the default requirement applies to
            || (metadata.isNotLoggedIn == undefined && defaultApplies);
    }
}