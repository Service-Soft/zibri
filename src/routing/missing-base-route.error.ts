import { getDependencyStackTrace } from '../di/errors/get-dependency-stack-trace.function';

/**
 * An error to throw when a controller was encountered that does not have a base route.
 */
export class MissingBaseRouteError extends Error {
    constructor(controller: Function) {
        super(`Could not find a base route for the controller "${controller.name}"`);
        this.name = 'MissingBaseRouteError';
        this.stack = getDependencyStackTrace(this.name, this.message, [controller]);
    }
}