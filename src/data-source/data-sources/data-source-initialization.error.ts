/**
 * An error to throw when a data source that hasn't been initialized yet is being used.
 */
export class DataSourceInitializationError extends Error {
    constructor() {
        super('The data source needs to be initialized before it can be used.');
        this.name = 'DataSourceInitializationError';
    }
}