import { DefaultDescriptor } from './default-descriptor.ts';
import { EncryptionDescriptor } from './encryption-descriptor.ts';
import { ExcludeDescriptor } from './exclude-descriptor.ts';
import { HashDescriptor } from './hash-descriptor.ts';
import { KeyDescriptor } from './key-descriptor.ts';
import { OptimisticLockDescriptor } from './optimistic-lock-descriptor.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * Data stored per entity class in the registry.
 */
export type ModelRegistryData<T> = {
    /**
     * Pre-built exclude descriptor for this class.
     */
    readonly excludeDescriptor: ExcludeDescriptor<T>,
    /**
     * Pre-built encryption descriptor for this class.
     */
    readonly encryptionDescriptor: EncryptionDescriptor<T>,
    /**
     * Pre-built hash descriptor for this class.
     */
    readonly hashDescriptor: HashDescriptor<T>,
    /**
     * Pre-built default descriptor for this class.
     */
    readonly defaultDescriptor: DefaultDescriptor,
    /**
     * Pre-built unique and index groups for this class.
     */
    readonly keyDescriptor: KeyDescriptor,
    /**
     * Pre-built set of properties this class refuses to have written blindly.
     */
    readonly optimisticLockDescriptor: OptimisticLockDescriptor
};

/**
 * Centralized registry for per-class model data.
 * Acts as the single source of truth for model properties and derived descriptors.
 * Keeps all data consistent when properties are updated via setModelProperties.
 */
export abstract class ModelRegistry {
    /**
     * Stores fully resolved (inheritance-merged) model data per class.
     * Placeholder instances are mutated in place to keep cross-references valid.
     */
    private static readonly cache: Map<Newable<unknown>, ModelRegistryData<unknown>> = new Map();

    /**
     * The classes built by the get() currently in progress, kept until it settles them.
     */
    private static readonly building: Map<Newable<unknown>, ModelRegistryData<unknown>> = new Map();

    /**
     * How many builds are currently on the stack. Zero means the outermost one just finished.
     */
    private static buildDepth: number = 0;

    /**
     * Returns the cached model data for the given class, building it if necessary.
     * @param entityClass - The entity class to get model data for.
     * @returns The model data for the given class.
     */
    static get<T>(entityClass: Newable<T>): ModelRegistryData<T> {
        return this.cache.get(entityClass) ?? this.buildInPlace(entityClass);
    }

    /**
     * Builds or rebuilds the model data for the given class in place.
     * Reuses the existing placeholder if present so that any nestedKey references
     * held by other descriptors remain valid after a rebuild.
     * @param entityClass - The class to build data for.
     * @returns The model data for the given class.
     */
    private static buildInPlace<T>(entityClass: Newable<T>): ModelRegistryData<T> {
        // Reuse existing placeholder if present — keeps external nestedKey references valid
        let modelRegistryData: ModelRegistryData<unknown> | undefined = this.cache.get(entityClass);
        if (!modelRegistryData) {
            modelRegistryData = {
                excludeDescriptor: new ExcludeDescriptor<T>(),
                encryptionDescriptor: new EncryptionDescriptor<T>(),
                hashDescriptor: new HashDescriptor(),
                defaultDescriptor: new DefaultDescriptor(),
                keyDescriptor: new KeyDescriptor(),
                optimisticLockDescriptor: new OptimisticLockDescriptor()
            };
            this.cache.set(entityClass, modelRegistryData);
        }
        this.building.set(entityClass, modelRegistryData);

        this.buildDepth++;
        try {
            this.updateDescriptors(entityClass, modelRegistryData);
        }
        finally {
            this.buildDepth--;
        }

        if (this.buildDepth === 0) {
            this.settle();
        }

        return modelRegistryData;
    }

    /**
     * Runs every descriptor of one class against what that class declares.
     * @param entityClass - The class to read the declarations from.
     * @param modelRegistryData - The data to update in place.
     */
    private static updateDescriptors<T>(entityClass: Newable<T>, modelRegistryData: ModelRegistryData<unknown>): void {
        modelRegistryData.encryptionDescriptor.update(entityClass);
        modelRegistryData.hashDescriptor.update(entityClass);
        modelRegistryData.excludeDescriptor.update(entityClass);
        modelRegistryData.defaultDescriptor.update(entityClass);
        modelRegistryData.keyDescriptor.update(entityClass);
        modelRegistryData.optimisticLockDescriptor.update(entityClass);
    }

    /**
     * Re-runs everything the finished build touched until the descriptors stop changing.
     *
     * A nested descriptor is registered once the descriptor it points at has something in it, and in
     * a relation cycle that is not yet true when the edge is first looked at - whichever class is
     * asked for first is resolved against placeholders of the others. Registering only ever adds, so
     * repeating until nothing moves reaches the same result no matter which class that was.
     */
    private static settle(): void {
        const built: [Newable<unknown>, ModelRegistryData<unknown>][] = [...this.building];
        this.building.clear();

        let previous: number = -1;
        let current: number = this.nestedKeyCount(built);
        while (current !== previous) {
            previous = current;
            for (const [entityClass, modelRegistryData] of built) {
                this.updateDescriptors(entityClass, modelRegistryData);
            }
            current = this.nestedKeyCount(built);
        }
    }

    /**
     * How many nested descriptors are registered across the given data.
     *
     * The number a settle pass is measured by: keys come straight from the metadata and cannot
     * change between passes, so this is the only thing that can still move.
     * @param built - The data to count over.
     * @returns The total number of registered nested keys.
     */
    private static nestedKeyCount(built: [Newable<unknown>, ModelRegistryData<unknown>][]): number {
        let res: number = 0;
        for (const [, modelRegistryData] of built) {
            res += modelRegistryData.encryptionDescriptor.nestedCount()
                + modelRegistryData.hashDescriptor.nestedCount()
                + modelRegistryData.excludeDescriptor.nestedCount()
                + modelRegistryData.defaultDescriptor.nestedCount();
        }
        return res;
    }
}