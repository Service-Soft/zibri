/**
 * The base error class for anything internal that does NOT leave the server.
 */
export class InternalError extends Error {
    /**
     * Whether or not this error is internal or visible from the outside.
     */
    readonly isInternal: true = true;

    // not named "message": an array of lines is joined into the message, never handed over as one
    constructor(lines: string | string[], options?: ErrorOptions) {
        const singleString: string = typeof lines === 'string' ? lines : lines.join('\n');
        super(singleString, options);
        this.name = 'InternalError';
    }
}