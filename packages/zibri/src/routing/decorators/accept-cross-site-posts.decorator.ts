import { AcceptCrossSitePostsOptions } from './accept-cross-site-posts-options.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';

/**
 * Lets pages on the given origins send the route a request with cookies, which is otherwise refused
 * with `403` for any request that changes something.
 *
 * For a route another site sends the browser to with a form on purpose, like an identity provider
 * answering a sign-in. Only that route, and only those origins.
 * @param options - The origins.
 * @returns The decorator.
 * @throws When the origins are a list that is empty, or holds something that is not an origin.
 */
export function AcceptCrossSitePosts(options: AcceptCrossSitePostsOptions): MethodDecorator {
    if (Array.isArray(options.acceptedOrigins)) {
        validateOrigins(options.acceptedOrigins);
    }
    return (target, propertyKey) => {
        MetadataUtilities.setRouteAcceptCrossSitePosts(target.constructor, options, propertyKey.toString());
    };
}

/**
 * Refuses a list of origins that is empty or holds something other than an origin.
 * @param origins - The origins.
 * @throws When one of them is not an origin, or there are none.
 */
function validateOrigins(origins: string[]): void {
    if (!origins.length) {
        throw new InternalError('@AcceptCrossSitePosts needs at least one origin.');
    }
    for (const origin of origins) {
        // an origin is exactly what a url's origin is: scheme, host and port, nothing more. `null`
        // is what a browser sends when it will not say, so it names no page in particular
        if (!URL.canParse(origin) || new URL(origin).origin !== origin) {
            throw new InternalError(`@AcceptCrossSitePosts: "${origin}" is not an origin, like https://provider.example.com.`);
        }
    }
}