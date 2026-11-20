import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { Where } from '../../data-source/models/where/where-filter.model';
import { AppendOnlyUtilities } from '../../data-source/repository/append-only.utilities';
import { Repository } from '../../data-source/repository/repository';
import { INVITATION_ENTITY, MEMBERSHIP_ENTITY, ROLE_ENTITY } from '../../data-source/repository/repository-kind.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { EntityTenant } from '../../entity/models/entity-tenant.model';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { Relation } from '../../entity/models/relation.enum';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { TenantDeletion } from './tenant-deletion.model';

/**
 * The rows of one entity a tenant deletion deletes: those whose property holds the tenant.
 */
export type TenantDeletionStep = {
    /**
     * The data source holding the entity.
     */
    dataSource: DataSourceInterface,
    /**
     * The entity.
     */
    entity: Newable<BaseEntity>,
    /**
     * The property holding the tenant: the tenant property of an entity of tenants, `tenantId` of a shared one.
     */
    property: string,
    /**
     * Whether the rows are shared ones naming the tenant, which are reached outside every tenant.
     */
    shared: boolean
};

/**
 * Works out what deleting a tenant deletes, and in which order, and deletes it a batch at a time.
 */
export abstract class TenantDeletionUtilities {
    /**
     * Resolves the entities whose rows a tenant deletion deletes, in the order it deletes them: the rows of the tenant
     * that others point at after those pointing at them, its invitations and memberships, the rows whose tenant is
     * optional, its own roles once nobody holds them, and the shared rows naming it. The tenant itself goes last, and
     * is no step. Append only rows, such as the audit trail, stay.
     * @param dataSources - The data sources of the application.
     * @param tenantEntity - The entity of the tenants, which is left out.
     * @returns The steps.
     */
    static resolveSteps(dataSources: DataSourceInterface[], tenantEntity: Newable<BaseEntity>): TenantDeletionStep[] {
        const candidates: TenantDeletionStep[] = dataSources.flatMap(dataSource => dataSource.entities
            .filter(entity => entity !== tenantEntity && entity !== TenantDeletion && !AppendOnlyUtilities.isAppendOnly(entity))
            .map(entity => this.resolveStep(dataSource, entity))
            .filter(step => step != undefined));

        const ofTenant: TenantDeletionStep[] = candidates.filter(step => !step.shared);
        const isKind: (step: TenantDeletionStep, mark: symbol) => boolean = (step, mark) => mark in step.entity;
        const roles: TenantDeletionStep[] = ofTenant.filter(step => isKind(step, ROLE_ENTITY));
        // the memberships hold the names of the roles, which a role somebody holds is not deleted while they do
        const members: TenantDeletionStep[] = [
            ...ofTenant.filter(step => isKind(step, INVITATION_ENTITY)),
            ...ofTenant.filter(step => isKind(step, MEMBERSHIP_ENTITY))
        ];
        const rest: TenantDeletionStep[] = ofTenant.filter(step => !roles.includes(step) && !members.includes(step));
        // the rows of optional tenants are what deleting the others writes along the way, such as events and logs
        const required: TenantDeletionStep[] = rest.filter(step => this.isTenantRequired(step));
        const optional: TenantDeletionStep[] = rest.filter(step => !this.isTenantRequired(step));
        return [
            ...this.orderPointingFirst(required),
            ...members,
            ...this.orderPointingFirst(optional),
            ...roles,
            ...this.orderPointingFirst(candidates.filter(step => step.shared))
        ];
    }

    /**
     * Deletes a batch of the rows of a step, through the repository of the data source, so that what follows a
     * delete applies. Run inside the tenant.
     * @param step - The step.
     * @param tenantId - The tenant.
     * @param size - How many rows at most.
     * @returns How many rows were deleted, 0 once there are none left.
     */
    static async deleteBatch(step: TenantDeletionStep, tenantId: string, size: number): Promise<number> {
        const repository: Repository<BaseEntity> = step.dataSource.getRepository(step.entity);
        const where: Where<BaseEntity> = Object.fromEntries([[step.property, tenantId]]);
        // every row, whatever a scope lets a caller see, and the shared ones from wherever this runs
        const rows: Pick<BaseEntity, 'id'>[] = await repository.findAll({
            where,
            select: ['id'],
            limit: size,
            unscoped: true,
            acrossTenants: step.shared
        });
        return !rows.length
            ? 0
            : await repository.deleteAll({ id: { oneOf: rows.map(row => row.id) } }, { unscoped: true, acrossTenants: step.shared });
    }

    /**
     * Resolves the step of an entity, if a tenant deletion deletes rows of it.
     * @param dataSource - The data source holding it.
     * @param entity - The entity.
     * @returns The step, or undefined for a shared entity naming no tenant.
     */
    private static resolveStep(dataSource: DataSourceInterface, entity: Newable<BaseEntity>): TenantDeletionStep | undefined {
        const tenant: EntityTenant | undefined = MetadataUtilities.getEntityMetadata(entity)?.tenant;
        if (tenant == undefined) {
            return undefined;
        }
        if (tenant !== 'shared') {
            return { dataSource, entity, property: tenant.property, shared: false };
        }
        // a shared row bound to one tenant, such as an api key acting in it, names it the way the rows of a tenant do
        const property: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entity)['tenantId'];
        return property?.type === 'string' && property.format === 'uuid'
            ? { dataSource, entity, property: 'tenantId', shared: true }
            : undefined;
    }

    private static isTenantRequired(step: TenantDeletionStep): boolean {
        return MetadataUtilities.getModelProperties(step.entity)[step.property]?.required !== false;
    }

    /**
     * Orders steps so that the rows pointing at the rows of another step are deleted before them.
     * @param steps - The steps.
     * @returns The same steps, ordered.
     */
    private static orderPointingFirst(steps: TenantDeletionStep[]): TenantDeletionStep[] {
        const remaining: TenantDeletionStep[] = [...steps];
        const ordered: TenantDeletionStep[] = [];
        for (;;) {
            // a step no other remaining step points at, or, among steps pointing at each other, the first of them
            const next: TenantDeletionStep | undefined = remaining
                .find(step => !remaining.some(other => other !== step && this.pointsAt(other, step))) ?? remaining[0];
            if (next == undefined) {
                return ordered;
            }
            ordered.push(next);
            remaining.splice(remaining.indexOf(next), 1);
        }
    }

    /**
     * Whether the rows of one step hold the key of rows of another.
     * @param from - The step whose rows may point.
     * @param to - The step whose rows may be pointed at.
     * @returns True when an entity of the first holds a relation to the second by a column of its own.
     */
    private static pointsAt(from: TenantDeletionStep, to: TenantDeletionStep): boolean {
        return Object.values(MetadataUtilities.getModelProperties(from.entity)).some(property => isRelationMetadata(property)
            && (property.type === Relation.MANY_TO_ONE || property.type === Relation.BELONGS_TO_ONE)
            && property.target() === to.entity);
    }
}