import { OneOfPropertyMetadata } from '../../../entity/models/one-of-property-metadata.model';
import { InternalError } from '../../../error-handling/internal-error.model';
import { ObjectUtilities } from '../../../utilities/object.utilities';

/**
 * Reads the filter of a value of several named shapes the same way for every data source.
 */
export abstract class OneOfWhereFilterUtilities {
    /**
     * The key a filter names a shape by.
     * @param name - The name of the shape.
     * @returns `when` followed by the name, its first letter capitalized.
     */
    static filterKey(name: string): string {
        return `when${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    }

    /**
     * Reads the filter of each shape out of the filter of a value of several shapes.
     * @param filter - The filter, naming every shape as `when` followed by its name.
     * @param metadata - The shapes the value can be.
     * @returns The filter of each shape that matches anything, by the name of the shape. A shape
     * filtered by `false` is left out.
     * @throws When the filter leaves a shape out, or names one there is not.
     */
    static shapeFilters(filter: Record<string, unknown>, metadata: Pick<OneOfPropertyMetadata, 'shapes'>): Map<string, unknown> {
        const names: Map<string, string> = new Map(ObjectUtilities.keys(metadata.shapes).map(name => [this.filterKey(name), name]));
        const expected: string[] = [...names.keys()];

        for (const key of ObjectUtilities.keys(filter)) {
            if (!names.has(key)) {
                throw new InternalError(
                    `Unknown key "${key}" on the filter of a value of several shapes, which takes ${expected.join(', ')}.`
                );
            }
        }
        const missing: string[] = expected.filter(key => filter[key] === undefined);
        if (missing.length) {
            throw new InternalError(`The filter of a value of several shapes needs every shape, but ${missing.join(', ')} is missing.`);
        }

        const res: Map<string, unknown> = new Map();
        for (const [key, name] of names) {
            if (filter[key] !== false) {
                res.set(name, filter[key]);
            }
        }
        return res;
    }

    /**
     * Whether the filter of a shape filters by nothing, and so matches every value of that shape.
     * @param filter - The filter of the shape.
     * @returns True for an empty object.
     */
    static matchesEveryValue(filter: unknown): boolean {
        return typeof filter === 'object'
            && filter !== null
            && Object.getPrototypeOf(filter) === Object.prototype
            && !ObjectUtilities.keys(filter).length;
    }
}