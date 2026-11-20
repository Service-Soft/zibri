import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { holdsPlainValue } from '../../routing/filter/holds-plain-value.function';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { ModelDescriptor } from './model-descriptor';
import { ModelRegistry } from './model.registry';

/**
 * The types of the properties that hold one value a list can be ordered by.
 */
const ORDERABLE_TYPES: readonly string[] = ['string', 'number', 'boolean', 'date'];

/**
 * Whether a list can be ordered by a property: a string, number, boolean or date that holds its value as it is.
 * @param metadata - The property.
 * @returns True when a list can be ordered by it.
 */
export function isOrderable(metadata: PropertyMetadata): boolean {
    return ORDERABLE_TYPES.includes(metadata.type) && holdsPlainValue(metadata);
}

/**
 * A descriptor that keeps track of what a list of a class can be ordered by without a config: its orderable
 * properties, and those of the objects inside it. A relation is not followed, as ordering through one reads it.
 */
export class OrderDescriptor extends ModelDescriptor<OrderDescriptor> {
    /**
     * The properties a list can be ordered by.
     */
    readonly keys: Map<string, PropertyMetadata> = new Map();

    /**
     * Updates this descriptor by the properties of the given class.
     * @param entityClass - The class to get the orderable properties from.
     */
    update(entityClass: Newable<unknown>): void {
        this.keys.clear();
        this.nestedKeys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);

        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            if (isOrderable(metadata)) {
                this.keys.set(key, metadata);
                continue;
            }
            if (metadata.type === 'object' && metadata.exclude === false) {
                this.updateNestedKey(key, metadata, cls => ModelRegistry.get(cls).orderDescriptor);
            }
        }
    }
}