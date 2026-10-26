import { resolveEntityScope } from './resolve-entity-scope.function';
import { ScopedWhere, ScopeWhereUtilities } from './scope-where.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error';
import { RelationTree } from '../../entity/models/entity-relations.model';
import { EntityRelationsUtilities } from '../../entity/models/entity-relations.utilities';
import { denyAll, DenyAll, Unscoped } from '../../entity/models/entity-scope.model';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { isSoftDeleteEntityNewable } from '../change-sets/models/is-soft-delete-entity.function';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';

/**
 * Narrows the rows a call reaches through a relation to the rows the caller may see of them.
 */
export abstract class RelatedNarrowingUtilities {

    /**
     * Resolves what the rows of every entity a call reaches through a relation are narrowed to.
     *
     * An entity is reached by the relations the call resolves, by the relations its filter names, and
     * by the relations the narrowing of an entity reached names in turn. Each one's narrowing is its
     * scope, asked once per call, and the rows of it that are not soft deleted.
     * @param entityClass - The entity of the call.
     * @param where - The filter of the call, with the entity's own scope applied.
     * @param relations - The relations the call resolves.
     * @param unscoped - Which scopes the call is exempt from, which its related rows are exempt from too.
     * @returns The narrowing per entity reached. An entity whose rows are not narrowed is left out.
     */
    static async resolve<T extends BaseEntity>(
        entityClass: Newable<T>,
        where: Where<T> | undefined,
        relations: RelationTree,
        unscoped: Unscoped | undefined
    ): Promise<RelatedNarrowing> {
        const res: Map<Newable<BaseEntity>, Where<BaseEntity> | DenyAll> = new Map();
        const seen: Set<Newable<BaseEntity>> = new Set();
        const pending: Newable<BaseEntity>[] = [];
        this.collectReached(entityClass, this.treeOf(entityClass, where, relations), seen, pending);
        for (let target: Newable<BaseEntity> | undefined = pending.shift(); target != undefined; target = pending.shift()) {
            const narrowing: Where<BaseEntity> | DenyAll | undefined = await this.narrowingOf(target, unscoped);
            if (narrowing == undefined) {
                continue;
            }
            res.set(target, narrowing);
            if (narrowing !== denyAll) {
                this.collectReached(target, this.treeOf(target, narrowing, new Map()), seen, pending);
            }
        }
        return res;
    }

    /**
     * Narrows a filter on the rows of an entity reached through a relation.
     * @param where - The filter, if any.
     * @param target - The entity reached.
     * @param related - The narrowing per entity, if the call carries one.
     * @returns The filter to read with, or the note that nothing can match it.
     */
    static narrow<E extends BaseEntity>(
        where: Where<E> | undefined,
        target: Newable<E>,
        related: RelatedNarrowing | undefined
    ): ScopedWhere<E> {
        const narrowing: Where<E> | DenyAll | undefined = this.narrowingFor(target, related);
        if (narrowing === denyAll) {
            return { matchesNothing: true, where: undefined };
        }
        return ScopeWhereUtilities.applyToWhere(where, narrowing, MetadataUtilities.getModelProperties(target));
    }

    /**
     * What the rows of one entity are narrowed to, as a filter over that entity.
     * @param target - The entity.
     * @param related - The narrowing per entity, if the call carries one.
     * @returns The narrowing, undefined when the rows are not narrowed.
     */
    private static narrowingFor<E extends BaseEntity>(
        target: Newable<E>,
        related: RelatedNarrowing | undefined
    ): Where<E> | DenyAll | undefined {
        // the one place the map is read: it pairs each entity with a filter over that entity, which
        // is more than a map's type can say, so the filter is typed by the key it was read under
        return related?.get(target) as Where<E> | DenyAll | undefined;
    }

    /**
     * Narrows every filter through a relation inside a filter, as deep as it reaches.
     *
     * For a store that judges a filter through a relation in a query of its own rather than on rows
     * it resolved: `{ tasks: { where: w } }` asks about the tasks the caller may see, so `w` is
     * narrowed to them, and so is every filter through a relation inside `w` in turn. A branch whose
     * narrowed filter nothing can match is dropped, since no row of it can match either.
     * @param where - The filter.
     * @param entityClass - The entity it filters.
     * @param related - What the rows each relation reaches are narrowed to.
     * @returns The filter with its relation filters narrowed, or the note that nothing can match it.
     */
    static narrowFilter<T extends BaseEntity>(
        where: Where<T>,
        entityClass: Newable<T>,
        related: RelatedNarrowing | undefined
    ): ScopedWhere<T> {
        if (!related?.size) {
            return { matchesNothing: false, where };
        }
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const branches: WhereFilter<T>[] = [];
        for (const branch of ScopeWhereUtilities.branchesOf(where)) {
            const narrowed: WhereFilter<T> | undefined = this.narrowBranch(branch, properties, related);
            if (narrowed != undefined) {
                branches.push(narrowed);
            }
        }
        if (!branches.length) {
            return { matchesNothing: true, where: undefined };
        }
        return { matchesNothing: false, where: Array.isArray(where) || branches.length > 1 ? branches : branches[0] };
    }

    /**
     * Narrows the relation filters of one branch.
     * @param branch - The branch.
     * @param properties - The property metadata of the entity it filters.
     * @param related - What the rows each relation reaches are narrowed to.
     * @returns The branch, or undefined when a relation filter in it can match nothing.
     */
    private static narrowBranch<T extends BaseEntity>(
        branch: WhereFilter<T>,
        properties: Record<string, PropertyMetadata>,
        related: RelatedNarrowing
    ): WhereFilter<T> | undefined {
        const res: Record<string, unknown> = { ...branch };
        for (const [key, condition] of Object.entries(branch)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            const nested: unknown = ScopeWhereUtilities.isConditionObject(condition) ? condition['where'] : undefined;
            if (!isRelationMetadata(metadata) || nested == undefined) {
                continue;
            }
            const target: Newable<BaseEntity> = metadata.target();
            const below: ScopedWhere<BaseEntity> = this.narrowFilter(nested as Where<BaseEntity>, target, related);
            const narrowed: ScopedWhere<BaseEntity> = below.matchesNothing
                ? below
                : this.narrow(below.where, target, related);
            if (narrowed.matchesNothing) {
                return undefined;
            }
            res[key] = { ...condition as Record<string, unknown>, where: narrowed.where };
        }
        // the same keys as the branch, each holding its condition narrowed
        return res as WhereFilter<T>;
    }

    /**
     * The relations a call reaches: the ones it resolves and the ones its filter names, as deep as
     * either goes.
     * @param entityClass - The entity of the call.
     * @param where - Its filter.
     * @param relations - The relations it resolves.
     * @returns The tree of both.
     */
    private static treeOf(entityClass: Newable<BaseEntity>, where: unknown, relations: RelationTree): RelationTree {
        return EntityRelationsUtilities.mergeTrees(
            relations,
            EntityRelationsUtilities.resolveFilterTree(where, MetadataUtilities.getModelProperties(entityClass))
        );
    }

    /**
     * Collects every entity a tree of relations reaches, once each.
     * @param entityClass - The entity the tree starts at.
     * @param tree - The tree.
     * @param seen - The entities collected so far.
     * @param pending - Where an entity seen for the first time is put.
     */
    private static collectReached(
        entityClass: Newable<BaseEntity>,
        tree: RelationTree,
        seen: Set<Newable<BaseEntity>>,
        pending: Newable<BaseEntity>[]
    ): void {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        for (const [key, below] of tree) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (!isRelationMetadata(metadata)) {
                continue;
            }
            const target: Newable<BaseEntity> = metadata.target();
            if (!seen.has(target)) {
                seen.add(target);
                pending.push(target);
            }
            this.collectReached(target, below, seen, pending);
        }
    }

    /**
     * What the rows of one entity reached through a relation are narrowed to.
     * @param target - The entity.
     * @param unscoped - Which scopes the call is exempt from.
     * @returns The narrowing, or undefined when nothing narrows the rows.
     * @throws Whatever the entity's scope throws, which is how it refuses a caller outright.
     */
    private static async narrowingOf(
        target: Newable<BaseEntity>,
        unscoped: Unscoped | undefined
    ): Promise<Where<BaseEntity> | DenyAll | undefined> {
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(target);
        if (!metadata) {
            throw new EntityMetadataMissingError(target);
        }
        const scope: Where<BaseEntity> | DenyAll | undefined = await resolveEntityScope(target, metadata, unscoped);
        if (scope === denyAll) {
            return denyAll;
        }
        // whatever the call says about the soft deleted rows of its own entity: `deleted` chooses
        // among those, and a related entity's deleted rows are reached through its own repository
        const live: Where<SoftDeleteEntity> | undefined = isSoftDeleteEntityNewable(target) ? { deleted: false } : undefined;
        if (scope == undefined || live == undefined) {
            return scope ?? live;
        }
        const combined: ScopedWhere<BaseEntity> = ScopeWhereUtilities.applyToWhere(
            scope,
            live,
            MetadataUtilities.getModelProperties(target)
        );
        return combined.matchesNothing ? denyAll : combined.where;
    }
}