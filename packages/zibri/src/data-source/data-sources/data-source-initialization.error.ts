import { InternalError } from '../../error-handling/internal-error.model';

/**
 * An error to throw when a data source that hasn't been initialized yet is being used.
 */
export class DataSourceInitializationError extends InternalError {
    constructor(options?: ErrorOptions) {
        super('The data source needs to be initialized before it can be used.', options);
        this.name = 'DataSourceInitializationError';
    }
}