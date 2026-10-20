import { ResolvedAuthMetadata } from './resolved-auth-metadata.model.ts';

/**
 * What a manually registered route says about who may reach it.
 *
 * The same checks the \@Auth decorators express, in the form a configuration object can carry: a
 * route registered through `registerRoute` has no class and no method for a decorator to sit on, so
 * it has to state its posture as data.
 *
 * A route that states nothing is treated exactly like a controller route carrying no decorators, so
 * the application's `defaultAuth` decides - which is the whole point of a default. `skip` is how a
 * route opts out of that, the way \@Auth.skip does for a decorated one.
 */
export type RouteAuthConfiguration = Partial<ResolvedAuthMetadata> & {
    /**
     * Whether this route is reachable without a login even where the application requires one.
     *
     * Say this only for a route that is meant to answer an anonymous caller whatever the deployment
     * decided - a favicon a browser fetches without credentials, a health check a load balancer
     * polls. Everything else is better left to `defaultAuth`.
     */
    skip?: boolean
};