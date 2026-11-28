import { type BaseEntity } from '../../entity/base-entity.model';
import { type Newable } from '../../types/newable.type';
import { FrameworkColumnRegistry } from './framework-column.registry';
import { MissingFrameworkColumnError } from './missing-framework-column.error';
import { type MissingFrameworkColumn } from './missing-framework-column.model';

/**
 * Checks for the columns the framework added to its entities, which the database of a data source with
 * `schemaManagement: 'external'` may lack.
 */
export abstract class FrameworkColumnUtilities {
    /**
     * Whether the table of an entity has the columns of the given properties.
     * @param entity - The entity, or one an entity of the application extends, such as `ApiKey`.
     * @param properties - The properties.
     * @returns True when it lacks none of them.
     */
    static hasColumns(entity: Newable<BaseEntity>, ...properties: string[]): boolean {
        return FrameworkColumnRegistry.findMissing(entity, ...properties).length === 0;
    }

    /**
     * Validates that the table of an entity has the columns of the given properties, which a feature needs.
     * @param feature - What needs them, such as `Creating a service account`, for the message.
     * @param entity - The entity, or one an entity of the application extends.
     * @param properties - The properties.
     * @throws A MissingFrameworkColumnError naming the columns that are missing and the statements adding them.
     */
    static validatePresent(feature: string, entity: Newable<BaseEntity>, ...properties: string[]): void {
        const missing: MissingFrameworkColumn[] = FrameworkColumnRegistry.findMissing(entity, ...properties);
        if (missing.length) {
            throw new MissingFrameworkColumnError(feature, missing);
        }
    }
}