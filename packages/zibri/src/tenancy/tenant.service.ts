import { ZibriApplication } from '../application/application';
import { type AuditServiceInterface } from '../audit/audit-service.interface';
import { type CacheServiceInterface } from '../caching/cache-service.interface';
import { InMemoryCacheStore } from '../caching/store/in-memory.cache-store';
import { AlsUtilities } from '../context/als.utilities';
import { type DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { Repository } from '../data-source/repository/repository';
import { EntityWriteObserverRegistry } from '../data-source/write-observers/entity-write-observer.registry';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { TENANT_ROW_ENTITY } from '../entity/base-tenant-entity.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { TenantDeactivatedError } from '../error-handling/errors/tenant-deactivated.error';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { HttpRequest } from '../http/http-request.model';
import { $ts } from '../localization/translate.function';
import { AuditAction, AuditOutcome } from '../logging/audit-event.model';
import { AuditUtilities } from '../logging/audit.utilities';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { WebsocketRequest } from '../websocket/models/websocket-request.model';
import { BaseTenantDefinition, DeactivatableTenantDefinition, TENANT_ENTITY } from './tenant-definition/base-tenant-definition.model';
import { TenantDefinitionWriteObserver } from './tenant-definition/tenant-definition.write-observer';
import { TenantDeletionCronJob } from './tenant-definition/tenant-deletion.cron-job';
import { TenantDeletion, TenantDeletionCreateData } from './tenant-definition/tenant-deletion.model';
import { TenantDeletionStep, TenantDeletionUtilities } from './tenant-definition/tenant-deletion.utilities';
import { TenantServiceInterface } from './tenant-service.interface';

// named like the header in the query too, so that it cannot be taken for a `tenantId` parameter a
// route of the application reads for a purpose of its own
const TENANT_PARAMETER: string = 'x-tenant-id';

/**
 * What the tag a tenant's deactivation is forgotten by starts with, followed by the tenant.
 */
const DEACTIVATED_TAG_PREFIX: string = 'zibri.tenant-deactivated:';

/**
 * How many rows of an entity a tenant deletion deletes at once.
 */
const DELETION_BATCH_SIZE: number = 500;

/**
 * The entity of the tenants, and the repository the data source holding it builds.
 */
type DeclaredTenants = {
    /**
     * The entity.
     */
    entity: Newable<DeactivatableTenantDefinition>,
    /**
     * Its repository.
     */
    repository: Repository<DeactivatableTenantDefinition>
};

/**
 * An entity of the tenants, and the data source declaring it.
 */
type MarkedTenantEntity = {
    /**
     * The data source.
     */
    dataSource: DataSourceInterface,
    /**
     * The entity.
     */
    entity: Newable<DeactivatableTenantDefinition>
};

/**
 * Checks whether an entity is the one of the tenants.
 * @param entity - The entity.
 * @returns True when it carries the mark `BaseTenantDefinitionEntity()` sets.
 */
function isTenantEntity(entity: Newable<BaseEntity>): entity is Newable<DeactivatableTenantDefinition> {
    return TENANT_ENTITY in entity;
}

/**
 * The default {@link TenantServiceInterface}, keeping the active tenant in async local storage and
 * reading the tenant of a request from its `x-tenant-id` header, or from its `x-tenant-id` query
 * parameter, which is where links name it.
 */
@Injectable({ register: 'onUse' })
export class TenantService implements TenantServiceInterface, OnAppInit {

    /**
     * The entity of the tenants, and the data source holding it, if the application declares one.
     */
    private tenants: DeclaredTenants | undefined;

    /**
     * Whether the tenants can be deactivated, which is when there is anything to check.
     */
    private deactivatable: boolean = false;

    private deletionRepository: Repository<TenantDeletion, TenantDeletionCreateData> | undefined;

    /**
     * Whether a tenant is deactivated, by its id, for as many tenants as fit.
     */
    private readonly deactivated: InMemoryCacheStore<string, boolean> = new InMemoryCacheStore({ perTenant: false });

    /**
     * The tenants whose deletion runs on this instance, whose own work is not refused.
     */
    private readonly deleting: Set<string> = new Set();

    /**
     * The deletions started on this instance, which run past the call that started them.
     */
    private readonly runningDeletions: Set<Promise<void>> = new Set();

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    private get auditService(): AuditServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
    }

    private get cacheService(): CacheServiceInterface {
        return inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const dataSources: DataSourceInterface[] = inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE).getDataSources();
        this.warnAboutTenantsOfTenants(dataSources);
        const marked: MarkedTenantEntity[] = dataSources
            .flatMap(dataSource => dataSource.entities.filter(isTenantEntity).map(entity => ({ dataSource, entity })));
        if (marked.length > 1) {
            throw new InternalError([
                `Several entities are entities of the tenants: ${marked.map(m => m.entity.name).join(', ')}.`,
                'The tenants of an application are kept in one place. Keep one of them.'
            ]);
        }
        const [found] = marked;
        // an application without one knows its tenants by their ids only, and nothing is checked
        if (found == undefined) {
            return;
        }
        if (MetadataUtilities.getEntityMetadata(found.entity)?.tenant !== 'shared') {
            throw new InternalError([
                `${found.entity.name} is the entity of the tenants, and its rows belong to a tenant.`,
                'A tenant is what every request picks its tenant from: declare it with @Entity({ tenant: \'shared\' }).'
            ]);
        }
        this.tenants = { entity: found.entity, repository: found.dataSource.getRepository(found.entity) };
        this.deactivatable = 'deactivatedAt' in MetadataUtilities.getModelProperties(found.entity);
        if (!this.deactivatable) {
            return;
        }
        inject(EntityWriteObserverRegistry).register(
            found.entity,
            new TenantDefinitionWriteObserver(
                async tenantIds => await this.cacheService.invalidateTags(tenantIds.map(id => `${DEACTIVATED_TAG_PREFIX}${id}`))
            )
        );
        this.cacheService.registerInvalidationListener(
            app,
            TenantService.name,
            tag => tag.startsWith(DEACTIVATED_TAG_PREFIX),
            tag => {
                this.deactivated.delete(tag.slice(DEACTIVATED_TAG_PREFIX.length));
                return Promise.resolve();
            }
        );
        const deletions: DataSourceInterface | undefined = dataSources.find(dataSource => dataSource.entities.includes(TenantDeletion));
        if (deletions != undefined) {
            this.deletionRepository = deletions.getRepository(TenantDeletion);
            if (!app.options.cronJobs.includes(TenantDeletionCronJob)) {
                app.options.cronJobs.push(TenantDeletionCronJob);
            }
        }
    }

    /**
     * Warns about an entity named like the tenants whose rows belong to a tenant instead, which is easy to mix up.
     * @param dataSources - The data sources of the application.
     */
    private warnAboutTenantsOfTenants(dataSources: DataSourceInterface[]): void {
        for (const entity of dataSources.flatMap(dataSource => dataSource.entities)) {
            if (/tenant$/i.test(entity.name) && TENANT_ROW_ENTITY in entity) {
                this.logger.warn([
                    `${entity.name} extends BaseTenantEntity(), whose rows each belong to a tenant.`,
                    'The entity whose rows are the tenants extends BaseTenantDefinitionEntity().'
                ].join(' '));
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async runAs<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
        if (!UUIDUtilities.isUuid(tenantId)) {
            throw new InternalError(`The tenant "${tenantId}" is not a uuid. Every tenant id is one.`);
        }
        // in the case every uuid is stored in. A filter finds a uuid in either case, while everything
        // comparing the active tenant as a string - a key bound to a tenant, a room, the tenant of a row
        // sent back unchanged - would take the same tenant written in capitals for another one
        return await AlsUtilities.runInTenant(tenantId.toLowerCase(), fn);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getActiveTenantId(): string | undefined {
        return AlsUtilities.getCurrentTenant();
    }

    // as wide as the interface, so that an application overriding it may look the tenant up
    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveTenant(request: HttpRequest | WebsocketRequest): string | undefined | Promise<string | undefined> {
        const header: string | undefined = this.findSingleValue(request.headers?.[TENANT_PARAMETER]);
        const query: string | undefined = this.findSingleValue(request.query?.[TENANT_PARAMETER]);
        if (header != undefined && query != undefined && header !== query) {
            throw new BadRequestError($ts`The request names the tenant "${header}" in its header and "${query}" in its query.`);
        }
        return header ?? query;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTenantHeader(): string | undefined {
        return TENANT_PARAMETER;
    }

    // as wide as the interface, for the reason resolveTenant is
    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveTenantUrl(url: string, tenantId: string): string | Promise<string> {
        const link: URL = new URL(url);
        link.searchParams.set(TENANT_PARAMETER, tenantId);
        return link.toString();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    findTenantEntityClass(): Newable<BaseTenantDefinition> | undefined {
        return this.tenants?.entity;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findTenant(tenantId: string): Promise<BaseTenantDefinition | undefined> {
        return await this.tenants?.repository.findOne({ where: { id: tenantId }, required: false });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveIsDeactivated(tenantId: string): Promise<boolean> {
        // nothing to read for an application whose tenants cannot be deactivated, which is every one of 3.1
        if (!this.deactivatable || this.tenants == undefined) {
            return false;
        }
        const known: boolean | undefined = this.deactivated.get(tenantId)?.value;
        if (known != undefined) {
            return known;
        }
        const tenant: Pick<DeactivatableTenantDefinition, 'deactivatedAt'> | undefined = await this.tenants.repository.findOne({
            where: { id: tenantId },
            select: ['deactivatedAt'],
            required: false
        });
        // a tenant nobody declared is no deactivated one: its id is all an application of ids knows of it
        const isDeactivated: boolean = tenant?.deactivatedAt != undefined;
        this.deactivated.set(tenantId, { createdAt: new Date(), value: isDeactivated, tags: [] });
        return isDeactivated;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateNotDeactivated(tenantId: string | undefined): Promise<void> {
        // the deletion of a tenant writes in it, as deleting its memberships emits their events
        if (tenantId == undefined || this.deleting.has(tenantId)) {
            return;
        }
        if (await this.resolveIsDeactivated(tenantId)) {
            throw new TenantDeactivatedError(tenantId);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deactivateTenant(tenantId: string): Promise<void> {
        await this.writeDeactivatedAt(tenantId, new Date(), AuditAction.TENANT_DEACTIVATED, async () => {
            // what would otherwise run once the tenant is reactivated. Its websocket connections leave it by the
            // observer of the websocket service, which sees every write of a tenant
            await Promise.all([
                inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).deleteQueuedEmails?.(tenantId),
                inject(ZIBRI_DI_TOKENS.EVENT_SERVICE).deletePendingEvents?.(tenantId),
                inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE).cancelQueuedThreadJobs?.(tenantId)
            ]);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async reactivateTenant(tenantId: string): Promise<void> {
        await this.writeDeactivatedAt(tenantId, null, AuditAction.TENANT_REACTIVATED, () => Promise.resolve());
    }

    /**
     * Writes when a tenant was deactivated, in the tenant, recording that it happened or why it did not.
     * @param tenantId - The tenant.
     * @param deactivatedAt - When it was deactivated, or null to reactivate it.
     * @param action - What is recorded.
     * @param after - What follows the write.
     */
    private async writeDeactivatedAt(
        tenantId: string,
        deactivatedAt: Date | null,
        action: AuditAction,
        after: () => Promise<void>
    ): Promise<void> {
        const repository: Repository<DeactivatableTenantDefinition> = this.getDeactivatableRepository();
        await this.runAs(tenantId, async () => {
            try {
                await this.findExistingTenant(tenantId);
                await repository.updateById(tenantId, { deactivatedAt });
                // the observer forgets it on every instance; this one is asked next by what follows here
                this.deactivated.delete(tenantId);
                await after();
                this.auditService.record({ action, outcome: AuditOutcome.SUCCESS });
            }
            catch (error) {
                this.auditService.record({ action, outcome: AuditOutcome.FAILURE, reason: AuditUtilities.resolveReason(error) });
                throw error;
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteTenant(tenantId: string): Promise<TenantDeletion> {
        this.getDeactivatableRepository();
        const deletions: Repository<TenantDeletion, TenantDeletionCreateData> = this.getDeletionRepository();
        const started: TenantDeletion | undefined = await deletions.findOne({ where: { tenantId }, required: false });
        if (started != undefined) {
            return started;
        }
        const tenant: DeactivatableTenantDefinition = await this.findExistingTenant(tenantId);
        // nothing writes to a tenant that is deactivated, so nothing is written to it while its rows go
        if (tenant.deactivatedAt == undefined) {
            throw new BadRequestError($ts`The tenant "${tenantId}" needs to be deactivated before it is deleted.`);
        }
        const deletion: TenantDeletion = await deletions.create({
            tenantId,
            startedAt: new Date(),
            deletingEntity: null,
            deletedRows: 0,
            finishedAt: null
        });
        const running: Promise<void> = this.continueDeletion(deletion);
        this.runningDeletions.add(running);
        // eslint-disable-next-line promise/prefer-await-to-then
        void running.finally(() => this.runningDeletions.delete(running));
        return deletion;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findTenantDeletion(tenantId: string): Promise<TenantDeletion | undefined> {
        return await this.getDeletionRepository().findOne({ where: { tenantId }, required: false });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resumeTenantDeletions(): Promise<void> {
        if (this.deletionRepository == undefined) {
            return;
        }
        const open: TenantDeletion[] = await this.deletionRepository.findAll({ where: { finishedAt: null }, limit: 'all' });
        await Promise.all(open.map(async deletion => await this.continueDeletion(deletion)));
    }

    /**
     * Waits for the deletions started on this instance, such as before it stops.
     */
    async waitForTenantDeletions(): Promise<void> {
        await Promise.all(this.runningDeletions);
    }

    /**
     * Goes on with the deletion of a tenant, as the only instance doing so. Each batch is written down; one stopped
     * halfway goes on with the rows that are left, which are what the next batch reads. A failure leaves it for the
     * next run.
     * @param deletion - The deletion.
     */
    private async continueDeletion(deletion: TenantDeletion): Promise<void> {
        const tenants: DeclaredTenants = this.getTenants();
        const deletions: Repository<TenantDeletion, TenantDeletionCreateData> = this.getDeletionRepository();
        const { tenantId } = deletion;
        try {
            await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
                { key: `zibri.tenant-deletion:${tenantId}`, leaseInMs: Ms.MINUTE },
                async lost => {
                    this.deleting.add(tenantId);
                    try {
                        let deletedRows: number = (await deletions.findById(deletion.id)).deletedRows;
                        const steps: TenantDeletionStep[] = TenantDeletionUtilities.resolveSteps(
                            inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE).getDataSources(),
                            tenants.entity
                        );
                        for (const step of steps) {
                            for (;;) {
                                if (lost.aborted) {
                                    return;
                                }
                                const deleted: number = await this.runAs(
                                    tenantId,
                                    async () => await TenantDeletionUtilities.deleteBatch(step, tenantId, DELETION_BATCH_SIZE)
                                );
                                if (deleted === 0) {
                                    break;
                                }
                                deletedRows += deleted;
                                await deletions.updateById(deletion.id, { deletingEntity: step.entity.name, deletedRows });
                            }
                        }
                        await tenants.repository.deleteAll({ id: tenantId });
                        await deletions.updateById(
                            deletion.id,
                            { deletingEntity: null, deletedRows: deletedRows + 1, finishedAt: new Date() }
                        );
                        // in the tenant, whose audit trail stays
                        await this.runAs(tenantId, () => {
                            this.auditService.record({ action: AuditAction.TENANT_DELETED, outcome: AuditOutcome.SUCCESS });
                            return Promise.resolve();
                        });
                    }
                    finally {
                        this.deleting.delete(tenantId);
                    }
                }
            );
        }
        catch (error) {
            // the cron job goes on with it, from the batch it stopped at
            this.logger.error(
                new Error(`The deletion of the tenant "${tenantId}" stopped, and goes on with the next run.`, { cause: error })
            );
        }
    }

    /**
     * Finds a tenant by its id.
     * @param tenantId - The id.
     * @returns The tenant.
     * @throws A NotFoundError when there is none.
     */
    private async findExistingTenant(tenantId: string): Promise<DeactivatableTenantDefinition> {
        const tenant: DeactivatableTenantDefinition | undefined = await this.getTenants().repository.findOne(
            {
                where: { id: tenantId },
                required: false
            }
        );
        if (tenant == undefined) {
            throw new NotFoundError($ts`Could not find tenant with id "${tenantId}".`);
        }
        return tenant;
    }

    private getTenants(): DeclaredTenants {
        if (this.tenants == undefined) {
            throw new InternalError([
                'No entity of the tenants is declared, so there are no tenants to deactivate or delete.',
                'Declare one extending BaseTenantDefinitionEntity({ deactivatable: true }) in a data source.'
            ]);
        }
        return this.tenants;
    }

    private getDeactivatableRepository(): Repository<DeactivatableTenantDefinition> {
        const tenants: DeclaredTenants = this.getTenants();
        if (!this.deactivatable) {
            throw new InternalError([
                'The tenants cannot be deactivated, nor deleted, which needs them to be deactivated first.',
                'Extend BaseTenantDefinitionEntity({ deactivatable: true }).'
            ]);
        }
        return tenants.repository;
    }

    private getDeletionRepository(): Repository<TenantDeletion, TenantDeletionCreateData> {
        if (this.deletionRepository == undefined) {
            throw new InternalError(
                'Deleting a tenant needs TenantDeletion, which keeps how far a deletion got: declare it in a data source.'
            );
        }
        return this.deletionRepository;
    }

    /**
     * Finds the one value a header or query parameter holds.
     * @param value - What the request holds under its name.
     * @returns The value, or undefined when it is missing, empty or sent several times: a value sent
     * twice names two tenants, and picking one of them would be a guess.
     */
    private findSingleValue(value: unknown): string | undefined {
        return typeof value === 'string' && value.length ? value : undefined;
    }
}