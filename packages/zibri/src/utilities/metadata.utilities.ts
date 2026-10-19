/* eslint-disable jsdoc/require-jsdoc */
import { MetadataInjectionKeys } from './metadata-injection-keys.enum';
import { ReflectUtilities } from './reflect.utilities';
import { resolveCallSites } from './resolve-call-sites.function';
import { CurrentUserMetadata } from '../auth/decorators/current-user.decorator';
import { HasRoleMetadata, SkipHasRoleMetadata } from '../auth/models/has-role-metadata.model';
import { IsLoggedInMetadata, SkipIsLoggedInMetadata } from '../auth/models/is-logged-in-metadata.model';
import { IsNotLoggedInMetadata, SkipIsNotLoggedInMetadata } from '../auth/models/is-not-logged-in-metadata.model';
import { Require2faMetadata, SkipRequire2faMetadata } from '../auth/models/require-2fa-metadata.model';
import { SkipAuthMetadata } from '../auth/models/skip-auth-metadata.model';
import { BackupResourceInterface } from '../backup/backup-resource.interface';
import { BackupResourceMetadata } from '../backup/decorators/backup-resource-metadata.model';
import { DataSourceMetadata } from '../data-source/decorators/data-source.decorator';
import { DiToken } from '../di/models/di-token.model';
import { type BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { OpenApiResponse } from '../open-api/open-api.model';
import { XmlPropertyMetadata } from '../parsing/xml/xml-property-metadata.model';
import { XmlRootMetadata } from '../parsing/xml/xml-root-metadata.model';
import { ControllerRouteConfiguration } from '../routing/controller-route-configuration.model';
import { AcceptCrossSitePostsOptions } from '../routing/decorators/accept-cross-site-posts-options.model';
import { BodyMetadata } from '../routing/decorators/body-metadata.model';
import { ControllerData } from '../routing/decorators/controller.decorator';
import { PathParamMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing/decorators/param.decorator';
import { Newable } from '../types/newable.type';
import { CurrentWebsocketConnectionMetadata } from '../websocket/decorators/current-websocket-connection.decorator';
import { WebsocketControllerData } from '../websocket/decorators/websocket-controller.decorator';
import { WebsocketControllerRouteConfiguration } from '../websocket/models/websocket-controller-route-configuration.model';

const modelPropertiesStore: WeakMap<Function, Record<string, PropertyMetadata>> = new WeakMap();
const xmlPropertiesStore: WeakMap<Function, Record<string, XmlPropertyMetadata>> = new WeakMap();
const xmlRootStore: WeakMap<Function, XmlRootMetadata> = new WeakMap();
const xmlNamespaceStore: WeakMap<Function, string> = new WeakMap();

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
        ReflectUtilities.setMetadata(MetadataInjectionKeys.FILE_LOCATION, MetadataUtilities.resolveDeclaringFile(), ctor);
    }

    private static resolveDeclaringFile(): string {
        // found by what the frames are rather than at a fixed depth. The depth moved with every
        // decorator built on another - `@DataSource` calls `@Injectable` - and for a project's own
        // decorator wrapping one of those it landed inside reflect-metadata. Every decorator runs
        // from the helper the compiler emits for the class (`__decorate`, which goes through
        // `Reflect.decorate`), and the frame right below those is the statement declaring the class
        const callSites: NodeJS.CallSite[] = resolveCallSites(MetadataUtilities.setFilePath);
        const helperStart: number = callSites.findIndex(callSite => MetadataUtilities.isDecorateHelper(callSite));
        if (helperStart === -1) {
            return 'unknown';
        }
        const helperEnd: number = callSites.findIndex(
            (callSite, index) => index > helperStart && !MetadataUtilities.isDecorateHelper(callSite)
        );
        return callSites[helperEnd]?.getFileName() ?? 'unknown';
    }

    private static isDecorateHelper(callSite: NodeJS.CallSite): boolean {
        // `decorate` is reflect-metadata's, `__decorate` the one tsc and tslib emit
        return /^_*decorate$/.test(callSite.getFunctionName() ?? '');
    }

    static getFilePath(target: Object): string | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.FILE_LOCATION, this.toNewable(target));
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
        if (ownInjectParamTokens != undefined) {
            return ownInjectParamTokens as Record<number, DiToken<unknown>>;
        }
        return MetadataUtilities.ensureInheritedReflectMetadata<Record<number, DiToken<unknown>>>(
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

    // ---------- role metadata (method-level for routes) ----------
    static setRouteHasRole(controller: Function, data: HasRoleMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_HAS_ROLE, data, controller, controllerMethod);
    }

    static getRouteHasRole(controller: Function, controllerMethod: string): HasRoleMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<HasRoleMetadata>(
            MetadataInjectionKeys.ROUTE_HAS_ROLE,
            controller,
            controllerMethod
        );
    }

    static setRouteSkipHasRole(controller: Function, data: SkipHasRoleMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_HAS_ROLE, data, controller, controllerMethod);
    }

    static getRouteSkipHasRole(controller: Function, controllerMethod: string): SkipHasRoleMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<SkipHasRoleMetadata>(
            MetadataInjectionKeys.ROUTE_SKIP_HAS_ROLE,
            controller,
            controllerMethod
        );
    }

    static setControllerHasRole(controller: Function, data: HasRoleMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_HAS_ROLE, data, controller);
    }

    static getControllerHasRole(controller: Function): HasRoleMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_HAS_ROLE, controller);
    }

    static setControllerSkipHasRole(controller: Function, data: SkipHasRoleMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_ROLE, data, controller);
    }

    static getControllerSkipHasRole(controller: Function): SkipHasRoleMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_ROLE, controller);
    }

    // ---------- platform role metadata (method-level for routes) ----------
    static setRouteHasPlatformRole(controller: Function, data: HasRoleMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_HAS_PLATFORM_ROLE, data, controller, controllerMethod);
    }

    static getRouteHasPlatformRole(controller: Function, controllerMethod: string): HasRoleMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<HasRoleMetadata>(
            MetadataInjectionKeys.ROUTE_HAS_PLATFORM_ROLE,
            controller,
            controllerMethod
        );
    }

    static setRouteSkipHasPlatformRole(controller: Function, data: SkipHasRoleMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_HAS_PLATFORM_ROLE, data, controller, controllerMethod);
    }

    static getRouteSkipHasPlatformRole(controller: Function, controllerMethod: string): SkipHasRoleMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<SkipHasRoleMetadata>(
            MetadataInjectionKeys.ROUTE_SKIP_HAS_PLATFORM_ROLE,
            controller,
            controllerMethod
        );
    }

    static setControllerHasPlatformRole(controller: Function, data: HasRoleMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_HAS_PLATFORM_ROLE, data, controller);
    }

    static getControllerHasPlatformRole(controller: Function): HasRoleMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_HAS_PLATFORM_ROLE, controller);
    }

    static setControllerSkipHasPlatformRole(controller: Function, data: SkipHasRoleMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_PLATFORM_ROLE, data, controller);
    }

    static getControllerSkipHasPlatformRole(controller: Function): SkipHasRoleMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_PLATFORM_ROLE, controller);
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
        modelPropertiesStore.set(ctor as unknown as Function, { ...properties });
    }

    static getModelProperties<T extends Newable<unknown>>(ctor: T): Record<string, PropertyMetadata> {
        return MetadataUtilities.resolveInheritedStore<Record<string, PropertyMetadata>>(modelPropertiesStore, ctor);
    }

    // ---------- xml properties (WeakMap store, inherit) ----------
    static setXmlProperties<T extends Newable<unknown>>(ctor: T, properties: Record<string, XmlPropertyMetadata>): void {
        xmlPropertiesStore.set(ctor as unknown as Function, { ...properties });
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
        if (parentCtor == undefined || parentCtor === Object) {
            return undefined;
        }
        return parentCtor;
    }

    // ---------- entity metadata ----------
    static setEntityMetadata(entity: Newable<unknown>, metadata: EntityMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ENTITY_METADATA, metadata, entity);
    }

    static getEntityMetadata<T extends BaseEntity>(entity: Newable<T>): EntityMetadata<T> | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.ENTITY_METADATA, entity);
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