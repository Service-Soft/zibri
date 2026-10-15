import { DataSourceServiceInterface } from './data-source-service.interface';
import { ZibriApplication } from '../application/application';
import { DataSourceInterface } from './data-sources/data-source.interface';
import { RegisteredDataSource, resolveEntityOwnership } from './entity-ownership.function';
import { OwnedRelationUtilities } from './owned-relation.utilities';
import { TenantUtilities } from './tenancy/tenant.utilities';
import { ChangeSet } from '../change-sets/models/change-set.model';
import { Change } from '../change-sets/models/change.model';
import { isChangeSetEntityNewable } from '../change-sets/models/is-change-set-entity.function';
import { isSoftDeleteEntityNewable } from '../change-sets/models/is-soft-delete-entity.function';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { isRelationMetadata } from '../entity/models/is-relation-metadata.function';
import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';
import { type LoggerInterface } from '../logging/logger.interface';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * Default data source service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class DataSourceService implements DataSourceServiceInterface {
    private readonly dataSources: DataSourceInterface[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) { }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async beforeAppInit(app: ZibriApplication): Promise<void> {
        const { dataSources } = app.options;
        if (dataSources.length) {
            this.logger.info(`initializes ${dataSources.length} ${dataSources.length > 1 ? 'data sources' : 'data source'}`);
        }

        const registeredDataSources: RegisteredDataSource[] = dataSources.map(dataSourceClass => {
            if (!MetadataUtilities.getFilePath(dataSourceClass)) {
                throw new InternalError(`The data source ${dataSourceClass.name} is not decorated with @DataSource.`);
            }
            return { dataSourceClass, dataSource: inject(dataSourceClass) };
        });

        // has to happen before any data source is initialized, because only here it is known
        // which entities belong to more than one of them
        resolveEntityOwnership(registeredDataSources);

        for (const { dataSourceClass, dataSource } of registeredDataSources) {
            this.validateChangeSetEntitiesDeclared(dataSourceClass.name, dataSource);
            this.validateInverseSidesDeclared(dataSourceClass.name, dataSource);
            this.validateRelationsStayInTenant(dataSourceClass.name, dataSource);
            this.validateSoftDeletedRelations(dataSourceClass.name, dataSource);
        }

        for (const { dataSourceClass, dataSource } of registeredDataSources) {
            this.dataSources.push(dataSource);
            this.logger.info(`  - ${dataSourceClass.name} (${dataSource.entities.length} entities)`);
            await dataSource.init();
        }

        validateEntitiesRegistered(
            this.constructor.name,
            app,
            ...GlobalRegistry.entityClasses.filter(e => !(MetadataUtilities.getEntityMetadata(e)?.allowOrphan ?? false))
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppShutdown(): Promise<void> {
        await Promise.all(this.dataSources.map(ds => ds.shutDown()));
    }

    /**
     * Refuses a data source that declares an entity recording change sets, but not where they go.
     *
     * A change set is written in the same transaction as the change it records, so it lives in the
     * data source of that entity rather than in any one of them - and a data source without any such
     * entity has no use for the tables at all.
     * @param dataSourceName - The name of the data source, for the message.
     * @param dataSource - The data source to check.
     * @throws When the data source declares a change set entity without Change and ChangeSet.
     */
    private validateChangeSetEntitiesDeclared(dataSourceName: string, dataSource: DataSourceInterface): void {
        const recorded: Newable<BaseEntity>[] = dataSource.entities.filter(e => isChangeSetEntityNewable(e));
        if (!recorded.length) {
            return;
        }
        const missing: Newable<BaseEntity>[] = [ChangeSet, Change].filter(e => !dataSource.entities.includes(e));
        if (!missing.length) {
            return;
        }
        throw new InternalError([
            `The data source ${dataSourceName} declares entities that record change sets:`,
            ...recorded.map(e => `  - ${e.name}`),
            `Their change sets are stored beside them, so it also has to declare ${missing.map(e => e.name).join(' and ')}.`
        ]);
    }

    /**
     * Refuses a data source declaring a relation whose inverse side its target does not declare.
     *
     * A relation is resolved through the property on its target that it names, so one naming a
     * property that is not there can be neither read nor written.
     * @param dataSourceName - The name of the data source, for the message.
     * @param dataSource - The data source to check.
     * @throws When a relation names an inverse side its target does not declare.
     */
    private validateInverseSidesDeclared(dataSourceName: string, dataSource: DataSourceInterface): void {
        // before init rather than wherever a store first needs the inverse: postgres reads it while
        // building its schema and failed there on a property of undefined, while the other stores
        // only noticed once a read or a write crossed the relation
        const unresolved: string[] = [];
        for (const entity of dataSource.entities) {
            for (const [key, metadata] of Object.entries(MetadataUtilities.getModelProperties(entity))) {
                if (!isRelationMetadata(metadata)) {
                    continue;
                }
                const target: Newable<BaseEntity> = metadata.target();
                const inverseSide: string = String(metadata.inverseSide);
                if (MetadataUtilities.getModelProperties(target)[inverseSide] == undefined) {
                    unresolved.push(`  - ${entity.name}.${key} names "${inverseSide}", which ${target.name} does not declare`);
                }
            }
        }
        if (!unresolved.length) {
            return;
        }
        throw new InternalError([
            `The data source ${dataSourceName} declares relations whose inverse side is not there:`,
            ...unresolved,
            'The inverse side is the property of the target that points back, declared with @Property.'
        ]);
    }

    /**
     * Refuses a relation between an entity whose every row belongs to a tenant and one shared by all
     * of them.
     *
     * A row only ever points at rows of its own tenant, and a shared row belongs to none, so no write
     * could ever set such a relation. Said here rather than at the first write that tries.
     * @param dataSourceName - The name of the data source, for the message.
     * @param dataSource - The data source to check.
     * @throws When a relation joins a tenant's entity and a shared one.
     */
    private validateRelationsStayInTenant(dataSourceName: string, dataSource: DataSourceInterface): void {
        const crossing: string[] = [];
        for (const entity of dataSource.entities) {
            const tenantRequired: boolean | undefined = this.resolveTenantRequired(entity);
            for (const [key, metadata] of Object.entries(MetadataUtilities.getModelProperties(entity))) {
                if (!isRelationMetadata(metadata)) {
                    continue;
                }
                const target: Newable<BaseEntity> = metadata.target();
                const targetRequired: boolean | undefined = this.resolveTenantRequired(target);
                // only the pair that can never hold: a row of a tenant beside a row of none. A tenant
                // that is optional pairs with either, and its value decides at the write
                if (
                    (tenantRequired === true && targetRequired === undefined)
                    || (tenantRequired === undefined && targetRequired === true)
                ) {
                    crossing.push(`  - ${entity.name}.${key} points at ${target.name}`);
                }
            }
        }
        if (!crossing.length) {
            return;
        }
        throw new InternalError([
            `The data source ${dataSourceName} declares relations between an entity of a tenant and one shared by every tenant:`,
            ...crossing,
            'A row only points at rows of its own tenant, and a shared row belongs to none.',
            'Keep the id in a column of its own instead of a relation, eg. "userId" rather than "user".'
        ]);
    }

    /**
     * Refuses an entity that soft deletes, whose rows of a relation removed along with it are of an
     * entity that does not.
     *
     * Soft deleting a row marks the rows of those relations deleted along with it, and restoring it
     * restores them. A row that cannot be marked would either stay as if its owner were there or be
     * gone for good, with nothing left to restore.
     * @param dataSourceName - The name of the data source, for the message.
     * @param dataSource - The data source to check.
     * @throws When such a relation points at an entity that does not soft delete.
     */
    private validateSoftDeletedRelations(dataSourceName: string, dataSource: DataSourceInterface): void {
        const notSoftDeleting: string[] = [];
        for (const entity of dataSource.entities.filter(e => isSoftDeleteEntityNewable(e))) {
            for (const relation of OwnedRelationUtilities.resolveAll(entity)) {
                if (relation.cascadesRemove && !isSoftDeleteEntityNewable(relation.target)) {
                    notSoftDeleting.push(`  - ${entity.name}.${relation.key} points at ${relation.target.name}`);
                }
            }
        }
        if (!notSoftDeleting.length) {
            return;
        }
        throw new InternalError([
            `The data source ${dataSourceName} declares entities that soft delete, with relations whose rows cannot be:`,
            ...notSoftDeleting,
            'Their rows are soft deleted along with the row and restored with it.',
            'Extend SoftDeleteEntity on the target, or leave "remove" out of the relation\'s cascade.'
        ]);
    }

    /**
     * Whether every row of an entity needs a tenant.
     * @param entity - The entity.
     * @returns True when every row needs one, false when it is optional, undefined for a shared entity.
     */
    private resolveTenantRequired(entity: Newable<BaseEntity>): boolean | undefined {
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entity);
        return metadata == undefined ? undefined : TenantUtilities.resolveOwnership(entity, metadata)?.required;
    }
}