import { ModelRegistry } from './model.registry';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { EncryptionPropertyValue } from '../../entity/models/string-property-metadata.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

/**
 * A descriptor that keeps track of the encryption properties of an entity.
 */
export class EncryptionDescriptor<T> {
    /**
     * Keys that have a encryption value of true or function.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    readonly keys: Map<string, ExcludeStrict<EncryptionPropertyValue<any, any, any, any>, false>> = new Map();
    /**
     * Keys with no encrypt option but containing nested entities that might have encrypt properties.
     */
    readonly nestedKeys: Map<string, EncryptionDescriptor<unknown>> = new Map();

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

            switch (metadata.type) {
                case Relation.MANY_TO_ONE:
                case Relation.ONE_TO_ONE:
                case Relation.MANY_TO_MANY:
                case Relation.ONE_TO_MANY: {
                    const nested: EncryptionDescriptor<unknown> = ModelRegistry.get(metadata.target()).encryptionDescriptor;
                    if (nested.hasAnything()) {
                        this.nestedKeys.set(key, nested);
                    }
                    break;
                }

                case 'object': {
                    const nested: EncryptionDescriptor<unknown> = ModelRegistry.get(metadata.cls()).encryptionDescriptor;
                    if (nested.hasAnything()) {
                        this.nestedKeys.set(key, nested);
                    }
                    break;
                }

                case 'array': {
                    const nested: EncryptionDescriptor<unknown> | undefined = this.buildEncryptDescriptorForArrayItems(metadata.items);
                    if (nested?.hasAnything() === true) {
                        this.nestedKeys.set(key, nested);
                    }
                    break;
                }

                case 'string':
                case 'number':
                case 'boolean':
                case 'date':
                case 'file':
                case 'unknown': {
                    break;
                }
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Whether or not there are even properties somewhere that have a encrypt property.
     */
    hasAnything(): boolean {
        return this.keys.size > 0 || this.nestedKeys.size > 0;
    }

    private buildEncryptDescriptorForArrayItems(
        items: ArrayPropertyItemMetadata
    ): EncryptionDescriptor<unknown> | undefined {
        switch (items.type) {
            case 'object': {
                return ModelRegistry.get(items.cls()).encryptionDescriptor;
            }
            case 'array': {
                return this.buildEncryptDescriptorForArrayItems(items.items);
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'file':
            case 'unknown': {
                return undefined;
            }
        }
    }
}