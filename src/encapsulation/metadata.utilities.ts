import { ReflectUtilities } from './reflect.utilities';
import { DiToken } from '../di';
import { Route, ControllerRouteConfiguration, PathParamMetadata, BodyMetadata, QueryParamMetadata, HeaderParamMetadata } from '../routing';
import { MetadataInjectionKeys } from './metadata-injection-keys.enum';
import { PropertyMetadata } from '../entity';

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

    static setInjectParamTokens(tokens: Record<number, DiToken<unknown>>, target: Object): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_TOKENS, tokens, target);
    }

    static getInjectParamTokens(target: Object): Record<number, DiToken<unknown>> {
        return ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.DI_INJECT_PARAM_TOKENS, target) ?? {};
    }

    static setControllerRoutes(routes: ControllerRouteConfiguration[], target: Object): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_ROUTES, routes, target);
    }

    static getControllerRoutes(target: Object): ControllerRouteConfiguration[] {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_ROUTES, target) ?? [];
    }

    static setControllerBaseRoute(baseRoute: Route, target: Object): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.CONTROLLER_BASE_ROUTE, baseRoute, target);
    }

    static getControllerBaseRoute(target: Object): Route | undefined {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.CONTROLLER_BASE_ROUTE, target);
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

    static setModelProperties(model: Object, metadata: Record<string, PropertyMetadata>): void {
        ReflectUtilities.setMetadata(MetadataInjectionKeys.MODEL_PROPERTIES, metadata, model);
    }

    static getModelProperties(model: Object): Record<string, PropertyMetadata> {
        return ReflectUtilities.getMetadata(MetadataInjectionKeys.MODEL_PROPERTIES, model) ?? {};
    }
}