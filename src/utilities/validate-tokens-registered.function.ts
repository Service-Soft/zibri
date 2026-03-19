import { ObjectUtilities } from './object.utilities';
import { inject } from '../di/inject.function';
import { DiToken, TokenRecord } from '../di/models/di-token.model';
import { MissingTokensError } from '../error-handling/errors/missing-tokens.error';

/**
 * Validates that the tokens from the given record are registered and available for injection.
 * @param context - The name of the class where this function was called. Is needed to provide information about who expects the tokens to exist.
 * @param record
 * @throws When one of the entities is not registered in a data source.
 */
export function validateTokensRegistered(context: string, record: TokenRecord): void {
    const missingTokens: DiToken<unknown>[] = [];
    for (const token of ObjectUtilities.values(record)) {
        try {
            inject(token);
        }
        catch (error) {
            missingTokens.push(token);
        }
    }
    if (missingTokens.length) {
        throw new MissingTokensError(context, missingTokens);
    }
}