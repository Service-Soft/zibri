import { ModelDescriptor } from './model-descriptor.ts';
import { ModelRegistry } from './model.registry.ts';
import { StringValueDescriptor } from './string-value-descriptor.model.ts';
import { StringValueUtilities } from './string-value.utilities.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { StoredHashPropertyValue } from '../../entity/models/string-property-metadata.model.ts';
import { ExcludeStrict } from '../../types/exclude-strict.type.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';

/**
 * The hash settings of one string, when it has any.
 */
export type HashSettings = ExcludeStrict<StoredHashPropertyValue, false>;

/**
 * A descriptor that keeps track of the hash properties of an entity.
 */
export class HashDescriptor<T> extends ModelDescriptor<HashDescriptor<unknown>> {
    /**
     * Keys whose value holds hashed strings, and where in the value they sit.
     */
    readonly keys: Map<string, StringValueDescriptor<HashSettings>> = new Map();

    /**
     * Updates this descriptor by the properties of the given class.
     * @param entityClass - The class to get the hash properties from.
     */
    update(entityClass: Newable<T>): void {
        this.keys.clear();
        this.nestedKeys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);

        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            const strings: StringValueDescriptor<HashSettings> | undefined = StringValueUtilities.resolveDescriptor(
                metadata,
                m => m.hash === false ? undefined : m.hash
            );
            if (strings != undefined) {
                this.keys.set(key, strings);
            }
            // as well rather than instead, for the reason the encryption descriptor gives
            this.updateNestedKey(key, metadata, cls => ModelRegistry.get(cls).hashDescriptor);
        }
    }
}