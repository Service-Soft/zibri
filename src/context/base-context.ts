/**
 * The base context that any context needs to extend from.
 */
export abstract class BaseContext<T> {
    abstract readonly type: T;
    /**
     * The cached token values.
     */
    protected readonly tokenValues: Map<string, unknown> = new Map();
}