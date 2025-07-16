import { NotFoundError } from './not-found.error';

/**
 * An error to throw when a route requested by a user does not exist at all.
 *
 * In contrast to NotFoundError, this should only be thrown the route itself does not exist at all.
 * Eg. /does-not-exist and not when the route itself (eg. Items/:id) exists, but it could not find a value for eg. /items/42.
 */
export class UnmatchedRouteError extends NotFoundError {
    constructor(originalUrl: string, options?: ErrorOptions) {
        super(
            [
                `The route at "${originalUrl}" does not exist.`,
                'You can take a look at the available Routes via the OpenAPI Explorer linked below.'
            ],
            options
        );
        this.name = 'UnmatchedRouteError';
    }
}