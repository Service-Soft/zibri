import { isError } from './is-error.function';
import { JsonUtilities } from '../utilities/json.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
export function unknownToErrorString(error: unknown): string {
    if (isError(error)) {
        return error.message;
    }

    return JsonUtilities.stringify(error);
}