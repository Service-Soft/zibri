import { RestoreContextUtilities } from '../../backup/restore-context.utilities';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { TransactionUtilities } from '../../data-source/transaction/transaction.utilities';
import { EntityWrite, EntityWriteObserver, MadeWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { AfterAppInit } from '../../global/after-app-init.interface';
import { type BaseTenantDefinition } from '../../tenancy/tenant-definition/base-tenant-definition.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { type BookkeepingPluginOptions } from './models/bookkeeping-plugin-options.model';
import { type NewBookkeepingSettings } from './models/new-bookkeeping-settings.model';

/**
 * Gives every tenant its bookkeeping settings in the transaction it is created in, with `tenantsWithoutBooks` set to
 * `never`, however the repository got to the write: a tenant whose settings cannot be resolved or created is not
 * created either.
 */
@Injectable({ register: 'onUse' })
export class TenantBooksWriteObserver implements EntityWriteObserver, AfterAppInit {
    /**
     * What a tenant written by an upsert is read with, which tells the tenants it creates.
     */
    readonly properties: string[] = ['id'];

    constructor(
        @Inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS)
        private readonly options: BookkeepingPluginOptions
    ) {}

    /**
     * Registers itself as an observer of every write to the entity of the tenants, with `never`.
     */
    // after init rather than on it, as the tenant service finds the entity of the tenants on init
    afterAppInit(): void {
        if (this.options.tenantsWithoutBooks !== 'never') {
            return;
        }
        // there is one with never, which ZibriBookkeepingPlugin.validate refuses to start without
        const tenantEntity: Newable<BaseTenantDefinition> | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).findTenantEntityClass?.();
        if (tenantEntity != undefined) {
            inject(EntityWriteObserverRegistry).register(tenantEntity, this);
        }
    }

    /**
     * Whether a write can create a tenant, whose settings are created in its transaction.
     * @param write - The write.
     * @returns True for an insert, a save and an upsert.
     */
    requiresTransaction(write: EntityWrite): boolean {
        return this.isCreating(write);
    }

    /**
     * Reads the tenants as they were of a save and an upsert, which tells the ones they create.
     * @param write - The write.
     * @returns True for a save and an upsert.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation === 'save' || write.operation === 'upsert';
    }

    /**
     * Creates the bookkeeping settings of every tenant a write created, in its transaction.
     * @param write - The write, once it is made.
     * @throws What resolving or creating the settings of a tenant throws, which fails the write.
     */
    async completeWrite(write: MadeWrite): Promise<void> {
        if (this.options.tenantsWithoutBooks !== 'never' || !this.isCreating(write)) {
            return;
        }
        const existing: Set<unknown> = new Set(write.before.map((row): unknown => Reflect.get(row, 'id')));
        const created: BaseTenantDefinition[] = write.after.flatMap(row => this.isTenant(row) && !existing.has(row.id) ? [row] : []);
        if (!created.length) {
            return;
        }
        const transaction: RepositoryTransaction | undefined = write.transaction;
        // every write creating a tenant has one, since requiresTransaction has the driver start it for one without
        if (transaction == undefined) {
            throw new InternalError(
                'The bookkeeping settings of a tenant are created in the transaction of its write, and the write has none.'
            );
        }
        TransactionUtilities.validateNotSpanning(
            transaction,
            'The bookkeeping settings of a tenant are created in the transaction of the tenant'
        );
        const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        // one after the other, as the writes of one transaction run over one connection
        for (const tenant of created) {
            const settings: NewBookkeepingSettings = await this.options.resolveSettingsOf(tenant, transaction);
            await tenantService.runAs(
                tenant.id,
                async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).createSettings(settings, transaction)
            );
        }
    }

    private isCreating(write: EntityWrite): boolean {
        // a tenant a restore brings back comes with the settings of its books, which the restore brings back as well
        return !RestoreContextUtilities.isRestoring()
            && (write.operation === 'insert' || write.operation === 'save' || write.operation === 'upsert');
    }

    private isTenant(row: object): row is BaseTenantDefinition {
        return 'id' in row && typeof row.id === 'string' && 'name' in row && typeof row.name === 'string';
    }
}