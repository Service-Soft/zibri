import { isError } from './is-error.function';

// eslint-disable-next-line jsdoc/require-jsdoc
export function unknownToErrorString(error: unknown): string {
    if (isError(error)) {
        return error.message;
    }

    return JSON.stringify(error);
}