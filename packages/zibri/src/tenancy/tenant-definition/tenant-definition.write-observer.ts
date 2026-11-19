import { EntityWrite, EntityWriteObserver, WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';

/**
 * Has the tenant service forget what it knows of the tenants a write changed, here at once and on every other
 * instance within seconds, however the tenant is written.
 */
export class TenantDefinitionWriteObserver implements EntityWriteObserver {
    /**
     * What names a tenant, of a write to every tenant a filter matches.
     */
    readonly properties: string[] = ['id'];

    constructor(private readonly forget: (tenantIds: string[]) => Promise<void>) {}

    /**
     * Follows the tenants as they were of every write that can change a stored one.
     * @param write - The write.
     * @returns False for an insert, which nothing knew of before.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation !== 'insert';
    }

    /**
     * Forgets the tenants a write changed.
     * @param written - The tenants as they were and as they are.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        const ids: string[] = [
            ...new Set([...written.before, ...written.after]
                .map(row => 'id' in row ? row.id : undefined)
                .filter(id => typeof id === 'string'))
        ];
        if (ids.length) {
            await this.forget(ids);
        }
    }
}