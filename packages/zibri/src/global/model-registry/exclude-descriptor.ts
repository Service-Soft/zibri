import { ModelDescriptor } from './model-descriptor';
import { ModelRegistry } from './model.registry';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { ExcludePropertyValue } from '../../entity/models/base-property-metadata.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

/**
 * A descriptor that keeps track of the exclude properties of an entity.
 */
export class ExcludeDescriptor<T> extends ModelDescriptor<ExcludeDescriptor<unknown>> {
    /**
     * Keys that have a exclude value of true or function.
     */
    readonly keys: Map<string, ExcludeStrict<ExcludePropertyValue, false>> = new Map();

    /**
     * Updates this descriptor by the properties of the given class.
     * @param entityClass - The class to get the exclude properties from.
     */
    update(entityClass: Newable<T>): void {
        this.keys.clear();
        this.nestedKeys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);

        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            if (metadata.exclude !== undefined && metadata.exclude !== false) {
                this.keys.set(key, metadata.exclude);
                continue;
            }
            this.updateNestedKey(key, metadata, cls => ModelRegistry.get(cls).excludeDescriptor);
        }
    }
}