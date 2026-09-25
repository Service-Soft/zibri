import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

/**
 * A descriptor that keeps track of the properties an entity refuses to have written blindly.
 *
 * Read on every update that names one of them, which is why it is resolved once per class rather
 * than walked out of the property metadata each time.
 */
export class OptimisticLockDescriptor {
    /**
     * The properties that may only be written by a call that also says what they were.
     */
    readonly keys: Set<string> = new Set();

    /**
     * Updates this descriptor from what the given class declares.
     * @param entityClass - The class to read the declarations from.
     */
    update(entityClass: Newable<unknown>): void {
        this.keys.clear();

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            // not every kind of property can carry this, so the flag is checked for rather than read
            if ('optimisticLocking' in metadata && metadata.optimisticLocking) {
                this.keys.add(key);
            }
        }
    }
}