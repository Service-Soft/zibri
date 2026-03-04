import { Repository } from '../../data-source/repository';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { DiToken } from '../models/di-token.model';
import { InjectionToken } from '../models/injection-token.model';

const allRepositoryTokens: Record<string, DiToken<Repository<BaseEntity>>> = {};

/**
 * Gets the repository token for the provided entity class.
 * @param entity - The entity class to resolve the repository token for.
 * @returns The DI token.
 */
export function repositoryTokenFor<T extends Newable<BaseEntity>>(entity: T): DiToken<Repository<InstanceType<T>>> {
    const key: string = `Repository<${entity.name}>`;
    allRepositoryTokens[key] ??= new InjectionToken(key);
    return allRepositoryTokens[key] as DiToken<Repository<InstanceType<T>>>;
}

/**
 * Marks the parameter to be injected as a Repository of the provided class.
 * @param entityClass - The class of which the Repository should be injected.
 */
export function InjectRepository<T extends BaseEntity>(entityClass: Newable<T>): ParameterDecorator {
    return (target, _propertyKey, parameterIndex) => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        const tokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(target);
        tokens[parameterIndex] = repositoryTokenFor(entityClass);
        MetadataUtilities.setInjectParamTokens(target, tokens);
    };
}