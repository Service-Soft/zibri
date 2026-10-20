import { ModelDescriptor } from './model-descriptor.ts';
import { ModelRegistry } from './model.registry.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { DefaultPropertyValue } from '../../entity/models/base-property-metadata.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
type DefaultValue = DefaultPropertyValue<string | number | boolean | Date>;

/**
 * A descriptor that keeps track of the default properties of an entity.
 */
export class DefaultDescriptor extends ModelDescriptor<DefaultDescriptor> {
    /**
     * Keys that have a default value — static or function.
     */
    readonly keys: Map<string, DefaultValue> = new Map();

    /**
     * Updates this descriptor by the properties of the given class.
     * @param entityClass - The class to get the default properties from.
     */
    update(entityClass: Newable<unknown>): void {
        this.keys.clear();
        this.nestedKeys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);

        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            if ('default' in metadata && metadata.default != undefined) {
                this.keys.set(key, metadata.default);
                continue;
            }
            this.updateNestedKey(key, metadata, cls => ModelRegistry.get(cls).defaultDescriptor);
        }
    }
}