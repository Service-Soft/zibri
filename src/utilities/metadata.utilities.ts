/* eslint-disable jsdoc/require-jsdoc */
import { ReflectUtilities } from './reflect.utilities';
import { DiToken } from '../di';
import { Route, ControllerRouteConfiguration, PathParamMetadata, BodyMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing';
import { MetadataInjectionKeys } from './metadata-injection-keys.enum';
import { BelongsToMetadata, CurrentUserMetadata, HasRoleMetadata, IsLoggedInMetadata, IsNotLoggedInMetadata, Require2faMetadata, SkipAuthMetadata, SkipBelongsToMetadata, SkipHasRoleMetadata, SkipIsLoggedInMetadata, SkipIsNotLoggedInMetadata, SkipRequire2faMetadata } from '../auth';
import { BackupResourceInterface, BackupResourceMetadata } from '../backup';
import { EntityMetadata, PropertyMetadata } from '../entity';
import { BaseEntity } from '../entity/base-entity.model';
import { OpenApiResponse } from '../open-api';
import { Newable } from '../types';
import { CurrentWebsocketConnectionMetadata, WebsocketControllerData, WebsocketControllerRouteConfiguration } from '../websocket';

const modelPropertiesStore: WeakMap<Function, Record<string, PropertyMetadata>> = new WeakMap();

/**
 * Utilities for handling Metadata.
 */
export abstract class MetadataUtilities {
    // ---------- helpers ----------
    private static structuredCloneSafe<T>(value: T): T {
        if (Array.isArray(value)) {
            return [...value] as T;
        }
        return { ...value };
    }

    private static ensureInheritedStore<T extends Record<string, unknown>>(store: WeakMap<Function, T>, ctor: Newable<unknown>): T {
        let entry: T | undefined = store.get(ctor);
        if (entry !== undefined) {
            return entry;
        }

        const parentCtor: Newable<unknown> | undefined = MetadataUtilities.getParentConstructor(ctor);
        const parentEntry: T | undefined = parentCtor
            ? MetadataUtilities.ensureInheritedStore(store, parentCtor)
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
            return MetadataUtilities.structuredCloneSafe(own);
        }

        // walk parents and clone+cache the first parent value found
        let parentCtor: Newable<unknown> | undefined = MetadataUtilities.getParentConstructor(ctor);
        while (parentCtor) {
            const parentOwn: T | undefined = ReflectUtilities.getOwnMetadata(metadataKey, parentCtor, controllerMethod);
            if (parentOwn !== undefined) {
                const clone: T | undefined = MetadataUtilities.structuredCloneSafe(parentOwn);
                ReflectUtilities.setMetadata(metadataKey, clone, ctor, controllerMethod);
                return clone;
            }
            parentCtor = MetadataUtilities.getParentConstructor(parentCtor);
        }
        return undefined;
    }

    // ---------- file path ----------
    static setFilePath(target: Object, errorStack: string): void {
        const callerLine: string = errorStack.split('\n')[5];
        const filePath: string = callerLine.match(/\((.*):\d+:\d+\)/)?.[1] ?? 'unknown';

        // Store the file path in metadata
        if (typeof target === 'function') {
            ReflectUtilities.setMetadata(MetadataInjectionKeys.FILE_LOCATION, filePath, target);
        }
        else {
            ReflectUtilities.setMetadata(MetadataInjectionKeys.FILE_LOCATION, filePath, target.constructor);
        }
    }

    static getFilePath(target: Object): string | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.FILE_LOCATION, target);
    }

    // ---------- param types / DI ----------
    static getParamTypes(target: Object): unknown[] {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.PARAM_TYPES, target) ?? [];
    }

    static setDiToken<T>(target: Object, token?: DiToken<T>): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_TOKEN, token ?? target, target);
    }

    static setInjectParamTokens(target: Object, tokens: Record<number, DiToken<unknown>>): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_TOKENS, tokens, target);
    }

    static getInjectParamTokens(target: Object): Record<number, DiToken<unknown>> {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_TOKENS, target) ?? {};
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
    static setControllerBaseRoute(controller: Function, baseRoute: Route): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_BASE_ROUTE, baseRoute, controller);
    }

    static getControllerBaseRoute(controller: Function): Route | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_BASE_ROUTE, controller);
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

    // ---------- belongsTo (method-level, inherit) ----------
    static setRouteBelongsTo<T extends Newable<BaseEntity>>(
        controller: Function,
        data: BelongsToMetadata<T>,
        controllerMethod: string
    ): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_BELONGS_TO, data, controller, controllerMethod);
    }

    static getRouteBelongsTo<T extends Newable<BaseEntity>>(
        controller: Function,
        controllerMethod: string
    ): BelongsToMetadata<T> | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<BelongsToMetadata<T>>(
            MetadataInjectionKeys.ROUTE_BELONGS_TO,
            controller,
            controllerMethod
        );
    }

    static setRouteSkipBelongsTo(controller: Function, data: SkipBelongsToMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_BELONGS_TO, data, controller, controllerMethod);
    }

    static getRouteSkipBelongsTo(controller: Function, controllerMethod: string): SkipBelongsToMetadata | undefined {
        return MetadataUtilities.ensureInheritedReflectMetadata<SkipBelongsToMetadata>(
            MetadataInjectionKeys.ROUTE_SKIP_BELONGS_TO,
            controller,
            controllerMethod
        );
    }

    static setControllerBelongsTo<T extends Newable<BaseEntity>>(controller: Function, data: BelongsToMetadata<T>): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_BELONGS_TO, data, controller);
    }

    static getControllerBelongsTo<T extends Newable<BaseEntity>>(controller: Function): BelongsToMetadata<T> | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_BELONGS_TO, controller);
    }

    static setControllerSkipBelongsTo(controller: Function, data: SkipBelongsToMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_BELONGS_TO, data, controller);
    }

    static getControllerSkipBelongsTo(controller: Function): SkipBelongsToMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_BELONGS_TO, controller);
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

    // ---------- model properties (WeakMap store, inherit) ----------
    static setModelProperties<T extends Newable<unknown>>(ctor: T, properties: Record<string, PropertyMetadata>): void {
        // store a cloned copy to avoid external references
        modelPropertiesStore.set(ctor as unknown as Function, MetadataUtilities.structuredCloneSafe(properties));
    }

    static getModelProperties<T extends Newable<unknown>>(ctor: T): Record<string, PropertyMetadata> {
        return MetadataUtilities.ensureInheritedStore<Record<string, PropertyMetadata>>(modelPropertiesStore, ctor);
    }

    // ---------- parent constructor helper ----------
    private static getParentConstructor<T extends Function>(ctor: T): Newable<unknown> | undefined {
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

    static getEntityMetadata(entity: Newable<unknown>): EntityMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.ENTITY_METADATA, entity);
    }

    // ---------- backup resource metadata ----------
    static setBackupResourceMetadata(entity: Newable<BackupResourceInterface>, metadata: BackupResourceMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.BACKUP_RESOURCE_METADATA, metadata, entity);
    }

    static getBackupResourceMetadata(entity: Newable<BackupResourceInterface>): BackupResourceMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.BACKUP_RESOURCE_METADATA, entity);
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
    static setWebsocketController(controller: Function, data: WebsocketControllerData): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.WEBSOCKET_CONTROLLER, data, controller);
    }

    static getWebsocketController(controller: Function): WebsocketControllerData | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.WEBSOCKET_CONTROLLER, controller);
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