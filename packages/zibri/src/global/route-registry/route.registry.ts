import { AuthServiceInterface } from '../../auth/auth-service.interface.ts';
import { ResolvedRouteAuth } from '../../auth/models/resolved-auth-metadata.model.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { resolveRouteParamMetadata, RouteParamMetadata } from '../../routing/route-param-metadata.model.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * Data stored per route in the registry.
 */
export type RouteRegistryData = {
    /**
     * What the parameters of the handler were declared as.
     */
    readonly params: RouteParamMetadata,
    /**
     * What the \@Auth decorators of the route and its controller mean for a caller.
     */
    readonly auth: ResolvedRouteAuth
};

/**
 * Centralized registry for per-route data.
 *
 * A route's declaration is written by decorators, which run once when the module is loaded, so
 * nothing that happens afterwards can change it. Reading it back is neither free - every lookup walks
 * the prototype chain and copies what it finds - nor free of side effects, because resolving what the
 * \@Auth decorators mean is where a declaration nothing can satisfy is refused and where the
 * "Useless @Auth.skip" warnings come from. Both belong to registering a route rather than to serving
 * one.
 */
export abstract class RouteRegistry {
    /**
     * The resolved data per controller, then per route handler.
     *
     * Weak on the controller so a class that goes away takes its routes with it.
     */
    private static readonly cache: WeakMap<Newable<unknown>, Map<string, RouteRegistryData>> = new WeakMap();

    /**
     * Reads what a route declared, resolving it first if nobody has asked before.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The method that handles the route.
     * @returns What the route declared.
     */
    static get(controllerClass: Newable<unknown>, controllerMethod: string): RouteRegistryData {
        return this.routesOf(controllerClass).get(controllerMethod) ?? this.build(controllerClass, controllerMethod);
    }

    /**
     * Resolves what a route declared, discarding anything resolved for it before.
     *
     * Called while the route is being registered. Discarding is what makes a second application in
     * the same process correct rather than merely fast: it may have declared a different default for
     * routes that carry no declaration of their own.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The method that handles the route.
     * @returns What the route declared.
     */
    static register(controllerClass: Newable<unknown>, controllerMethod: string): RouteRegistryData {
        return this.build(controllerClass, controllerMethod);
    }

    /**
     * Resolves a route's declaration and remembers it.
     * @param controllerClass - The controller the route is on.
     * @param controllerMethod - The method that handles the route.
     * @returns What the route declared.
     */
    private static build(controllerClass: Newable<unknown>, controllerMethod: string): RouteRegistryData {
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const data: RouteRegistryData = {
            params: resolveRouteParamMetadata(controllerClass, controllerMethod),
            auth: authService.resolveRouteAuth(controllerClass, controllerMethod)
        };
        this.routesOf(controllerClass).set(controllerMethod, data);
        return data;
    }

    /**
     * The entry a controller's routes are kept in, created on first use.
     * @param controllerClass - The controller to look up.
     * @returns The controller's routes.
     */
    private static routesOf(controllerClass: Newable<unknown>): Map<string, RouteRegistryData> {
        let routes: Map<string, RouteRegistryData> | undefined = this.cache.get(controllerClass);
        if (!routes) {
            routes = new Map();
            this.cache.set(controllerClass, routes);
        }
        return routes;
    }
}