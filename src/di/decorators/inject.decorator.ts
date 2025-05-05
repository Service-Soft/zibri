import { MetadataUtilities } from '../../encapsulation';
import { DiToken } from '../di-token.model';

export type InjectOptions = {
    optional?: boolean
};

export function Inject<T>(token: DiToken<T>, options: InjectOptions = {}): ParameterDecorator {
    return (target, _propertyKey, parameterIndex) => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        const existingTokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(target);
        existingTokens[parameterIndex] = token;
        MetadataUtilities.setInjectParamTokens(existingTokens, target);

        const existingOpts: Record<number, InjectOptions> = MetadataUtilities.getInjectParamOptions(target);
        existingOpts[parameterIndex] = options;
        MetadataUtilities.setInjectParamOptions(existingOpts, target);
    };
}