import { EntityWrite, EntityWriteObserver, WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';

/**
 * Follows the deactivation of tenants, however a tenant is written, and hands on each tenant a write deactivated or
 * reactivated.
 */
export class TenantDeactivationWriteObserver implements EntityWriteObserver {
    /**
     * What names a tenant and whether it is deactivated, of a write to every tenant a filter matches.
     */
    readonly properties: string[] = ['id', 'deactivatedAt'];

    constructor(private readonly handleChanged: (tenantId: string, deactivated: boolean) => Promise<void>) {}

    /**
     * Follows the tenants as they were of every write that can change a stored one.
     * @param write - The write.
     * @returns False for an insert, which no connection is in yet.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation !== 'insert';
    }

    /**
     * Hands on the tenants whose deactivation a write changed.
     * @param written - The tenants as they were and as they are.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        const before: Map<unknown, boolean> = new Map(written.before.map(row => [Reflect.get(row, 'id'), this.isDeactivated(row)]));
        await Promise.all(written.after.map(async row => {
            const id: unknown = Reflect.get(row, 'id');
            const deactivated: boolean = this.isDeactivated(row);
            if (typeof id === 'string' && before.has(id) && before.get(id) !== deactivated) {
                await this.handleChanged(id, deactivated);
            }
        }));
    }

    private isDeactivated(row: object): boolean {
        return Reflect.get(row, 'deactivatedAt') != undefined;
    }
}