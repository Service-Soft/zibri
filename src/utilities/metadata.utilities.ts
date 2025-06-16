import { ReflectUtilities } from './reflect.utilities';
import { DiToken } from '../di';
import { Route, ControllerRouteConfiguration, PathParamMetadata, BodyMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing';
import { MetadataInjectionKeys } from './metadata-injection-keys.enum';
import { BelongsToMetadata, CurrentUserMetadata, HasRoleMetadata, IsLoggedInMetadata, IsNotLoggedInMetadata, SkipAuthMetadata, SkipBelongsToMetadata, SkipHasRoleMetadata, SkipIsLoggedInMetadata, SkipIsNotLoggedInMetadata } from '../auth';
import { BaseEntity, EntityMetadata, PropertyMetadata } from '../entity';
import { OpenApiResponse } from '../open-api';
import { Newable } from '../types';

export abstract class MetadataUtilities {
    static setFilePath(target: Object, errorStack: string): void {
        const callerLine: string = errorStack.split('\n')[5]; // Adjust based on your stack trace
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

    static setControllerRoutes(controller: Object, routes: ControllerRouteConfiguration[]): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_ROUTES, routes, controller);
    }

    static getControllerRoutes(controller: Object): ControllerRouteConfiguration[] {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_ROUTES, controller) ?? [];
    }

    static setRouteResponses(controller: Object, data: OpenApiResponse[], controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_RESPONSES, data, controller, controllerMethod);
    }

    static getRouteResponses(controller: Object, controllerMethod: string): OpenApiResponse[] {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_RESPONSES, controller, controllerMethod) ?? [];
    }

    static setControllerBaseRoute(controller: Object, baseRoute: Route): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_BASE_ROUTE, baseRoute, controller);
    }

    static getControllerBaseRoute(controller: Object): Route | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_BASE_ROUTE, controller);
    }

    static setRoutePathParams(controller: Object, params: Record<number, PathParamMetadata>, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_PATH_PARAMS, params, controller, controllerMethod);
    }

    static getRoutePathParams(controller: Object, controllerMethod: string): Record<number, PathParamMetadata> {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_PATH_PARAMS, controller, controllerMethod) ?? {};
    }

    static setRouteQueryParams(controller: Object, params: Record<number, QueryParamMetadata>, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_QUERY_PARAMS, params, controller, controllerMethod);
    }

    static getRouteQueryParams(controller: Object, controllerMethod: string): Record<number, QueryParamMetadata> {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_QUERY_PARAMS, controller, controllerMethod) ?? {};
    }

    static setRouteHeaderParams(controller: Object, params: Record<number, HeaderParamMetadata>, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_HEADER_PARAMS, params, controller, controllerMethod);
    }

    static getRouteHeaderParams(controller: Object, controllerMethod: string): Record<number, HeaderParamMetadata> {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_HEADER_PARAMS, controller, controllerMethod) ?? {};
    }

    static setRouteBody(controller: Object, body: BodyMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_BODY, body, controller, controllerMethod);
    }

    static getRouteBody(controller: Object, controllerMethod: string): BodyMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_BODY, controller, controllerMethod);
    }

    static setRouteCurrentUser(controller: Object, body: CurrentUserMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_CURRENT_USER, body, controller, controllerMethod);
    }

    static getRouteCurrentUser(controller: Object, controllerMethod: string): CurrentUserMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_CURRENT_USER, controller, controllerMethod);
    }

    static setRouteIsLoggedIn(controller: Object, data: IsLoggedInMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_IS_LOGGED_IN, data, controller, controllerMethod);
    }

    static getRouteIsLoggedIn(controller: Object, controllerMethod: string): IsLoggedInMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_IS_LOGGED_IN, controller, controllerMethod);
    }

    static setRouteSkipIsLoggedIn(controller: Object, data: SkipIsLoggedInMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_IS_LOGGED_IN, data, controller, controllerMethod);
    }

    static getRouteSkipIsLoggedIn(controller: Object, controllerMethod: string): SkipIsLoggedInMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_SKIP_IS_LOGGED_IN, controller, controllerMethod);
    }

    static setControllerIsLoggedIn(controller: Object, data: IsLoggedInMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_IS_LOGGED_IN, data, controller);
    }

    static getControllerIsLoggedIn(controller: Object): IsLoggedInMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_IS_LOGGED_IN, controller);
    }

    static setControllerSkipIsLoggedIn(controller: Object, data: SkipIsLoggedInMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_IS_LOGGED_IN, data, controller);
    }

    static getControllerSkipIsLoggedIn(controller: Object): SkipIsLoggedInMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_IS_LOGGED_IN, controller);
    }

    static setRouteHasRole(controller: Object, data: HasRoleMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_HAS_ROLE, data, controller, controllerMethod);
    }

    static getRouteHasRole(controller: Object, controllerMethod: string): HasRoleMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_HAS_ROLE, controller, controllerMethod);
    }

    static setRouteSkipHasRole(controller: Object, data: SkipHasRoleMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_HAS_ROLE, data, controller, controllerMethod);
    }

    static getRouteSkipHasRole(controller: Object, controllerMethod: string): SkipHasRoleMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_SKIP_HAS_ROLE, controller, controllerMethod);
    }

    static setControllerHasRole(controller: Object, data: HasRoleMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_HAS_ROLE, data, controller);
    }

    static getControllerHasRole(controller: Object): HasRoleMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_HAS_ROLE, controller);
    }

    static setControllerSkipHasRole(controller: Object, data: SkipHasRoleMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_ROLE, data, controller);
    }

    static getControllerSkipHasRole(controller: Object): SkipHasRoleMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_HAS_ROLE, controller);
    }

    static setRouteBelongsTo<T extends Newable<BaseEntity>>(
        controller: Object,
        data: BelongsToMetadata<T>,
        controllerMethod: string
    ): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_BELONGS_TO, data, controller, controllerMethod);
    }

    static getRouteBelongsTo<T extends Newable<BaseEntity>>(
        controller: Object,
        controllerMethod: string
    ): BelongsToMetadata<T> | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_BELONGS_TO, controller, controllerMethod);
    }

    static setRouteSkipBelongsTo(controller: Object, data: SkipBelongsToMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_BELONGS_TO, data, controller, controllerMethod);
    }

    static getRouteSkipBelongsTo(controller: Object, controllerMethod: string): SkipBelongsToMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_SKIP_BELONGS_TO, controller, controllerMethod);
    }

    static setControllerBelongsTo<T extends Newable<BaseEntity>>(controller: Object, data: BelongsToMetadata<T>): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_BELONGS_TO, data, controller);
    }

    static getControllerBelongsTo<T extends Newable<BaseEntity>>(controller: Object): BelongsToMetadata<T> | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_BELONGS_TO, controller);
    }

    static setControllerSkipBelongsTo(controller: Object, data: SkipBelongsToMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_BELONGS_TO, data, controller);
    }

    static getControllerSkipBelongsTo(controller: Object): SkipBelongsToMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_BELONGS_TO, controller);
    }

    static setRouteSkipAuth(controller: Object, data: SkipAuthMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_AUTH, data, controller, controllerMethod);
    }

    static getRouteSkipAuth(controller: Object, controllerMethod: string): SkipAuthMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_SKIP_AUTH, controller, controllerMethod);
    }

    static setModelProperties(model: Newable<unknown>, metadata: Record<string, PropertyMetadata>): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.MODEL_PROPERTIES, metadata, model);
    }

    static getModelProperties(model: Newable<unknown>): Record<string, PropertyMetadata> {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.MODEL_PROPERTIES, model) ?? {};
    }

    static setEntityMetadata(entity: Newable<unknown>, metadata: EntityMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ENTITY_METADATA, metadata, entity);
    }

    static getEntityMetadata(entity: Newable<unknown>): EntityMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.ENTITY_METADATA, entity);
    }

    static setRouteIsNotLoggedIn(controller: Object, data: IsNotLoggedInMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_IS_NOT_LOGGED_IN, data, controller, controllerMethod);
    }

    static getRouteIsNotLoggedIn(controller: Object, controllerMethod: string): IsNotLoggedInMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_IS_NOT_LOGGED_IN, controller, controllerMethod);
    }

    static setRouteSkipIsNotLoggedIn(controller: Object, data: SkipIsNotLoggedInMetadata, controllerMethod: string): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.ROUTE_SKIP_IS_NOT_LOGGED_IN, data, controller, controllerMethod);
    }

    static getRouteSkipIsNotLoggedIn(controller: Object, controllerMethod: string): SkipIsNotLoggedInMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.ROUTE_SKIP_IS_NOT_LOGGED_IN, controller, controllerMethod);
    }

    static setControllerIsNotLoggedIn(controller: Object, data: IsNotLoggedInMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_IS_NOT_LOGGED_IN, data, controller);
    }

    static getControllerIsNotLoggedIn(controller: Object): IsNotLoggedInMetadata | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_IS_NOT_LOGGED_IN, controller);
    }

    static setControllerSkipIsNotLoggedIn(controller: Object, data: SkipIsNotLoggedInMetadata): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_IS_NOT_LOGGED_IN, data, controller);
    }

    static getControllerSkipIsNotLoggedIn(controller: Object): SkipIsNotLoggedInMetadata | undefined {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.CONTROLLER_SKIP_IS_NOT_LOGGED_IN, controller);
    }
}