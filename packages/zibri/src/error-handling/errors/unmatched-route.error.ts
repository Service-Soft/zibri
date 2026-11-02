import { NotFoundError } from './not-found.error';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when a route requested by a user does not exist at all.
 *
 * In contrast to NotFoundError, this should only be thrown the route itself does not exist at all.
 * Eg. /does-not-exist and not when the route itself (eg. Items/:id) exists, but it could not find a value for eg. /items/42.
 */
export class UnmatchedRouteError extends NotFoundError {
    constructor(originalUrl: string, options?: ErrorOptions) {
        // the route alone: the explorer is the application's to point at, and an error page that links
        // it does so itself
        super($ts`The route at "${originalUrl}" does not exist.`, options);
        this.name = 'UnmatchedRouteError';
    }
}