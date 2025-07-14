import { BaseEntity } from '../../entity';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { DiToken } from '../models';

/**
 * Gets the repository token for the provided entity class.
 * @param entity - The entity class to resolve the repository token for.
 * @returns The DI token.
 */
export function repositoryTokenFor<T extends BaseEntity>(entity: Newable<T>): string {
    return `Repository<${entity.name}>`;
}

// eslint-disable-next-line jsdoc/require-returns
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