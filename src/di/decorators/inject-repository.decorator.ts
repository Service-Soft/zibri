import { BaseEntity } from '../../entity';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { DiToken } from '../models';

export function repositoryTokenFor<T extends BaseEntity>(entity: Newable<T>): string {
    return `Repository<${entity.name}>`;
}

export function InjectRepository<T extends BaseEntity>(entityClass: Newable<T>): ParameterDecorator {
    return (target, _propertyKey, parameterIndex) => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        const tokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(target);
        tokens[parameterIndex] = repositoryTokenFor(entityClass);
        MetadataUtilities.setInjectParamTokens(tokens, target);
    };
}