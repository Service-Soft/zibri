import { ModelRegistry } from './model.registry';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model';
import { DefaultPropertyValue } from '../../entity/models/base-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
type DefaultValue = DefaultPropertyValue<string | number | boolean | Date>;

/**
 * A descriptor that keeps track of the default properties of an entity.
 */
export class DefaultDescriptor {
    /**
     * Keys that have a default value — static or function.
     */
    readonly keys: Map<string, DefaultValue> = new Map();
    /**
     * Keys with no default but containing nested entities that might have defaults.
     */
    readonly nestedKeys: Map<string, DefaultDescriptor> = new Map();

    /**
     * Updates this descriptor by the properties of the given class.
     * @param entityClass - The class to get the default properties from.
     */
    update(entityClass: Newable<unknown>): void {
        this.keys.clear();
        this.nestedKeys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);

        for (const [key, metadata] of Object.entries(properties)) {
            if ('default' in metadata && metadata.default != undefined) {
                this.keys.set(key, metadata.default);
                continue;
            }

            switch (metadata.type) {
                case Relation.MANY_TO_MANY:
                case Relation.ONE_TO_MANY:
                case Relation.MANY_TO_ONE:
                case Relation.HAS_ONE:
                case Relation.BELONGS_TO_ONE: {
                    const nested: DefaultDescriptor = ModelRegistry.get(metadata.target()).defaultDescriptor;
                    if (nested.hasAnything()) {
                        this.nestedKeys.set(key, nested);
                    }
                    break;
                }
                case 'object': {
                    const nested: DefaultDescriptor = ModelRegistry.get(metadata.cls()).defaultDescriptor;
                    if (nested.hasAnything()) {
                        this.nestedKeys.set(key, nested);
                    }
                    break;
                }
                case 'array': {
                    const nested: DefaultDescriptor | undefined = this.buildForArrayItems(metadata.items);
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
     * Whether or not there are even properties somewhere that have a default property.
     */
    hasAnything(): boolean {
        return this.keys.size > 0 || this.nestedKeys.size > 0;
    }

    private buildForArrayItems(items: ArrayPropertyItemMetadata): DefaultDescriptor | undefined {
        switch (items.type) {
            case 'object': {
                return ModelRegistry.get(items.cls()).defaultDescriptor;
            }
            case 'array': {
                return this.buildForArrayItems(items.items);
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