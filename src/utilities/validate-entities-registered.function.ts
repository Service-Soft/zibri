import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { inject } from '../di/inject.function';
import type { BaseEntity } from '../entity/base-entity.model';
import { MissingEntitiesError } from '../error-handling/errors/missing-entities.error';
import { GlobalRegistry } from '../global/global-registry';
import { Newable } from '../types/newable.type';

/**
 * Validates that the given entities are registered in a data source somewhere.
 * @param context - The name of the class where this function was called. Is needed to provide information about who expects the entities to exist.
 * @param entities - The entities that should be validated to be registered.
 * @throws When one of the entities is not registered in a data source.
 */
export function validateEntitiesRegistered(context: string, ...entities: Newable<BaseEntity>[]): void {
    const entitiesInDataSources: Newable<BaseEntity>[] = [];
    for (const dataSourceClass of GlobalRegistry.dataSourceClasses) {
        const dataSource: DataSourceInterface = inject(dataSourceClass);
        entitiesInDataSources.push(...dataSource.entities);
    }
    const missingEntities: Newable<BaseEntity>[] = entities.filter(e => !entitiesInDataSources.includes(e));
    if (missingEntities.length) {
        throw new MissingEntitiesError(context, missingEntities);
    }
}