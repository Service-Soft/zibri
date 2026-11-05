import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { ModelRegistry } from '../../global/model-registry/model.registry';
import { Newable } from '../../types/newable.type';

/**
 * An entity that holds encrypted values, and the repository that reads it.
 */
export type EncryptedEntity = {
    /**
     * The entity class.
     */
    entityClass: Newable<BaseEntity>,
    /**
     * The repository for it, from the data source that holds it.
     */
    repository: Repository<BaseEntity>
};

/**
 * Resolves every entity of the given data sources that can hold an encrypted value.
 * @param dataSources - The data sources of the application.
 * @returns Each such entity, with the repository of the data source that holds it.
 */
export function resolveEncryptedEntities(dataSources: Newable<DataSourceInterface>[]): EncryptedEntity[] {
    return dataSources.flatMap(dataSourceClass => {
        const dataSource: DataSourceInterface = inject(dataSourceClass);
        return dataSource.entities
            .filter(entityClass => ModelRegistry.get(entityClass).encryptionDescriptor.hasAnything())
            .map(entityClass => ({ entityClass, repository: inject(repositoryTokenFor(entityClass, dataSourceClass)) }));
    });
}