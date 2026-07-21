import { DefaultDescriptor } from './default-descriptor';
import { EncryptionDescriptor } from './encryption-descriptor';
import { ExcludeDescriptor } from './exclude-descriptor';
import { HashDescriptor } from './hash-descriptor';
import { Newable } from '../../types/newable.type';

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
    readonly defaultDescriptor: DefaultDescriptor
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
                defaultDescriptor: new DefaultDescriptor()
            };
            this.cache.set(entityClass, modelRegistryData);
        }

        // Resolve inherited properties first, so descriptors see the full picture
        // modelRegistryData.properties = ;
        modelRegistryData.encryptionDescriptor.update(entityClass);
        modelRegistryData.hashDescriptor.update(entityClass);
        modelRegistryData.excludeDescriptor.update(entityClass);
        modelRegistryData.defaultDescriptor.update(entityClass);

        return modelRegistryData;
    }
}