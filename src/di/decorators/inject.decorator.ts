import { MetadataUtilities } from '../../utilities';
import { DiToken } from '../models';

export function Inject<T>(token: DiToken<T>): ParameterDecorator {
    return (target, _propertyKey, parameterIndex) => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        const tokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(target);
        tokens[parameterIndex] = token;
        MetadataUtilities.setInjectParamTokens(target, tokens);
    };
}