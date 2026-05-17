import { ModelRegistry } from './model.registry';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { HashPropertyValue } from '../../entity/models/string-property-metadata.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

/**
 * A descriptor that keeps track of the hash properties of an entity.
 */
export class HashDescriptor<T> {
    /**
     * Keys that have a hash value of true or function.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    readonly keys: Map<string, ExcludeStrict<HashPropertyValue<any, any>, false>> = new Map();
    /**
     * Keys with no hash option but containing nested entities that might have hash properties.
     */
    readonly nestedKeys: Map<string, HashDescriptor<unknown>> = new Map();

    /**
     * Updates this descriptor by the properties of the given class.
     * @param entityClass - The class to get the hash properties from.
     */
    update(entityClass: Newable<T>): void {
        this.keys.clear();
        this.nestedKeys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);

        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            if (('hash' in metadata) && metadata.hash !== undefined && metadata.hash !== false) {
                this.keys.set(key, metadata.hash);
                continue;
            }

            switch (metadata.type) {
                case Relation.MANY_TO_ONE:
                case Relation.HAS_ONE:
                case Relation.BELONGS_TO_ONE:
                case Relation.MANY_TO_MANY:
                case Relation.ONE_TO_MANY: {
                    const nested: HashDescriptor<unknown> = ModelRegistry.get(metadata.target()).hashDescriptor;
                    if (nested.hasAnything()) {
                        this.nestedKeys.set(key, nested);
                    }
                    break;
                }

                case 'object': {
                    const nested: HashDescriptor<unknown> = ModelRegistry.get(metadata.cls()).hashDescriptor;
                    if (nested.hasAnything()) {
                        this.nestedKeys.set(key, nested);
                    }
                    break;
                }

                case 'array': {
                    const nested: HashDescriptor<unknown> | undefined = this.buildHashDescriptorForArrayItems(metadata.items);
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
     * Whether or not there are even properties somewhere that have a hash property.
     */
    hasAnything(): boolean {
        return this.keys.size > 0 || this.nestedKeys.size > 0;
    }

    private buildHashDescriptorForArrayItems(
        items: ArrayPropertyItemMetadata
    ): HashDescriptor<unknown> | undefined {
        switch (items.type) {
            case 'object': {
                return ModelRegistry.get(items.cls()).hashDescriptor;
            }
            case 'array': {
                return this.buildHashDescriptorForArrayItems(items.items);
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