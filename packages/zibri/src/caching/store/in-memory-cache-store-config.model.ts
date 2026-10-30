import { CacheStoreConfig } from './cache-store.interface';

/**
 * What an `InMemoryCacheStore` is built with.
 */
export type InMemoryCacheStoreConfig = CacheStoreConfig & {
    /**
     * Whether each tenant has entries of its own, keyed by the tenant active when the store is asked.
     * False for keys that already say which tenant they are for, such as the id of the tenant.
     */
    readonly perTenant: boolean
};