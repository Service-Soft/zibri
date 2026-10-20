import { Where, WhereFilter } from './where-filter.model.ts';
import { WhereValueUtilities } from './where-value.utilities.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { PropertyMetadata } from '../../../entity/decorators/property.decorator.ts';
import { EntityOrder } from '../../../entity/models/entity-order.model.ts';
import { EntityOrderUtilities } from '../../../entity/models/entity-order.utilities.ts';
import { isRelationMetadata } from '../../../entity/models/is-relation-metadata.function.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { Newable } from '../../../types/newable.type.ts';
import { MetadataUtilities } from '../../../utilities/metadata.utilities.ts';
import { ScopeWhereUtilities } from '../../scopes/scope-where.utilities.ts';

/**
 * Decides which properties a similarity can be asked of, and holds every filter to that.
 *
 * `fuzzyLike` is offered on every string property by the type of a where filter, and answering it by
 * reading the whole table is the kind of cost that is only discovered once the table is large. It is
 * answered from an index over the trigrams of a column instead, which is kept for every string
 * property that can carry text somebody searches for - and a property that cannot is refused here
 * rather than answered slowly.
 */
export class FuzzySearchUtilities {

    /**
     * Whether a similarity to the values of the given property is a question worth asking.
     *
     * What this decides is kept in one place because two things read it: the filter, which refuses
     * what it says no to, and the schema, which keeps a trigram index for what it says yes to. A
     * property those two disagreed about would be either a search with no index or an index with no
     * search.
     * @param metadata - The metadata of the property, where the entity declares it.
     * @returns True when the property holds text a search can be similar to.
     */
    static isSearchable(metadata: PropertyMetadata | undefined): boolean {
        return this.refusalFor(metadata) == undefined;
    }

    /**
     * Refuses a filter that asks for a similarity to a property that holds no text to be similar to.
     *
     * Walked once per query rather than per row, and only over the filter, which is written by the
     * caller and therefore small.
     * @param where - The filter, as the caller wrote it.
     * @param properties - The property metadata of the entity being queried.
     * @param entityClass - The entity being queried, for the message.
     * @throws When a `fuzzyLike` names a property that declares itself unsearchable, or that holds a
     * kind of value no similarity says anything about.
     */
    static validateSearchable<T extends BaseEntity>(
        where: Where<T> | undefined,
        properties: Record<string, PropertyMetadata>,
        entityClass: Newable<T>
    ): void {
        for (const branch of ScopeWhereUtilities.branchesOf(where)) {
            this.validateBranch(branch, properties, entityClass.name);
        }
    }

    /**
     * Refuses every unanswerable similarity in a single branch of a filter.
     * @param branch - One of the filters the caller's filter is an or of.
     * @param properties - The property metadata of what the branch filters.
     * @param path - What the branch filters, as it is named in a message.
     */
    private static validateBranch(branch: WhereFilter<BaseEntity>, properties: Record<string, PropertyMetadata>, path: string): void {
        for (const [property, condition] of Object.entries(branch)) {
            this.validateCondition(condition, properties[property], `${path}.${property}`);
        }
    }

    /**
     * Refuses every unanswerable similarity in what one branch asks of one property.
     * @param condition - The condition on that property, or several of which one has to hold.
     * @param metadata - The metadata of the property, where the entity declares it.
     * @param path - The property, as it is named in a message.
     * @throws When the condition asks for a similarity the property cannot answer.
     */
    private static validateCondition(condition: unknown, metadata: PropertyMetadata | undefined, path: string): void {
        if (Array.isArray(condition)) {
            for (const option of condition) {
                this.validateCondition(option, metadata, path);
            }
            return;
        }
        if (!ScopeWhereUtilities.isConditionObject(condition)) {
            return;
        }

        const refusal: string | undefined = this.refusalFor(metadata);
        if ('fuzzyLike' in condition && refusal != undefined) {
            throw new InternalError(`Cannot search "${path}" with "fuzzyLike", because ${refusal}`);
        }

        if (!('where' in condition)) {
            return;
        }
        const nested: Record<string, PropertyMetadata> | undefined = ScopeWhereUtilities.nestedProperties(metadata);
        if (nested == undefined) {
            // an array of values rather than of rows, so the nested filter is a condition on one of
            // them and there is no property under it to name
            this.validateCondition(condition['where'], WhereValueUtilities.itemMetadata(metadata), `${path}[]`);
            return;
        }
        for (const branch of ScopeWhereUtilities.branchesOf(condition['where'] as Where<BaseEntity>)) {
            this.validateBranch(branch, nested, path);
        }
    }

    /**
     * Refuses an order by similarity to a property that holds no text to be similar to.
     *
     * The same refusal a filter gets, apart from the index: an order sorts the rows the filter already
     * narrowed to, so it needs no index of its own, and a property declaring `fuzzySearchable: false`
     * can still be ordered by how similar it is.
     * @param order - The order of the read, the entity's default included.
     * @param entityClass - The entity being read.
     * @throws When a similarity is asked of a property that holds a kind of value no similarity says
     * anything about.
     */
    static validateOrderable<T>(order: EntityOrder<T> | undefined, entityClass: Newable<T>): void {
        for (const key of EntityOrderUtilities.resolveKeys(order, entityClass)) {
            if (key.similarTo == undefined) {
                continue;
            }
            const refusal: string | undefined = this.meaninglessSimilarityFor(this.metadataAt(entityClass, key.path));
            if (refusal != undefined) {
                throw new InternalError(`Cannot order "${entityClass.name}.${key.path.join('.')}" by similarity, because ${refusal}`);
            }
        }
    }

    /**
     * Follows the path of an order key to the metadata of the property it ends in.
     * @param entityClass - The entity the path starts at.
     * @param path - The property names to follow, through relations.
     * @returns The metadata, or undefined when the path does not lead to a declared property.
     */
    private static metadataAt(entityClass: Newable<unknown>, path: readonly string[]): PropertyMetadata | undefined {
        let properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        let metadata: PropertyMetadata | undefined;
        for (const [i, key] of path.entries()) {
            metadata = properties[key];
            if (i === path.length - 1) {
                break;
            }
            if (!isRelationMetadata(metadata)) {
                return undefined;
            }
            properties = MetadataUtilities.getModelProperties(metadata.target());
        }
        return metadata;
    }

    /**
     * Why a similarity to the values of the given property cannot be asked for, when it cannot.
     * @param metadata - The metadata of the property, where the entity declares it.
     * @returns The half-sentence a refusal is built from, or undefined when the property is
     * searchable.
     */
    private static refusalFor(metadata: PropertyMetadata | undefined): string | undefined {
        const meaningless: string | undefined = this.meaninglessSimilarityFor(metadata);
        if (meaningless != undefined) {
            return meaningless;
        }
        if (metadata?.type === 'string' && !metadata.fuzzySearchable) {
            return 'no trigram index is kept for it, so the search would read every row. Either it'
                + ' declares "fuzzySearchable: false", or it is a value inside an array, which is'
                + ' never indexed on its own.';
        }
        return undefined;
    }

    /**
     * Why a similarity to the values of the given property says nothing, when it says nothing.
     *
     * Every case here is a value that is not text a person wrote: it is either drawn at random, one
     * of a list, or the output of a function built so that similar inputs give unrelated results. The
     * declaration says which, so none of them needs a second flag.
     * @param metadata - The metadata of the property, where the entity declares it.
     * @returns The half-sentence a refusal is built from, or undefined when a similarity to the
     * property's values says something.
     */
    private static meaninglessSimilarityFor(metadata: PropertyMetadata | undefined): string | undefined {
        if (metadata?.type !== 'string') {
            return 'only a string property holds text to be similar to.';
        }
        if (metadata.format === 'uuid') {
            return 'it holds a uuid, which is drawn at random, so a value similar to another one'
                + ' says nothing about the rows they identify. Filter by the value itself instead.';
        }
        if (metadata.enum != undefined) {
            return 'it holds one of a fixed set of values, which "is" and "oneOf" answer exactly.';
        }
        if (metadata.hash !== false) {
            return 'it is stored hashed, and a hash is built so that similar values hash to unrelated'
                + ' digests. Compare the value through the hash service instead.';
        }
        if (metadata.encryption !== false) {
            return 'it is stored encrypted, so the stored value is similar to nothing the caller has.';
        }
        return undefined;
    }
}