/**
 * The base error class for anything internal that does NOT leave the server.
 */
export class InternalError extends Error {
    /**
     * Whether or not this error is internal or visible from the outside.
     */
    readonly isInternal: true = true;

    constructor(message: string | string[], options?: ErrorOptions) {
        const singleString: string = typeof message === 'string' ? message : message.join('\n');
        super(singleString, options);
        this.name = 'InternalError';
    }
}