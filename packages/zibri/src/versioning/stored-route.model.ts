import { type VersionMatcher } from './supported-versions-options.model.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { type OneOf } from '../entity/models/one-of.model.ts';

/**
 * The versions a route in a version file supports: every version, or those the matchers match.
 */
export type StoredRouteVersions = OneOf<{
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    All: 'all',
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    Matchers: VersionMatcher[]
}>;

/**
 * A route as a version file holds it, identified by its key, with the versions it supported.
 */
export class StoredRoute {
    /**
     * The supported versions of the route.
     */
    @Property.oneOf({
        shapes: {
            All: { type: 'string', enum: { all: 'all' } },
            Matchers: { type: 'array', items: { type: 'string' } }
        }
    })
    versions!: StoredRouteVersions;
    /**
     * The key that identifies the route.
     */
    @Property.string()
    key!: string;
}