import { isError } from './is-error.function';

export function unknownToErrorString(error: unknown): string {
    if (isError(error)) {
        return error.message;
    }

    return JSON.stringify(error);
}