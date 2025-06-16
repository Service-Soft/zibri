import { BadRequestError } from '../../error-handling';
import { QueryParamMetadata } from '../../routing';

export function parseArray(rawValue: unknown, meta: QueryParamMetadata): unknown {
    if (rawValue == undefined || typeof rawValue !== 'string') {
        return rawValue;
    }

    try {
        return JSON.parse(rawValue);
    }
    catch {
        throw new BadRequestError(`invalid JSON in query param "${meta.name}"`);
    }
}