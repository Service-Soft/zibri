import { EntityRelations, RelationTree } from './entity-relations.model.ts';
import { isRelationMetadata } from './is-relation-metadata.function.ts';
import { RelationType } from './relation-type.enum.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { type BaseEntity } from '../base-entity.model.ts';
import { type PropertyMetadata, type RelationMetadata } from '../decorators/property.decorator.ts';

/**
 * Utilities for the relations a read resolves.
 */
export abstract class EntityRelationsUtilities {
    /**
     * Reads what a caller asked for into the shape a driver walks.
     *
     * An array names one level and an object names as many as it holds, so both arrive as the same
     * tree and nothing below has to know which was written. A tree is already one and passes
     * through, which is what lets a driver resolving a relation hand the level below it to the
     * driver of the entity it reaches.
     * @param relations - The relations as the caller wrote them, a tree, or none.
     * @returns The tree they name, which is empty when they name nothing.
     */
    static resolveTree<T>(relations: EntityRelations<T> | readonly (keyof T)[] | RelationTree | undefined): RelationTree {
        return this.treeOf(relations);
    }

    /**
     * The relations a filter cannot be answered without, as deep as it reaches.
     *
     * A store that judges rows in process needs every relation a filter names resolved on them
     * first - including the ones below a relation, which a `where` on it reaches.
     * @param where - The filter, as its branches or as one of them.
     * @param properties - The property metadata of the entity it filters.
     * @returns The tree of those relations, which is empty when it names none.
     */
    static resolveFilterTree(where: unknown, properties: Record<string, PropertyMetadata>): RelationTree {
        let res: RelationTree = new Map();
        const branches: unknown[] = Array.isArray(where) ? where : [where];
        for (const branch of branches) {
            if (branch == undefined || typeof branch !== 'object') {
                continue;
            }
            for (const [key, condition] of Object.entries(branch)) {
                const metadata: PropertyMetadata | undefined = properties[key];
                if (!isRelationMetadata(metadata)) {
                    continue;
                }
                const below: RelationTree = this.filterTreeBelow(condition, metadata);
                res = this.mergeTrees(res, new Map([[key, below]]));
            }
        }
        return res;
    }

    /**
     * The tree that holds every relation either of the two holds.
     *
     * What a caller asked for and what a filter or an order needs are resolved together rather than
     * one after the other, so a relation both of them reach is read once.
     * @param one - One tree.
     * @param other - The other tree.
     * @returns A tree holding both, merged all the way down.
     */
    static mergeTrees(one: RelationTree, other: RelationTree): RelationTree {
        const res: Map<string, RelationTree> = new Map(one);
        for (const [key, branch] of other) {
            const existing: RelationTree | undefined = res.get(key);
            res.set(key, existing == undefined ? branch : this.mergeTrees(existing, branch));
        }
        return res;
    }

    /**
     * Clears on the rows the relations that were resolved for something other than the caller.
     *
     * A filter or an order naming a relation is a reason to read it and not a reason to hand it
     * back: what a read answers with is what its `relations` asked for, so that the same rows come
     * back however they were found or sorted.
     *
     * The property is set to undefined rather than taken off the row, which is what reading it
     * answers either way - a row that was never asked for a relation reads the same as one that was
     * asked and had none.
     * @param rows - The rows to unset them on, which are changed in place.
     * @param resolved - The relations that were resolved on them.
     * @param requested - The relations the caller asked for.
     */
    static keepOnlyRequested(rows: readonly unknown[], resolved: RelationTree, requested: RelationTree): void {
        for (const [key, branch] of resolved) {
            const below: RelationTree | undefined = requested.get(key);
            for (const holder of this.holdersOf(rows)) {
                if (below == undefined) {
                    holder[key] = undefined;
                    continue;
                }
                this.keepOnlyRequested(this.holdersOf([holder[key]]), branch, below);
            }
        }
    }

    /**
     * The relations below one relation that a condition on it reaches through its `where`.
     * @param condition - The condition on the relation.
     * @param metadata - The relation's metadata.
     * @returns The tree below the relation.
     */
    private static filterTreeBelow(condition: unknown, metadata: RelationMetadata<BaseEntity>): RelationTree {
        const toMany: boolean = metadata.type === RelationType.ONE_TO_MANY || metadata.type === RelationType.MANY_TO_MANY;
        // on a relation to one entity an array is an or of conditions; on one to many it is the list
        // of entities the relation has to hold, which reaches nothing below
        const options: unknown[] = Array.isArray(condition) && !toMany ? condition : [condition];
        let res: RelationTree = new Map();
        for (const option of options) {
            if (option == undefined || typeof option !== 'object' || !('where' in option)) {
                continue;
            }
            res = this.mergeTrees(res, this.resolveFilterTree(option.where, MetadataUtilities.getModelProperties(metadata.target())));
        }
        return res;
    }

    /**
     * Reads a tree out of whatever shape the relations were written in.
     * @param value - The relations as they were written, at this level.
     * @returns The tree they name.
     */
    private static treeOf(value: unknown): RelationTree {
        if (value instanceof Map) {
            return value;
        }
        const res: Map<string, RelationTree> = new Map();
        if (Array.isArray(value)) {
            const names: unknown[] = value;
            for (const name of names) {
                res.set(String(name), new Map());
            }
            return res;
        }
        if (value == undefined || typeof value !== 'object') {
            return res;
        }
        const entries: [string, unknown][] = Object.entries(value);
        for (const [key, entry] of entries) {
            if (entry == undefined) {
                continue;
            }
            res.set(key, entry === true ? new Map() : this.treeOf(entry));
        }
        return res;
    }

    /**
     * The rows among the given values that a relation can be read off or taken off.
     *
     * A to one relation holds one and a to many relation holds an array of them, so both are walked
     * the same way from here on.
     * @param values - The values to read rows out of.
     * @returns Every row among them, flattened.
     */
    private static holdersOf(values: readonly unknown[]): Record<string, unknown>[] {
        const res: Record<string, unknown>[] = [];
        for (const value of values) {
            for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
                if (item != undefined && typeof item === 'object') {
                    // the one place a row is reached by a name rather than by a property: which
                    // relations it holds is what the tree says rather than what the type does
                    res.push(item as Record<string, unknown>);
                }
            }
        }
        return res;
    }
}