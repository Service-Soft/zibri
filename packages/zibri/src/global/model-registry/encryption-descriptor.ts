import { ModelDescriptor } from './model-descriptor.ts';
import { ModelRegistry } from './model.registry.ts';
import { StringValueDescriptor } from './string-value-descriptor.model.ts';
import { StringValueUtilities } from './string-value.utilities.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { StoredEncryptionPropertyValue } from '../../entity/models/string-property-metadata.model.ts';
import { ExcludeStrict } from '../../types/exclude-strict.type.ts';
import { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';

/**
 * The encryption settings of one string, when it has any.
 */
export type EncryptionSettings = ExcludeStrict<StoredEncryptionPropertyValue, false>;

/**
 * A descriptor that keeps track of the encryption properties of an entity.
 */
export class EncryptionDescriptor<T> extends ModelDescriptor<EncryptionDescriptor<unknown>> {
    /**
     * Keys whose value holds encrypted strings, and where in the value they sit.
     */
    readonly keys: Map<string, StringValueDescriptor<EncryptionSettings>> = new Map();

    /**
     * Updates this descriptor by the properties of the given class.
     * @param entityClass - The class to get the encrypt properties from.
     */
    update(entityClass: Newable<T>): void {
        this.keys.clear();
        this.nestedKeys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);

        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            const strings: StringValueDescriptor<EncryptionSettings> | undefined = StringValueUtilities.resolveDescriptor(
                metadata,
                m => m.encryption === false ? undefined : m.encryption
            );
            if (strings != undefined) {
                this.keys.set(key, strings);
            }
            // as well rather than instead: a value of several shapes can hold an encrypted string in one
            // shape and a model with encrypted properties of its own in another
            this.updateNestedKey(key, metadata, cls => ModelRegistry.get(cls).encryptionDescriptor);
        }
    }
}