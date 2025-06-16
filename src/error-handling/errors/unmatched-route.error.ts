import { NotFoundError } from './not-found.error';

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