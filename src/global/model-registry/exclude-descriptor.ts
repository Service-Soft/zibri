import { ModelRegistry } from './model.registry';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model';
import { ExcludePropertyValue } from '../../entity/models/base-property-metadata.model';
import { Relation } from '../../entity/models/relation.enum';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * A descriptor that keeps track of the exclude properties of an entity.
 */
export class ExcludeDescriptor<T> {
    /**
     * Keys that have a exclude value of true or function.
     */
    readonly keys: Map<string, ExcludeStrict<ExcludePropertyValue, false>> = new Map();
    /**
     * Keys with no exclude option but containing nested entities that might have exclude properties.
     */
    readonly nestedKeys: Map<string, ExcludeDescriptor<unknown>> = new Map();

    /**
     * Updates this descriptor by the properties of the given class.
     * @param entityClass - The class to get the exclude properties from.
     */
    update(entityClass: Newable<T>): void {
        this.keys.clear();
        this.nestedKeys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);

        for (const [key, metadata] of Object.entries(properties)) {
            if (metadata.exclude !== undefined && metadata.exclude !== false) {
                this.keys.set(key, metadata.exclude);
                continue;
            }

            switch (metadata.type) {
                case Relation.MANY_TO_ONE:
                case Relation.ONE_TO_ONE:
                case Relation.MANY_TO_MANY:
                case Relation.ONE_TO_MANY: {
                    const nested: ExcludeDescriptor<unknown> = ModelRegistry.get(metadata.target()).excludeDescriptor;
                    if (nested.hasAnything()) {
                        this.nestedKeys.set(key, nested);
                    }
                    break;
                }

                case 'object': {
                    const nested: ExcludeDescriptor<unknown> = ModelRegistry.get(metadata.cls()).excludeDescriptor;
                    if (nested.hasAnything()) {
                        this.nestedKeys.set(key, nested);
                    }
                    break;
                }

                case 'array': {
                    const nested: ExcludeDescriptor<unknown> | undefined = this.buildExcludeDescriptorForArrayItems(metadata.items);
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
     * Whether or not there are even properties somewhere that have a exclude property.
     */
    hasAnything(): boolean {
        return this.keys.size > 0 || this.nestedKeys.size > 0;
    }

    private buildExcludeDescriptorForArrayItems(
        items: ArrayPropertyItemMetadata
    ): ExcludeDescriptor<unknown> | undefined {
        switch (items.type) {
            case 'object': {
                return ModelRegistry.get(items.cls()).excludeDescriptor;
            }
            case 'array': {
                return this.buildExcludeDescriptorForArrayItems(items.items);
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