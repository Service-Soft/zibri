import { ModelDescriptor } from './model-descriptor';
import { ModelRegistry } from './model.registry';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { EncryptionPropertyValue } from '../../entity/models/string-property-metadata.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

/**
 * A descriptor that keeps track of the encryption properties of an entity.
 */
export class EncryptionDescriptor<T> extends ModelDescriptor<EncryptionDescriptor<unknown>> {
    /**
     * Keys that have a encryption value of true or function.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    readonly keys: Map<string, ExcludeStrict<EncryptionPropertyValue<any, any, any, any>, false>> = new Map();

    /**
     * Updates this descriptor by the properties of the given class.
     * @param entityClass - The class to get the encrypt properties from.
     */
    update(entityClass: Newable<T>): void {
        this.keys.clear();
        this.nestedKeys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);

        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            if (('encryption' in metadata) && metadata.encryption !== undefined && metadata.encryption !== false) {
                this.keys.set(key, metadata.encryption);
                continue;
            }
            this.updateNestedKey(key, metadata, cls => ModelRegistry.get(cls).encryptionDescriptor);
        }
    }
}