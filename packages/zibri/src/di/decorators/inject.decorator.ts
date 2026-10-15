
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { DiToken } from '../models/di-token.model';

/**
 * Marks the parameter to be injected.
 * @param token - The token that should be used to inject the parameter.
 */
export function Inject<T>(token: DiToken<T>): ParameterDecorator {
    return (target, _propertyKey, parameterIndex) => {
        MetadataUtilities.setFilePath(target);
        const tokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(target);
        tokens[parameterIndex] = token;
        MetadataUtilities.setInjectParamTokens(target, tokens);
    };
}