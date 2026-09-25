import { DataSourceInterface } from './data-sources/data-source.interface';
import { getAmbiguousRepositoryDataSources, repositoryTokenFor, setAmbiguousRepositoryTokens } from '../di/decorators/inject-repository.decorator';
import { register } from '../di/register.function';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { EntityMetadataMissingError } from '../entity/entity-metadata-missing.error';
import { InternalError } from '../error-handling/internal-error.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';

/**
 * A data source together with the class it was registered with.
 */
export type RegisteredDataSource = {
    /**
     * The class of the data source, which is what a repository token is qualified with.
     */
    dataSourceClass: Newable<DataSourceInterface>,
    /**
     * The instance of the data source.
     */
    dataSource: DataSourceInterface
};

/**
 * Determines which entity belongs to which data source.
 *
 * This has to run before any data source is initialized, because a single data source cannot know
 * whether one of its entities is also part of another one. Entities that belong to multiple data
 * sources are recorded as ambiguous, which keeps their unqualified repository token unregistered.
 * @param dataSources - All data sources of the app.
 * @throws When an entity is part of multiple data sources without allowing it.
 */
// eslint-disable-next-line sonar/cognitive-complexity
export function resolveEntityOwnership(dataSources: RegisteredDataSource[]): void {
    const owners: Map<Newable<BaseEntity>, Newable<DataSourceInterface>[]> = new Map();

    for (const { dataSourceClass, dataSource } of dataSources) {
        for (const entity of dataSource.entities) {
            const current: Newable<DataSourceInterface>[] = owners.get(entity) ?? [];
            // an entity that is listed twice in the same data source is still owned by just that one
            if (!current.includes(dataSourceClass)) {
                owners.set(entity, [...current, dataSourceClass]);
            }
        }
    }

    for (const [entity, owningDataSources] of owners) {
        if (owningDataSources.length === 1) {
            continue;
        }
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entity);
        if (!metadata) {
            throw new EntityMetadataMissingError(entity);
        }
        if (!metadata.allowDuplicate) {
            throw new InternalError([
                `The entity "${entity.name}" is part of multiple data sources `
                + `(${owningDataSources.map(d => d.name).join(', ')}).`,
                'Set "allowDuplicate" on its @Entity decorator if that is intended,',
                'otherwise remove it from all but one of the data sources.'
            ]);
        }
    }

    // the unqualified token of a duplicated entity stays unregistered on purpose: registering a
    // provider that throws would break every sweep that instantiates all registered tokens, so the
    // ambiguity is only recorded here and reported by the resulting "no provider" error
    const ambiguousTokens: Record<string, string[]> = {};
    for (const [entity, owningDataSources] of owners) {
        if (owningDataSources.length > 1) {
            ambiguousTokens[`Repository<${entity.name}>`] = owningDataSources.map(d => d.name);
        }
    }
    setAmbiguousRepositoryTokens(ambiguousTokens);
}

/**
 * Registers the repository providers of a single data source.
 *
 * Called by every data source while it initializes, so that a data source that is initialized on its
 * own (without going through the DataSourceService) also has working repositories.
 *
 * The token qualified with the data source is always registered. The unqualified one is only
 * registered when the entity is not known to be part of multiple data sources, which is what makes
 * `@InjectRepository(Entity)` work without naming a data source in the common case.
 * @param dataSourceClass - The class of the data source, which the tokens are qualified with.
 * @param dataSource - The data source whose repositories should be registered.
 */
export function registerRepositoryProvidersFor(
    dataSourceClass: Newable<DataSourceInterface>,
    dataSource: DataSourceInterface
): void {
    for (const entity of dataSource.entities) {
        register({
            token: repositoryTokenFor(entity, dataSourceClass),
            useFactory: () => dataSource.getRepository(entity)
        });

        if (!getAmbiguousRepositoryDataSources(`Repository<${entity.name}>`)) {
            register({
                token: repositoryTokenFor(entity),
                useFactory: () => dataSource.getRepository(entity)
            });
        }
    }
}