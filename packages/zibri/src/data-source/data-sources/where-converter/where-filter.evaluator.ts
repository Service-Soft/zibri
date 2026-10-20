import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { PropertyMetadata } from '../../../entity/decorators/property.decorator.ts';
import { OneOfPropertyMetadata, OneOfShapeMetadata } from '../../../entity/models/one-of-property-metadata.model.ts';
import { RelationType } from '../../../entity/models/relation-type.enum.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { isNamedValue } from '../../../parsing/functions/parse-one-of.function.ts';
import { Newable } from '../../../types/newable.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { MetadataUtilities } from '../../../utilities/metadata.utilities.ts';
import { BigNumber } from '../../../utilities/number.utilities.ts';
import { ObjectUtilities } from '../../../utilities/object.utilities.ts';
import { TrigramUtilities } from '../../../utilities/trigram.utilities.ts';
import { parseFuzzyLikeFilter } from '../../models/where/fuzzy-like.model.ts';
import { OneOfWhereFilterUtilities } from '../../models/where/one-of-where-filter.utilities.ts';
import { isAllOfWhereFilterKey, isWhereFilterKey, WhereFilterKeys } from '../../models/where/where-filter-keys.model.ts';
import { Where, WhereFilter, WhereFilterProperty } from '../../models/where/where-filter.model.ts';
import { WhereValueUtilities } from '../../models/where/where-value.utilities.ts';
import { StoredValueTypeMismatchError } from '../../stored-value-type-mismatch.error.ts';

/**
 * Handler for a single where filter key.
 */
type EvaluationHandler = (value: unknown, filterValue: unknown, metadata: PropertyMetadata | undefined, path: string) => boolean;

/**
 * The keys that compare a stored value with a value they name, which only a value of the declared
 * type can be.
 */
const COMPARING_KEYS: ReadonlySet<WhereFilterKeys> = new Set<WhereFilterKeys>([
    'not',
    'oneOf',
    'notOneOf',
    'after',
    'afterOrOn',
    'before',
    'beforeOrOn',
    'greaterThan',
    'greaterThanEquals',
    'lesserThan',
    'lesserThanEquals'
]);

/**
 * Evaluates a Zibri where filter in process, against plain javascript objects.
 *
 * This is used by data sources that cannot push filtering down into the storage engine itself,
 * eg. The ValKeyDataSource. Relations and nested objects need to be resolved on the given item
 * before it is handed to the evaluator.
 *
 * ## Null handling
 * A null value is a value for the questions of equality: it is what `is: null` and a null listed
 * under `oneOf` ask for, and it is not whatever `not` or `notOneOf` name, so those match it unless
 * they name null. `notLike` and `notILike` match it, since it is like nothing. Every other comparison
 * (`greaterThan`, `like`, ...) is never satisfied by it.
 *
 * ## Values of another type
 * A stored value that is not of the number, date or boolean type its property declares cannot be
 * compared with anything, so a filter that compares it throws a {@link StoredValueTypeMismatchError}
 * naming the property. Asking whether it is null does not compare it.
 */
export class WhereFilterEvaluator {

    /**
     * The lists of `oneOf` and `notOneOf` already read into a set, or undefined for a list holding a
     * value a set cannot compare. Keyed by the list itself, which one filter hands over for every row.
     */
    private readonly listedSets: WeakMap<unknown[], Set<unknown> | undefined> = new WeakMap();

    private readonly handlers: Record<WhereFilterKeys, EvaluationHandler> = {
        // a row holding no value is not the value named, so it matches - the way `notOneOf` answers,
        // and the way a scope folding one into the other needs both to answer
        not: (value, filterValue, metadata) => filterValue === null
            ? value != undefined
            : value == undefined || !WhereValueUtilities.equals(value, filterValue, metadata),
        oneOf: (value, filterValue, metadata) => value == undefined
            ? this.toArray(filterValue, 'oneOf').some(v => v === null)
            : this.isListed(value, this.toArray(filterValue, 'oneOf'), metadata),
        notOneOf: (value, filterValue, metadata) => value == undefined
            ? !this.toArray(filterValue, 'notOneOf').some(v => v === null)
            : !this.isListed(value, this.toArray(filterValue, 'notOneOf'), metadata),
        like: (value, filterValue) => typeof value === 'string' && this.likeToRegex(String(filterValue), false).test(value),
        iLike: (value, filterValue) => typeof value === 'string' && this.likeToRegex(String(filterValue), true).test(value),
        // the complement of like: a row holding no value is like nothing, so it is unlike every pattern
        notLike: (value, filterValue) => typeof value !== 'string' || !this.likeToRegex(String(filterValue), false).test(value),
        notILike: (value, filterValue) => typeof value !== 'string' || !this.likeToRegex(String(filterValue), true).test(value),
        fuzzyLike: (value, filterValue) => this.matchesFuzzyLike(value, filterValue),
        is: (value, filterValue, metadata) => filterValue === null
            ? value == undefined
            : WhereValueUtilities.equals(value, WhereValueUtilities.unwrapRelation(filterValue, metadata), metadata),
        after: (value, filterValue) => WhereValueUtilities.compare(value, filterValue) > 0,
        afterOrOn: (value, filterValue) => WhereValueUtilities.compare(value, filterValue) >= 0,
        before: (value, filterValue) => WhereValueUtilities.compare(value, filterValue) < 0,
        beforeOrOn: (value, filterValue) => WhereValueUtilities.compare(value, filterValue) <= 0,
        greaterThan: (value, filterValue) => WhereValueUtilities.compare(value, filterValue) > 0,
        greaterThanEquals: (value, filterValue) => WhereValueUtilities.compare(value, filterValue) >= 0,
        lesserThan: (value, filterValue) => WhereValueUtilities.compare(value, filterValue) < 0,
        lesserThanEquals: (value, filterValue) => WhereValueUtilities.compare(value, filterValue) <= 0,
        where: (value, filterValue, metadata, path) => this.matchesNestedWhere(value, filterValue, metadata, path),
        // a missing array is asked for with null alone, so none of the array keys below finds one
        includes: (value, filterValue, metadata) => {
            const items: unknown[] | undefined = this.findItems(value);
            return items != undefined && this.toArray(filterValue, 'includes')
                .every(v => items.some(i => WhereValueUtilities.equals(i, v, WhereValueUtilities.itemMetadata(metadata))));
        },
        // not empty as well: an empty array is asked for with a length of 0 alone, so that no allow
        // list finds one without saying so
        isIncludedIn: (value, filterValue, metadata) => {
            const items: unknown[] | undefined = this.findItems(value);
            const allowed: unknown[] = this.toArray(filterValue, 'isIncludedIn');
            return items != undefined && items.length > 0
                && items.every(i => allowed.some(v => WhereValueUtilities.equals(i, v, WhereValueUtilities.itemMetadata(metadata))));
        },
        length: (value, filterValue) => this.matchesLength(value, l => l === Number(filterValue)),
        lengthGreaterThan: (value, filterValue) => this.matchesLength(value, l => l > Number(filterValue)),
        lengthGreaterThanEquals: (value, filterValue) => this.matchesLength(value, l => l >= Number(filterValue)),
        lengthLesserThan: (value, filterValue) => this.matchesLength(value, l => l < Number(filterValue)),
        lengthLesserThanEquals: (value, filterValue) => this.matchesLength(value, l => l <= Number(filterValue))
    };

    /**
     * Checks whether or not the given item matches the given where filter.
     * @param item - The item to check.
     * @param filter - The where filter that the item needs to match.
     * @param entityClass - The class of the item, used to resolve the property metadata.
     * @returns True when the item matches the filter, false otherwise.
     * @throws {StoredValueTypeMismatchError} When the filter compares a value that is not of the
     * type its property declares.
     */
    matches<T extends object>(item: T, filter: Where<T>, entityClass: Newable<T>): boolean {
        return this.matchesAt(item, filter, entityClass, entityClass.name);
    }

    /**
     * Matches an item that is reached at the given path.
     * @param item - The item to check.
     * @param filter - The where filter that the item needs to match.
     * @param cls - The class of the item.
     * @param path - Where the item is, starting at the entity the filter was written for.
     * @returns True when the item matches the filter, false otherwise.
     */
    private matchesAt<T extends object>(item: T, filter: Where<T>, cls: Newable<T>, path: string): boolean {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        if (Array.isArray(filter)) {
            return filter.some(f => this.matchesSingleFilter(item, f, properties, path));
        }
        return this.matchesSingleFilter(item, filter, properties, path);
    }

    private matchesSingleFilter<T extends object>(
        item: T,
        filter: WhereFilter<T>,
        properties: Record<string, PropertyMetadata>,
        path: string
    ): boolean {
        for (const key of ObjectUtilities.keys(filter)) {
            const filterProperty: WhereFilterProperty<T[typeof key]> | WhereFilterProperty<T[typeof key]>[] | undefined = filter[key];
            if (filterProperty === undefined) {
                continue;
            }
            if (!this.matchesProperty(
                (item as Record<string, unknown>)[key as string],
                filterProperty,
                properties[key as string],
                `${path}.${key as string}`
            )) {
                return false;
            }
        }
        return true;
    }

    private matchesProperty(value: unknown, filterProperty: unknown, metadata: PropertyMetadata | undefined, path: string): boolean {
        // an array of filters means "or", unless the property itself holds an array, in which case it is the value to compare against
        if (Array.isArray(filterProperty) && metadata?.type !== 'array') {
            return filterProperty.some(f => this.matchesSingleProperty(value, f, metadata, path));
        }
        return this.matchesSingleProperty(value, filterProperty, metadata, path);
    }

    private matchesSingleProperty(value: unknown, filterProperty: unknown, metadata: PropertyMetadata | undefined, path: string): boolean {
        if (filterProperty === null) {
            return value == undefined;
        }
        if (
            typeof filterProperty === 'string'
            || typeof filterProperty === 'number'
            || typeof filterProperty === 'bigint'
            || typeof filterProperty === 'boolean'
            || filterProperty instanceof Date
            || filterProperty instanceof BigNumber
            || Array.isArray(filterProperty)
        ) {
            this.validateStoredType(value, metadata, path);
            return WhereValueUtilities.equals(value, filterProperty, metadata);
        }
        if (typeof filterProperty !== 'object') {
            // eslint-disable-next-line typescript/no-base-to-string
            throw new InternalError(`Unexpected where filter value "${String(filterProperty)}"`);
        }
        if (metadata?.type === 'oneOf') {
            return this.matchesOneOf(value, filterProperty as Record<string, unknown>, metadata, path);
        }

        const keys: string[] = ObjectUtilities.keys(filterProperty as Record<string, unknown>);
        if (!keys.length) {
            throw new InternalError('Empty where filter');
        }

        for (const key of keys) {
            if (!isWhereFilterKey(key)) {
                throw new InternalError(`Unknown key "${key}" on where filter`);
            }
            const filterValue: unknown = (filterProperty as Record<string, unknown>)[key];
            if (filterValue === undefined) {
                continue;
            }
            // asking for null is asking whether there is a value, which one of any type answers
            if (filterValue !== null && COMPARING_KEYS.has(key)) {
                this.validateStoredType(value, metadata, path);
            }
            if (!this.everyOf(key, filterValue).every(v => this.handlers[key](value, v, metadata, path))) {
                return false;
            }
        }
        return true;
    }

    /**
     * Matches a value of several named shapes by the filter of the shape it names.
     * @param value - The value, naming its shape.
     * @param filter - The filter, naming every shape as `when` followed by its name.
     * @param metadata - The property.
     * @param path - Where the value is, starting at the entity the filter was written for.
     * @returns Whether the value matches the filter of its shape.
     * @throws When the filter leaves a shape out, or names one the property does not have.
     */
    private matchesOneOf(value: unknown, filter: Record<string, unknown>, metadata: OneOfPropertyMetadata, path: string): boolean {
        const shapeFilters: Map<string, unknown> = OneOfWhereFilterUtilities.shapeFilters(filter, metadata);
        if (!isNamedValue(value)) {
            return false;
        }
        const shape: OneOfShapeMetadata | undefined = metadata.shapes[value.shape];
        if (shape == undefined || !shapeFilters.has(value.shape)) {
            return false;
        }
        const shapeFilter: unknown = shapeFilters.get(value.shape);
        if (OneOfWhereFilterUtilities.matchesEveryValue(shapeFilter)) {
            return true;
        }
        return this.matchesProperty(value.value, shapeFilter, { ...shape }, path);
    }

    private matchesNestedWhere(value: unknown, filterValue: unknown, metadata: PropertyMetadata | undefined, path: string): boolean {
        if (metadata == undefined) {
            throw new InternalError('The "where" operator is not supported on this property without metadata.');
        }
        if (metadata.type === 'object') {
            return value != undefined
                && this.matchesAt(value, filterValue as Where<object>, metadata.cls() as Newable<object>, path);
        }
        if (metadata.type === 'array') {
            if (metadata.items.type !== 'object') {
                const itemMetadata: PropertyMetadata = { ...metadata.items };
                return this.toItems(value).some(i => this.matchesProperty(i, filterValue, itemMetadata, path));
            }
            const itemClass: Newable<object> = metadata.items.cls() as Newable<object>;
            return this.toItems(value).some(i => this.matchesAt(i as object, filterValue as Where<object>, itemClass, path));
        }
        if (this.isRelation(metadata)) {
            const targetClass: Newable<BaseEntity> = metadata.target();
            if (metadata.type === RelationType.ONE_TO_MANY || metadata.type === RelationType.MANY_TO_MANY) {
                return this.toItems(value)
                    .some(i => this.matchesAt(i as BaseEntity, filterValue as Where<BaseEntity>, targetClass, path));
            }
            return value != undefined && this.matchesAt(value as BaseEntity, filterValue as Where<BaseEntity>, targetClass, path);
        }
        throw new InternalError('The "where" operator was used on a property that is not an object, array or relation.');
    }

    private matchesFuzzyLike(value: unknown, filterValue: unknown): boolean {
        const { value: search, minSimilarityRatio, bound } = parseFuzzyLikeFilter(filterValue);
        if (typeof value !== 'string') {
            return false;
        }
        const similarity: number = TrigramUtilities.resolveSimilarity(value, search);
        if (bound == undefined) {
            return similarity >= minSimilarityRatio;
        }
        const boundSimilarity: number = TrigramUtilities.resolveSimilarity(bound.text, search);
        return bound.comparison === 'lesser' ? similarity < boundSimilarity : similarity === boundSimilarity;
    }

    /**
     * Turns a like pattern into the regex matching what it does: `%` any text, `_` any one character,
     * and a backslash making the character after it literal - postgres' default escape, which a
     * pattern has to read the same way on every data source.
     * @param pattern - The pattern.
     * @param ignoreCase - Whether case is ignored.
     * @returns The regex.
     * @throws InternalError when the pattern ends with a backslash, which makes nothing literal.
     */
    private likeToRegex(pattern: string, ignoreCase: boolean): RegExp {
        let source: string = '';
        for (let i: number = 0; i < pattern.length; i++) {
            const char: string = pattern.charAt(i);
            if (char === '\\') {
                i++;
                if (i === pattern.length) {
                    throw new InternalError(`The like pattern "${pattern}" ends with a backslash, which makes nothing literal.`);
                }
                source += this.escapeRegex(pattern.charAt(i));
                continue;
            }
            source += char === '%' ? '.*' : char === '_' ? '.' : this.escapeRegex(char);
        }
        return new RegExp(`^${source}$`, ignoreCase ? 'is' : 's');
    }

    private escapeRegex(char: string): string {
        return char.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
    }

    /**
     * Refuses a stored value that is not of the type its property declares.
     * @param value - The stored value.
     * @param metadata - The property it belongs to.
     * @param path - Where the value is, starting at the entity the filter was written for.
     * @throws {StoredValueTypeMismatchError} When the value is not of the declared type.
     */
    private validateStoredType(value: unknown, metadata: PropertyMetadata | undefined, path: string): void {
        if (value == undefined || metadata == undefined || this.holdsDeclaredType(value, metadata)) {
            return;
        }
        throw new StoredValueTypeMismatchError({
            path,
            declaredType: metadata.type,
            // spelled the way a json value is read out as text: a string as itself, anything else as
            // its json, so that the message names the same value on every store
            value: typeof value === 'string' ? value : JsonUtilities.stringify(value)
        });
    }

    /**
     * Whether a stored value is of the type its property declares, as far as comparing it goes.
     *
     * Only the types a comparison has to read the value as: a string compares as the text it holds,
     * and the other kinds are compared as a whole or not at all.
     * @param value - The stored value, which is not null.
     * @param metadata - The property it belongs to.
     * @returns False when a comparison cannot read the value as the declared type.
     */
    private holdsDeclaredType(value: unknown, metadata: PropertyMetadata): boolean {
        switch (metadata.type) {
            case 'number': {
                return typeof value === 'number' || typeof value === 'bigint' || value instanceof BigNumber;
            }
            case 'date': {
                // text spelling a moment is compared as that moment, the way a database reads it
                const date: Date = value instanceof Date ? value : new Date(String(value));
                return (value instanceof Date || typeof value === 'string') && !Number.isNaN(date.getTime());
            }
            case 'boolean': {
                return typeof value === 'boolean';
            }
            case 'string':
            case 'file':
            case 'object':
            case 'array':
            case 'oneOf':
            case RelationType.HAS_ONE:
            case RelationType.BELONGS_TO_ONE:
            case RelationType.ONE_TO_MANY:
            case RelationType.MANY_TO_ONE:
            case RelationType.MANY_TO_MANY:
            case 'unknown': {
                return true;
            }
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    private isRelation(metadata: PropertyMetadata): metadata is Extract<PropertyMetadata, { target: unknown }> {
        return metadata.type === RelationType.HAS_ONE
            || metadata.type === RelationType.BELONGS_TO_ONE
            || metadata.type === RelationType.MANY_TO_ONE
            || metadata.type === RelationType.ONE_TO_MANY
            || metadata.type === RelationType.MANY_TO_MANY;
    }

    /**
     * The values a key asks of the property.
     * @param key - The key of the filter.
     * @param filterValue - What the key holds.
     * @returns Every value the property has to satisfy, which is one for every key but the few that
     * take several.
     * @throws When a key that takes several values is given none.
     */
    private everyOf(key: WhereFilterKeys, filterValue: unknown): unknown[] {
        if (!isAllOfWhereFilterKey(key) || !Array.isArray(filterValue)) {
            return [filterValue];
        }
        if (!filterValue.length) {
            throw new InternalError(`The "${key}" property of the where filter needs at least one value.`);
        }
        return filterValue;
    }

    private toItems(value: unknown): unknown[] {
        if (value == undefined) {
            return [];
        }
        return Array.isArray(value) ? value : [value];
    }

    /**
     * The items of a value, unless there is no value at all.
     * @param value - The value of an array property or of a relation to many rows.
     * @returns The items, or undefined when the property holds no array.
     */
    private findItems(value: unknown): unknown[] | undefined {
        return value == undefined ? undefined : this.toItems(value);
    }

    /**
     * Whether a value holds an array whose length is the one asked for.
     * @param value - The value of an array property or of a relation to many rows.
     * @param matches - Whether a length is the one asked for.
     * @returns False when the property holds no array.
     */
    private matchesLength(value: unknown, matches: (length: number) => boolean): boolean {
        const items: unknown[] | undefined = this.findItems(value);
        return items != undefined && matches(items.length);
    }

    /**
     * Whether a value equals one of the values a list holds besides null.
     * @param value - The value, which is not null.
     * @param list - The list of a `oneOf` or `notOneOf`.
     * @param metadata - The property the value belongs to.
     * @returns True when one of them equals it.
     */
    private isListed(value: unknown, list: unknown[], metadata: PropertyMetadata | undefined): boolean {
        const listed: Set<unknown> | undefined = this.resolveListedSet(list);
        // where comparing is `===` on both sides a set answers the same, once per list rather than
        // once per row: a read of every row a batch just wrote lists all of their ids, and asking
        // each row about each id was the square of the batch. NaN is the one value `===` and a set
        // disagree on
        if (listed != undefined && this.isComparedByIdentity(value) && !Number.isNaN(value)) {
            return listed.has(value);
        }
        return list.some(v => v !== null && WhereValueUtilities.equals(value, v, metadata));
    }

    /**
     * Reads a list into a set, once per list.
     * @param list - The list of a `oneOf` or `notOneOf`.
     * @returns Its values besides null, or undefined when one of them is compared by more than
     * identity.
     */
    private resolveListedSet(list: unknown[]): Set<unknown> | undefined {
        if (this.listedSets.has(list)) {
            return this.listedSets.get(list);
        }
        const res: Set<unknown> | undefined = list.every(v => v === null || this.isComparedByIdentity(v))
            ? new Set(list.filter(v => v !== null))
            : undefined;
        this.listedSets.set(list, res);
        return res;
    }

    private isComparedByIdentity(value: unknown): value is string | number | boolean {
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    }

    private toArray(value: unknown, key: string): unknown[] {
        if (!Array.isArray(value)) {
            throw new InternalError(`The "${key}" property of the where filter needs to be an array.`);
        }
        return value;
    }
}