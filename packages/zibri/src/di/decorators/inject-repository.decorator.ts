import { DataSourceInterface, RepositoryTypeForEntity } from '../../data-source/data-sources/data-source.interface';
import { Repository } from '../../data-source/repository/repository';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { DiToken } from '../models/di-token.model';
import { InjectionToken } from '../models/injection-token.model';

const allRepositoryTokens: Record<string, DiToken<Repository<BaseEntity>>> = {};

/**
 * The data sources of every entity that is part of more than one of them, keyed by the unqualified
 * repository token of that entity.
 */
let ambiguousRepositoryTokens: Record<string, string[]> = {};

/**
 * Records which entities are part of multiple data sources.
 *
 * Their unqualified repository token is deliberately left unregistered, this is what allows the
 * resulting "no provider" error to explain that the data source has to be named.
 * @param tokens - The names of the owning data sources, keyed by the unqualified repository token.
 */
export function setAmbiguousRepositoryTokens(tokens: Record<string, string[]>): void {
    ambiguousRepositoryTokens = tokens;
}

/**
 * Gets the data sources that an entity belongs to, if it belongs to more than one.
 * @param tokenKey - The key of the unqualified repository token.
 * @returns The names of the owning data sources, or undefined when the entity is not duplicated.
 */
export function getAmbiguousRepositoryDataSources(tokenKey: string): string[] | undefined {
    return ambiguousRepositoryTokens[tokenKey];
}

/**
 * Gets the repository token for the provided entity class.
 *
 * An entity that belongs to exactly one data source can be resolved without naming that data source.
 * As soon as the same entity is part of multiple data sources (which requires the allowDuplicate flag
 * on the entity), the data source has to be provided, because the entity alone is ambiguous.
 * @param entity - The entity class to resolve the repository token for.
 * @param dataSource - The data source that the repository should belong to.
 * @returns The DI token.
 */
export function repositoryTokenFor<T extends Newable<BaseEntity>>(
    entity: T,
    dataSource?: Newable<DataSourceInterface>
): DiToken<RepositoryTypeForEntity<InstanceType<T>>> {
    const key: string = dataSource ? `Repository<${entity.name}>@${dataSource.name}` : `Repository<${entity.name}>`;
    allRepositoryTokens[key] ??= new InjectionToken(key);
    return allRepositoryTokens[key] as DiToken<RepositoryTypeForEntity<InstanceType<T>>>;
}

/**
 * Marks the parameter to be injected as a Repository of the provided class.
 * @param entityClass - The class of which the Repository should be injected.
 * @param dataSourceClass - The data source to get the repository from.
 * Only needed when the entity is part of multiple data sources.
 */
export function InjectRepository<T extends BaseEntity>(
    entityClass: Newable<T>,
    dataSourceClass?: Newable<DataSourceInterface>
): ParameterDecorator {
    return (target, _propertyKey, parameterIndex) => {
        MetadataUtilities.setFilePath(target);
        const tokens: Record<number, DiToken<unknown>> = MetadataUtilities.getInjectParamTokens(target);
        tokens[parameterIndex] = repositoryTokenFor(entityClass, dataSourceClass);
        MetadataUtilities.setInjectParamTokens(target, tokens);
    };
}