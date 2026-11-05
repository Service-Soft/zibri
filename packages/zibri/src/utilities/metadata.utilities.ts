/* eslint-disable jsdoc/require-jsdoc */
import { MetadataInjectionKeys } from './metadata-injection-keys.enum';
import { ReflectUtilities } from './reflect.utilities';
import { resolveCallSites } from './resolve-call-sites.function';
import { resolveOriginalFile } from './resolve-original-file.function';
// every import of a subsystem built on utilities is marked `type`: this file only names their
// metadata shapes, and a value import would put utilities in a runtime cycle with each of them
import { type CurrentUserMetadata } from '../auth/decorators/current-user.decorator';
import { type HasPermissionMetadata, type SkipHasPermissionMetadata } from '../auth/models/has-permission-metadata.model';
import { type IsLoggedInMetadata, type SkipIsLoggedInMetadata } from '../auth/models/is-logged-in-metadata.model';
import { type IsNotLoggedInMetadata, type SkipIsNotLoggedInMetadata } from '../auth/models/is-not-logged-in-metadata.model';
import { type Require2faMetadata, type SkipRequire2faMetadata } from '../auth/models/require-2fa-metadata.model';
import { type SkipAuthMetadata } from '../auth/models/skip-auth-metadata.model';
import { type Permission } from '../auth/roles/permission.type';
import { type PlatformPermission } from '../auth/roles/platform-permission.type';
import { type BackupResourceInterface } from '../backup/backup-resource.interface';
import { type BackupResourceMetadata } from '../backup/decorators/backup-resource-metadata.model';
import { DataSourceMetadata } from '../data-source/decorators/data-source.decorator';
import { RepositoryForMetadata } from '../data-source/repository/repository-for-metadata.model';
import { DiToken } from '../di/models/di-token.model';
import { type BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { type EntityCheck } from '../entity/models/entity-check.model';
import { InvalidDecoratorCombinationError } from '../error-handling/errors/invalid-decorator-combination.error';
import { type OpenApiResponse } from '../open-api/open-api.model';
import { XmlPropertyMetadata } from '../parsing/xml/xml-property-metadata.model';
import { XmlRootMetadata } from '../parsing/xml/xml-root-metadata.model';
import { type ControllerRouteConfiguration } from '../routing/controller-route-configuration.model';
import { type AcceptCrossSitePostsOptions } from '../routing/decorators/accept-cross-site-posts-options.model';
import { type BodyMetadata } from '../routing/decorators/body-metadata.model';
import { type ControllerData } from '../routing/decorators/controller.decorator';
import { type PathParamMetadata, type QueryParamMetadata, type HeaderParamMetadata } from '../routing/decorators/param.decorator';
import { Newable } from '../types/newable.type';
import { type CustomValidationRule } from '../validation/custom-validation.model';
import { type CurrentWebsocketConnectionMetadata } from '../websocket/decorators/current-websocket-connection.decorator';
import { type WebsocketControllerData } from '../websocket/decorators/websocket-controller.decorator';
import { type WebsocketControllerRouteConfiguration } from '../websocket/models/websocket-controller-route-configuration.model';

const modelPropertiesStore: WeakMap<Function, Record<string, PropertyMetadata>> = new WeakMap();
const xmlPropertiesStore: WeakMap<Function, Record<string, XmlPropertyMetadata>> = new WeakMap();
const xmlRootStore: WeakMap<Function, XmlRootMetadata> = new WeakMap();
const xmlNamespaceStore: WeakMap<Function, string> = new WeakMap();
const modelChecksStore: WeakMap<Function, EntityCheck[]> = new WeakMap();
const customValidationsStore: WeakMap<Function, CustomValidations> = new WeakMap();

/**
 * The custom rules a model class declares itself.
 */
type CustomValidations = {
    /**
     * The rules, in the order they were declared.
     */
    // any, because a rule takes its own model as its parameter: a rule of one model is no rule of
    // `unknown`, and the store holds the rules of every model
    // eslint-disable-next-line typescript/no-explicit-any
    rules: CustomValidationRule<any>[],
    /**
     * Whether the rules of the class it extends apply to it as well.
     */
    inherits: boolean
};

/**
 * Utilities for handling Metadata.
 */
export abstract class MetadataUtilities {
    // ---------- helpers ----------
    /**
     * Copies a declaration so that whoever asked for it cannot write to the original.
     *
     * Deep, because the interesting parts of a declaration are the arrays and objects inside it - the
     * roles a route accepts, the strategies it accepts them from - and a copy that shared those hands
     * out the ability to widen the route it came from.
     *
     * Everything that is not a plain object or an array is passed on as it is. Classes, factories and
     * validators are what a declaration points at rather than what it holds, and copying one of those
     * would break the identity the rest of the framework compares it by.
     * @param value - What was stored.
     * @returns A copy that shares nothing writable with it.
     */
    private static cloneMetadata<T>(value: T): T {
        if (Array.isArray(value)) {
            const entries: unknown[] = value;
            return entries.map(entry => MetadataUtilities.cloneMetadata(entry)) as T;
        }
        if (typeof value !== 'object' || value == undefined) {
            return value;
        }
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype != undefined && prototype !== Object.prototype) {
            return value;
        }
        const clone: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
            clone[key] = MetadataUtilities.cloneMetadata((value as Record<string, unknown>)[key]);
        }
        return clone as T;
    }

    /**
     * Freezes a declaration and everything it holds, so that nobody can write to it any more.
     *
     * The same parts as {@link cloneMetadata} copies, for the same reason: a class, a factory or a
     * validator is what a declaration points at rather than what it holds, and freezing a class
     * would freeze the class itself.
     * @param value - The declaration.
     */
    private static freezeMetadata(value: unknown): void {
        if (typeof value !== 'object' || value == undefined || Object.isFrozen(value)) {
            return;
        }
        const prototype: unknown = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && prototype != undefined && prototype !== Object.prototype) {
            return;
        }
        Object.freeze(value);
        for (const entry of Object.values(value)) {
            MetadataUtilities.freezeMetadata(entry);
        }
    }

    private static resolveInheritedStore<T extends Record<string, unknown>>(store: WeakMap<Function, T>, ctor: Newable<unknown>): T {
        let entry: T | undefined = store.get(ctor);
        if (entry !== undefined) {
            return entry;
        }

        const parentCtor: Newable<unknown> | undefined = MetadataUtilities.getParentConstructor(ctor);
        const parentEntry: T | undefined = parentCtor
            ? MetadataUtilities.resolveInheritedStore(store, parentCtor)
            : undefined;

        // shallow clone parent's entry so child gets its own object
        entry = parentEntry ? Object.assign({}, parentEntry) : ({} as T);
        store.set(ctor, entry);
        return entry;
    }

    private static ensureInheritedReflectMetadata<T>(
        metadataKey: MetadataInjectionKeys,
        ctor: Function,
        controllerMethod?: string
    ): T | undefined {
        // if child has its own metadata, return clone immediately
        const own: T | undefined = ReflectUtilities.getOwnMetadata(metadataKey, ctor, controllerMethod);
        if (own !== undefined) {
            return MetadataUtilities.cloneMetadata(own);
        }

        // walk parents and clone+cache the first parent value found
        let parentCtor: Newable<unknown> | undefined = MetadataUtilities.getParentConstructor(ctor);
        while (parentCtor) {
            const parentOwn: T | undefined = ReflectUtilities.getOwnMetadata(metadataKey, parentCtor, controllerMethod);
            if (parentOwn !== undefined) {
                const clone: T | undefined = MetadataUtilities.cloneMetadata(parentOwn);
                ReflectUtilities.setMetadata(metadataKey, clone, ctor, controllerMethod);
                return clone;
            }
            parentCtor = MetadataUtilities.getParentConstructor(parentCtor);
        }
        return undefined;
    }

    // the metadata holds one permission, so a second decorator replaced the first without a word: a
    // route written as "this and that" checked only one of the two. A route names one permission,
    // and a subclass's own still replaces what it inherits, which is why only the own metadata counts
    private static validateNoPermissionYet(
        metadataKey: MetadataInjectionKeys,
        label: string,
        controller: Function,
        controllerMethod?: string
    ): void {
        if (ReflectUtilities.getOwnMetadata(metadataKey, controller, controllerMethod) !== undefined) {
            const target: string = controllerMethod == undefined ? controller.name : `${controller.name}.${controllerMethod}`;
            throw new InvalidDecoratorCombinationError(target, [label, label]);
        }
    }

    private static toNewable<T>(target: Newable<T> | T): Newable<T> {
        return typeof target === 'function'
            ? target as Newable<T>
            : (target as object).constructor as Newable<T>;
    }

    // ---------- file path ----------
    /**
     * Records the file the decorated class is declared in. Called from inside a decorator.
     * @param target - The class, or its prototype.
     */
    static setFilePath(target: Object): void {
        const ctor: Newable<unknown> = this.toNewable(target);
        // every decorator of a class records this - once per property, route and parameter - and
        // they all answer the same file, so only the first one pays for reading the stack. Own
        // metadata only: a subclass is declared in a file of its own
        if (ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.FILE_LOCATION, ctor) !== undefined) {
            return;
        }
        ReflectUtilities.setMetadata(MetadataInjectionKeys.FILE_LOCATION, MetadataUtilities.findDeclaringFrame() ?? 'unknown', ctor);
    }

    private static findDeclaringFrame(): NodeJS.CallSite | undefined {
        // found by what the frames are rather than at a fixed depth. The depth moved with every
        // decorator built on another - `@DataSource` calls `@Injectable` - and for a project's own
        // decorator wrapping one of those it landed inside reflect-metadata. Every decorator runs
        // from the helper the compiler emits for the class (`__decorate`, which goes through
        // `Reflect.decorate`), and the frame right below those is the statement declaring the class
        const callSites: NodeJS.CallSite[] = resolveCallSites(MetadataUtilities.setFilePath);
        const helperStart: number = callSites.findIndex(callSite => MetadataUtilities.isDecorateHelper(callSite));
        if (helperStart === -1) {
            return undefined;
        }
        const helperEnd: number = callSites.findIndex(
            (callSite, index) => index > helperStart && !MetadataUtilities.isDecorateHelper(callSite)
        );
        return callSites[helperEnd];
    }

    private static isDecorateHelper(callSite: NodeJS.CallSite): boolean {
        // `decorate` is reflect-metadata's, `__decorate` the one tsc and tslib emit
        return /^_*decorate$/.test(callSite.getFunctionName() ?? '');
    }

    static getFilePath(target: Object): string | undefined {
        const declaredAt: NodeJS.CallSite | string | undefined = ReflectUtilities.getMetadata(MetadataInjectionKeys.FILE_LOCATION, this.toNewable(target));
        // the frame is kept and resolved here, because reading a source map is expensive and every class
        // records this while its module loads, where only an error message ever asks for it
        return typeof declaredAt === 'object' ? resolveOriginalFile(declaredAt) ?? 'unknown' : declaredAt;
    }

    // ---------- param types / DI ----------
    static getParamTypes(target: Object): unknown[] {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.PARAM_TYPES, target) ?? [];
    }

    /**
     * Finds the parameter types the build recorded for the constructor a class declares itself.
     * @param target - The class.
     * @returns The types, or undefined when nothing was recorded for the class itself - which is the
     * case both for a class that inherits its constructor and for any class of a build that records
     * no decorator metadata.
     */
    static findOwnParamTypes(target: Object): unknown[] | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.PARAM_TYPES, target);
    }

    static setDiToken<T>(target: Object, token?: DiToken<T>): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_TOKEN, token ?? target, target);
    }

    static setInjectParamTokens(target: Object, tokens: Record<number, DiToken<unknown>>): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_TOKENS, tokens, target);
    }

    static getInjectParamTokens(target: Object): Record<number, DiToken<unknown>> {
        const ownInjectParamTokens: unknown = ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_TOKENS, target);
        return ownInjectParamTokens != undefined
            ? (ownInjectParamTokens as Record<number, DiToken<unknown>>)
            : MetadataUtilities.ensureInheritedReflectMetadata<Record<number, DiToken<unknown>>>(
                MetadataInjectionKeys.DI_INJECT_PARAM_TOKENS,
                target as Function
            ) ?? {};
    }

    // ---------- controller routes ----------
    static setControllerRoutes(controller: Function, routes: ControllerRouteConfiguration[]): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_ROUTES, routes, controller);
    }

    static getControllerRoutes(controller: Function): ControllerRouteConfiguration[] {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_ROUTES, controller) ?? [];
    }

    static addControllerRoute(controller: Function, route: ControllerRouteConfiguration): void {
        MetadataUtilities.setControllerRoutes(
            controller,
            MetadataUtilities.withRoute(
                MetadataUtilities.getControllerRoutes(controller),
                // eslint-disable-next-line typescript/no-unsafe-argument
                MetadataUtilities.getControllerRoutes(Object.getPrototypeOf(controller)),
                route
            )
        );
    }

    /**
     * The routes of a controller with one more.
     *
     * Always a list of its own: the routes read off a class that declared none yet are its parent's
     * list itself, which every other class extending that parent reads too. A route the parent declares
     * for the same method is the route of the implementation being replaced, so it goes.
     * @param routes - The routes the controller holds, its parent's included.
     * @param inherited - The routes of its parent.
     * @param route - The route to add.
     * @returns The routes with it.
     */
    private static withRoute<Route extends { controllerMethod: string }>(routes: Route[], inherited: Route[], route: Route): Route[] {
        return [...routes.filter(existing => existing.controllerMethod !== route.controllerMethod || !inherited.includes(existing)), route];
    }

    // ---------- route responses (method-level, inherit) ----------
    static setRouteResponses(controller: Function, data: OpenApiResponse[], controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_RESPONSES, data, controller, controllerMethod);
    }

    static getRouteResponses(controller: Function, controllerMethod: string): OpenApiResponse[] {
        return MetadataUtilities.ensureInheritedReflectMetadata<OpenApiResponse[]>(
            MetadataInjectionKeys.ROUTE_RESPONSES,
            controller,
            controllerMethod
        ) ?? [];
    }

    // ---------- controller base route ----------
    static setControllerData(controller: Function, data: ControllerData): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_DATA, data, controller);
    }

    static getControllerData(controller: Function): ControllerData | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_DATA, controller);
    }

    // ---------- route params / body / current user (method-level, inherit) ----------
    static setRoutePathParams(controller: Function, params: Record<number, PathParamMetadata>, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_PATH_PARAMS, params, controller, controllerMethod);
    }

    static getRoutePathParams(controller: Function, controllerMethod: string): Record<number, PathParamMetadata> {
        return MetadataUtilities.ensureInheritedReflectMetadata<Record<number, PathParamMetadata>>(
            MetadataInjectionKeys.ROUTE_PATH_PARAMS,
            controller,
            controllerMethod
        ) ?? {};
    }

    static setRouteQueryParams(controller: Function, params: Record<number, QueryParamMetadata>, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_QUERY_PARAMS, params, controller, controllerMethod);
    }

    static getRouteQueryParams(controller: Function, controllerMethod: string): Record<number, QueryParamMetadata> {
        return MetadataUtilities.ensureInheritedReflectMetadata<Record<number, QueryParamMetadata>>(
            MetadataInjectionKeys.ROUTE_QUERY_PARAMS,
            controller,
            controllerMethod
        ) ?? {};
    }

    static setRouteHeaderParams(controller: Function, params: Record<number, HeaderParamMetadata>, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_HEADER_PARAMS, params, controller, controllerMethod);
    }

    static getRouteHeaderParams(controller: Function, controllerMethod: string): Record<number, HeaderParamMetadata> {
        return MetadataUtilities.ensureInheritedReflectMetadata<Record<number, HeaderParamMetadata>>(
            MetadataInjectionKeys.ROUTE_HEADER_PARAMS,
            controller,
            controllerMethod
        ) ?? {};
    }

    static setRouteBody(controller: Function, body: BodyMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_BODY, body, controller, controllerMethod);
    }

    static getRouteBody(controller: Function, controllerMethod: string): BodyMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<BodyMetadata>(
            MetadataInjectionKeys.ROUTE_BODY,
            controller,
            controllerMethod
        );
    }

    static setRouteAcceptCrossSitePosts(controller: Function, data: AcceptCrossSitePostsOptions, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_ACCEPT_CROSS_SITE_POSTS, data, controller, controllerMethod);
    }

    static getRouteAcceptCrossSitePosts(controller: Function, controllerMethod: string): AcceptCrossSitePostsOptions | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<AcceptCrossSitePostsOptions>(
            MetadataInjectionKeys.ROUTE_ACCEPT_CROSS_SITE_POSTS,
            controller,
            controllerMethod
        );
    }

    static setRouteCurrentUser(controller: Function, body: CurrentUserMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_CURRENT_USER, body, controller, controllerMethod);
    }

    static getRouteCurrentUser(controller: Function, controllerMethod: string): CurrentUserMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<CurrentUserMetadata>(
            MetadataInjectionKeys.ROUTE_CURRENT_USER,
            controller,
            controllerMethod
        );
    }

    // ---------- route auth flags (method-level, inherit) ----------
    static setRouteIsLoggedIn(controller: Function, data: IsLoggedInMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_IS_LOGGED_IN, data, controller, controllerMethod);
    }

    static getRouteIsLoggedIn(controller: Function, controllerMethod: string): IsLoggedInMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<IsLoggedInMetadata>(
            MetadataInjectionKeys.ROUTE_IS_LOGGED_IN,
            controller,
            controllerMethod
        );
    }

    static setRouteSkipIsLoggedIn(controller: Function, data: SkipIsLoggedInMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_IS_LOGGED_IN, data, controller, controllerMethod);
    }

    static getRouteSkipIsLoggedIn(controller: Function, controllerMethod: string): SkipIsLoggedInMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<SkipIsLoggedInMetadata>(
            MetadataInjectionKeys.ROUTE_SKIP_IS_LOGGED_IN,
            controller,
            controllerMethod
        );
    }

    static setControllerIsLoggedIn(controller: Function, data: IsLoggedInMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_IS_LOGGED_IN, data, controller);
    }

    static getControllerIsLoggedIn(controller: Function): IsLoggedInMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_IS_LOGGED_IN, controller);
    }

    static setControllerSkipIsLoggedIn(controller: Function, data: SkipIsLoggedInMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_IS_LOGGED_IN, data, controller);
    }

    static getControllerSkipIsLoggedIn(controller: Function): SkipIsLoggedInMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_IS_LOGGED_IN, controller);
    }

    // ---------- permission metadata (method-level for routes) ----------
    static setRouteHasPermission(controller: Function, data: HasPermissionMetadata<Permission>, controllerMethod: string): void {
        MetadataUtilities.validateNoPermissionYet(
            MetadataInjectionKeys.ROUTE_HAS_PERMISSION,
            '@Auth.hasPermission',
            controller,
            controllerMethod
        );
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_HAS_PERMISSION, data, controller, controllerMethod);
    }

    static getRouteHasPermission(controller: Function, controllerMethod: string): HasPermissionMetadata<Permission> | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<HasPermissionMetadata<Permission>>(
            MetadataInjectionKeys.ROUTE_HAS_PERMISSION,
            controller,
            controllerMethod
        );
    }

    static setRouteSkipHasPermission(controller: Function, data: SkipHasPermissionMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_HAS_PERMISSION, data, controller, controllerMethod);
    }

    static getRouteSkipHasPermission(controller: Function, controllerMethod: string): SkipHasPermissionMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<SkipHasPermissionMetadata>(
            MetadataInjectionKeys.ROUTE_SKIP_HAS_PERMISSION,
            controller,
            controllerMethod
        );
    }

    static setControllerHasPermission(controller: Function, data: HasPermissionMetadata<Permission>): void {
        MetadataUtilities.validateNoPermissionYet(MetadataInjectionKeys.CONTROLLER_HAS_PERMISSION, '@Auth.hasPermission', controller);
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_HAS_PERMISSION, data, controller);
    }

    static getControllerHasPermission(controller: Function): HasPermissionMetadata<Permission> | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_HAS_PERMISSION, controller);
    }

    static setControllerSkipHasPermission(controller: Function, data: SkipHasPermissionMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_PERMISSION, data, controller);
    }

    static getControllerSkipHasPermission(controller: Function): SkipHasPermissionMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_PERMISSION, controller);
    }

    // ---------- platform permission metadata (method-level for routes) ----------
    static setRouteHasPlatformPermission(
        controller: Function,
        data: HasPermissionMetadata<PlatformPermission>,
        controllerMethod: string
    ): void {
        MetadataUtilities.validateNoPermissionYet(
            MetadataInjectionKeys.ROUTE_HAS_PLATFORM_PERMISSION,
            '@Auth.hasPlatformPermission',
            controller,
            controllerMethod
        );
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_HAS_PLATFORM_PERMISSION, data, controller, controllerMethod);
    }

    static getRouteHasPlatformPermission(
        controller: Function,
        controllerMethod: string
    ): HasPermissionMetadata<PlatformPermission> | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<HasPermissionMetadata<PlatformPermission>>(
            MetadataInjectionKeys.ROUTE_HAS_PLATFORM_PERMISSION,
            controller,
            controllerMethod
        );
    }

    static setRouteSkipHasPlatformPermission(controller: Function, data: SkipHasPermissionMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_HAS_PLATFORM_PERMISSION, data, controller, controllerMethod);
    }

    static getRouteSkipHasPlatformPermission(controller: Function, controllerMethod: string): SkipHasPermissionMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<SkipHasPermissionMetadata>(
            MetadataInjectionKeys.ROUTE_SKIP_HAS_PLATFORM_PERMISSION,
            controller,
            controllerMethod
        );
    }

    static setControllerHasPlatformPermission(controller: Function, data: HasPermissionMetadata<PlatformPermission>): void {
        MetadataUtilities.validateNoPermissionYet(
            MetadataInjectionKeys.CONTROLLER_HAS_PLATFORM_PERMISSION,
            '@Auth.hasPlatformPermission',
            controller
        );
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_HAS_PLATFORM_PERMISSION, data, controller);
    }

    static getControllerHasPlatformPermission(controller: Function): HasPermissionMetadata<PlatformPermission> | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_HAS_PLATFORM_PERMISSION, controller);
    }

    static setControllerSkipHasPlatformPermission(controller: Function, data: SkipHasPermissionMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_PLATFORM_PERMISSION, data, controller);
    }

    static getControllerSkipHasPlatformPermission(controller: Function): SkipHasPermissionMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_PLATFORM_PERMISSION, controller);
    }

    // ---------- require2fa (method-level, inherit) ----------
    static setRouteRequire2fa(
        controller: Function,
        data: Require2faMetadata,
        controllerMethod: string
    ): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_REQUIRE_2FA, data, controller, controllerMethod);
    }

    static getRouteRequire2fa(
        controller: Function,
        controllerMethod: string
    ): Require2faMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<Require2faMetadata>(
            MetadataInjectionKeys.ROUTE_REQUIRE_2FA,
            controller,
            controllerMethod
        );
    }

    static setRouteSkipRequire2fa(controller: Function, data: SkipRequire2faMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_REQUIRE_2FA, data, controller, controllerMethod);
    }

    static getRouteSkipRequire2fa(controller: Function, controllerMethod: string): SkipRequire2faMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<SkipRequire2faMetadata>(
            MetadataInjectionKeys.ROUTE_SKIP_REQUIRE_2FA,
            controller,
            controllerMethod
        );
    }

    static setControllerRequire2fa(controller: Function, data: Require2faMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_REQUIRE_2FA, data, controller);
    }

    static getControllerRequire2fa(controller: Function): Require2faMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_REQUIRE_2FA, controller);
    }

    static setControllerSkipRequire2fa(controller: Function, data: SkipRequire2faMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_REQUIRE_2FA, data, controller);
    }

    static getControllerSkipRequire2fa(controller: Function): Require2faMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_REQUIRE_2FA, controller);
    }

    // skip all auth.

    static setRouteSkipAuth(controller: Function, data: SkipAuthMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_AUTH, data, controller, controllerMethod);
    }

    static getRouteSkipAuth(controller: Function, controllerMethod: string): SkipAuthMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<SkipAuthMetadata>(
            MetadataInjectionKeys.ROUTE_SKIP_AUTH,
            controller,
            controllerMethod
        );
    }

    static setControllerSkipAuth(controller: Function, data: SkipAuthMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_AUTH, data, controller);
    }

    static getControllerSkipAuth(controller: Function): SkipAuthMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_AUTH, controller);
    }

    // ---------- model properties (WeakMap store, inherit) ----------
    static setModelProperties<T extends Newable<unknown>>(ctor: T, properties: Record<string, PropertyMetadata>): void {
        // the record itself is copied so the caller keeps writing to its own, and the property
        // metadata inside it stays shared. Deliberately not the deep copy above: `@Property` reads
        // this record back, adds one entry and stores it again once per decorated property, and the
        // class helpers that derive one model from another pass entries straight through - as does
        // a subclass, whose record starts as its parent's. Shared, a declaration is frozen instead:
        // a change made through one model would otherwise reach every model derived from it, or the
        // one it was derived from, and frozen it fails at whoever tries. A model that needs it
        // otherwise declares the property again
        for (const metadata of Object.values(properties)) {
            MetadataUtilities.freezeMetadata(metadata);
        }
        modelPropertiesStore.set(ctor, { ...properties });
    }

    static getModelProperties<T extends Newable<unknown>>(ctor: T): Record<string, PropertyMetadata> {
        return MetadataUtilities.resolveInheritedStore<Record<string, PropertyMetadata>>(modelPropertiesStore, ctor);
    }

    // ---------- xml properties (WeakMap store, inherit) ----------
    static setXmlProperties<T extends Newable<unknown>>(ctor: T, properties: Record<string, XmlPropertyMetadata>): void {
        xmlPropertiesStore.set(ctor, { ...properties });
    }

    static getXmlProperties<T extends Newable<unknown>>(ctor: T): Record<string, XmlPropertyMetadata> {
        return MetadataUtilities.resolveInheritedStore<Record<string, XmlPropertyMetadata>>(xmlPropertiesStore, ctor);
    }

    // ---------- xml root (WeakMap store, own) ----------
    // not inherited: a subclass is a model of its own, and takes its own class name as the root
    // rather than the name its parent chose
    static setXmlRoot(ctor: Newable<unknown>, metadata: XmlRootMetadata): void {
        xmlRootStore.set(ctor, metadata);
    }

    static findXmlRoot(ctor: Newable<unknown>): XmlRootMetadata | undefined {
        return xmlRootStore.get(ctor);
    }

    // ---------- xml namespace (WeakMap store, own) ----------
    // not inherited, like the root: a subclass is a model of its own
    static setXmlNamespace(ctor: Newable<unknown>, namespace: string): void {
        xmlNamespaceStore.set(ctor, namespace);
    }

    static findXmlNamespace(ctor: Newable<unknown>): string | undefined {
        return xmlNamespaceStore.get(ctor);
    }

    // ---------- parent constructor helper ----------
    private static getParentConstructor<T extends Function>(ctor: T): Newable<unknown> | undefined {
        if (ctor.prototype == undefined) {
            return undefined;
        }
        const proto: unknown = Object.getPrototypeOf(ctor.prototype);
        if (proto == undefined || proto === Object.prototype) {
            return undefined;
        }
        const parentCtor: Newable<unknown> | undefined = (proto as { constructor?: Function }).constructor as Newable<unknown> | undefined;
        return parentCtor == undefined || parentCtor === Object ? undefined : parentCtor;
    }

    // ---------- entity metadata ----------
    static setEntityMetadata(entity: Newable<unknown>, metadata: EntityMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ENTITY_METADATA, metadata, entity);
    }

    static getEntityMetadata<T extends BaseEntity>(entity: Newable<T>): EntityMetadata<T> | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.ENTITY_METADATA, entity);
    }

    // ---------- repository for metadata (own only) ----------
    // own rather than inherited, so that a class extending a repository of an entity is not taken for
    // a second one of it
    static setRepositoryForMetadata(repositoryClass: Newable<unknown>, metadata: RepositoryForMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.REPOSITORY_FOR_METADATA, metadata, repositoryClass);
    }

    static getRepositoryForMetadata(repositoryClass: Newable<unknown>): RepositoryForMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.REPOSITORY_FOR_METADATA, repositoryClass);
    }

    // ---------- model checks (WeakMap store, inherit) ----------
    // what a model derived from an entity by copying its properties carries over of the entity's
    // checks. An entity and a class extending one need no entry: they are found through the entity
    static setModelChecks(ctor: Newable<unknown>, checks: EntityCheck[]): void {
        modelChecksStore.set(ctor, checks);
    }

    static resolveModelChecks(ctor: Newable<unknown>): EntityCheck[] {
        const carried: EntityCheck[] | undefined = modelChecksStore.get(ctor);
        if (carried != undefined) {
            return carried;
        }
        const entity: EntityMetadata | undefined = ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ENTITY_METADATA, ctor);
        if (entity != undefined) {
            return entity.checks ?? [];
        }
        const parentCtor: Newable<unknown> | undefined = MetadataUtilities.getParentConstructor(ctor);
        return parentCtor == undefined ? [] : MetadataUtilities.resolveModelChecks(parentCtor);
    }

    // ---------- custom validations (WeakMap store, inherit) ----------
    // eslint-disable-next-line typescript/no-explicit-any
    static addCustomValidation(ctor: Newable<unknown>, rule: CustomValidationRule<any>): void {
        const own: CustomValidations = customValidationsStore.get(ctor) ?? { rules: [], inherits: true };
        customValidationsStore.set(ctor, { ...own, rules: [...own.rules, rule] });
    }

    // a model whose bodies may lack any property, such as a partial one: a rule written for the
    // whole model would read values that are not there
    static stopInheritingCustomValidations(ctor: Newable<unknown>): void {
        customValidationsStore.set(ctor, { rules: customValidationsStore.get(ctor)?.rules ?? [], inherits: false });
    }

    // eslint-disable-next-line typescript/no-explicit-any
    static resolveCustomValidations(ctor: Newable<unknown>): CustomValidationRule<any>[] {
        const own: CustomValidations | undefined = customValidationsStore.get(ctor);
        const parentCtor: Newable<unknown> | undefined = own?.inherits === false ? undefined : MetadataUtilities.getParentConstructor(ctor);
        return [...parentCtor == undefined ? [] : MetadataUtilities.resolveCustomValidations(parentCtor), ...own?.rules ?? []];
    }

    // ---------- data source metadata ----------
    static setDataSourceMetadata(dataSource: Function, metadata: DataSourceMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.DATA_SOURCE_METADATA, metadata, dataSource);
    }

    static getDataSourceMetadata(dataSource: Function): DataSourceMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.DATA_SOURCE_METADATA, dataSource);
    }

    // ---------- backup resource metadata ----------
    static setBackupResourceMetadata(entity: Newable<BackupResourceInterface>, metadata: BackupResourceMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.BACKUP_RESOURCE_METADATA, metadata, entity);
    }

    static getBackupResourceMetadata(
        entity: Newable<BackupResourceInterface> | BackupResourceInterface
    ): BackupResourceMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.BACKUP_RESOURCE_METADATA, this.toNewable(entity));
    }

    // ---------- route not-logged-in (method-level, inherit) ----------
    static setRouteIsNotLoggedIn(controller: Function, data: IsNotLoggedInMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_IS_NOT_LOGGED_IN, data, controller, controllerMethod);
    }

    static getRouteIsNotLoggedIn(controller: Function, controllerMethod: string): IsNotLoggedInMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<IsNotLoggedInMetadata>(
            MetadataInjectionKeys.ROUTE_IS_NOT_LOGGED_IN,
            controller,
            controllerMethod
        );
    }

    static setRouteSkipIsNotLoggedIn(controller: Function, data: SkipIsNotLoggedInMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_IS_NOT_LOGGED_IN, data, controller, controllerMethod);
    }

    static getRouteSkipIsNotLoggedIn(controller: Function, controllerMethod: string): SkipIsNotLoggedInMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<SkipIsNotLoggedInMetadata>(
            MetadataInjectionKeys.ROUTE_SKIP_IS_NOT_LOGGED_IN,
            controller,
            controllerMethod
        );
    }

    static setControllerIsNotLoggedIn(controller: Function, data: IsNotLoggedInMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_IS_NOT_LOGGED_IN, data, controller);
    }

    static getControllerIsNotLoggedIn(controller: Function): IsNotLoggedInMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_IS_NOT_LOGGED_IN, controller);
    }

    static setControllerSkipIsNotLoggedIn(controller: Function, data: SkipIsNotLoggedInMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_IS_NOT_LOGGED_IN, data, controller);
    }

    static getControllerSkipIsNotLoggedIn(controller: Function): SkipIsNotLoggedInMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_IS_NOT_LOGGED_IN, controller);
    }

    // websocket controller
    static setWebsocketControllerData(controller: Function, data: WebsocketControllerData): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.WEBSOCKET_CONTROLLER_DATA, data, controller);
    }

    static getWebsocketControllerData(controller: Function): WebsocketControllerData | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.WEBSOCKET_CONTROLLER_DATA, controller);
    }

    // websocket routes
    static setWebsocketControllerRoutes(controller: Function, routes: WebsocketControllerRouteConfiguration[]): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.WEBSOCKET_CONTROLLER_ROUTES, routes, controller);
    }

    static getWebsocketControllerRoutes(controller: Function): WebsocketControllerRouteConfiguration[] {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.WEBSOCKET_CONTROLLER_ROUTES, controller) ?? [];
    }

    static addWebsocketControllerRoute(controller: Function, route: WebsocketControllerRouteConfiguration): void {
        MetadataUtilities.setWebsocketControllerRoutes(
            controller,
            MetadataUtilities.withRoute(
                MetadataUtilities.getWebsocketControllerRoutes(controller),
                // eslint-disable-next-line typescript/no-unsafe-argument
                MetadataUtilities.getWebsocketControllerRoutes(Object.getPrototypeOf(controller)),
                route
            )
        );
    }

    // current websocket connection
    static setRouteCurrentWebsocketConnection(
        controller: Function,
        metadata: CurrentWebsocketConnectionMetadata,
        controllerMethod: string
    ): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_CURRENT_WEBSOCKET_CONNECTION, metadata, controller, controllerMethod);
    }

    static getRouteCurrentWebsocketConnection(
        controller: Function,
        controllerMethod: string
    ): CurrentWebsocketConnectionMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<CurrentWebsocketConnectionMetadata>(
            MetadataInjectionKeys.ROUTE_CURRENT_WEBSOCKET_CONNECTION,
            controller,
            controllerMethod
        );
    }
}