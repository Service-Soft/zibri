import { SupportedVersionsOptions } from './supported-versions-options.model';

/**
 * Defines a route identified by a key with their respective versions.
 */
export type RouteWithVersionData = {
    /**
     * The supported versions of the route.
     */
    versions: SupportedVersionsOptions,
    /**
     * The key that identifies the route.
     */
    key: string
};