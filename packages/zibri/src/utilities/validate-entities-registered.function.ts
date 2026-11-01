import { RequiredEntities } from './required-entities.model';
import type { ZibriApplication } from '../application/application';
import type { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';

/**
 * Validates that the given entities are registered in a data source somewhere.
 *
 * While the application initializes, every entity asked for is validated together once it is done, so a
 * boot is refused once for every entity it lacks, each with what requires it. Asked for once the
 * application is up, the entities are validated at once.
 * @param context - The name of the class where this function was called. Is needed to provide information about who expects the entities to exist.
 * @param app - The zibri application.
 * @param entities - The entities that should be validated to be registered.
 * @throws When the application is up and one of the entities is not registered in a data source.
 */
export function validateEntitiesRegistered(context: string, app: ZibriApplication, ...entities: Newable<BaseEntity>[]): void {
    RequiredEntities.of(app).add(context, entities);
}
