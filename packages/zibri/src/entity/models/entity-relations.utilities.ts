import { EntityRelations, RelationTree } from './entity-relations.model';

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