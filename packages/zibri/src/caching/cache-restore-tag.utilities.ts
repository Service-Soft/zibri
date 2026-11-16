import { AlsUtilities } from '../context/als.utilities';

/**
 * The tags a restore invalidates on every instance, which every cache receives whatever tags it declares.
 *
 * Every cache entry carries the tag of the tenant it was written for, or the untenanted tag. Something
 * kept in memory beside the caches that holds stored rows listens for these tags with
 * `registerInvalidationListener`.
 */
export abstract class CacheRestoreTagUtilities {
    /**
     * Invalidated once the application is restored. Every cache is emptied.
     */
    static readonly APPLICATION_TAG: string = 'zibri.restore';

    /**
     * Carried by every entry written outside a tenant, or to a store not kept per tenant. Invalidated
     * once any tenant is restored, as such an entry can hold rows of any tenant.
     */
    static readonly UNTENANTED_TAG: string = 'zibri.restore:untenanted';

    private static readonly TENANT_TAG_PREFIX: string = 'zibri.restore:tenant:';

    /**
     * The tag invalidated once a tenant is restored, which every entry written for the tenant carries.
     * @param tenantId - The tenant.
     * @returns The tag.
     */
    static getTenantTag(tenantId: string): string {
        return `${CacheRestoreTagUtilities.TENANT_TAG_PREFIX}${tenantId}`;
    }

    /**
     * Finds the tenant a tag of a restore of a tenant names.
     * @param tag - The tag.
     * @returns The tenant, or undefined for any other tag.
     */
    static findTenantId(tag: string): string | undefined {
        return tag.startsWith(CacheRestoreTagUtilities.TENANT_TAG_PREFIX)
            ? tag.slice(CacheRestoreTagUtilities.TENANT_TAG_PREFIX.length)
            : undefined;
    }

    /**
     * Whether a tag is one a restore invalidates.
     * @param tag - The tag.
     * @returns Whether it is.
     */
    static isRestoreTag(tag: string): boolean {
        return tag === CacheRestoreTagUtilities.APPLICATION_TAG
            || tag === CacheRestoreTagUtilities.UNTENANTED_TAG
            || tag.startsWith(CacheRestoreTagUtilities.TENANT_TAG_PREFIX);
    }

    /**
     * The tag of a restore an entry written now carries: that of the active tenant, or the untenanted tag.
     * @param perTenant - Whether the store keeps the entries of each tenant apart.
     * @returns The tag.
     */
    static getEntryTag(perTenant: boolean): string {
        // a store keyed by what its keys name rather than by the active tenant can hold any tenant's
        // entry under any active tenant, so only a restore of every tenant leaves it untouched
        const tenantId: string | undefined = perTenant ? AlsUtilities.getCurrentTenant() : undefined;
        return tenantId == undefined ? CacheRestoreTagUtilities.UNTENANTED_TAG : CacheRestoreTagUtilities.getTenantTag(tenantId);
    }
}