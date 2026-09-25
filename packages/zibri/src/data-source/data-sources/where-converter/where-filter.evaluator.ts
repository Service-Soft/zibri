import { BaseEntity } from '../../../entity/base-entity.model';
import { PropertyMetadata } from '../../../entity/decorators/property.decorator';
import { OneOfPropertyMetadata, OneOfShapeMetadata } from '../../../entity/models/one-of-property-metadata.model';
import { Relation } from '../../../entity/models/relation.enum';
import { InternalError } from '../../../error-handling/internal-error.model';
import { isNamedValue } from '../../../parsing/functions/parse-one-of.function';
import { Newable } from '../../../types/newable.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { BigNumber } from '../../../utilities/number.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { parseFuzzyLikeFilter } from '../../models/where/fuzzy-like.model';
import { OneOfWhereFilterUtilities } from '../../models/where/one-of-where-filter.utilities';
import { isAllOfWhereFilterKey, isWhereFilterKey, WhereFilterKeys } from '../../models/where/where-filter-keys.model';
import { Where, WhereFilter, WhereFilterProperty } from '../../models/where/where-filter.model';
import { WhereValueUtilities } from '../../models/where/where-value.utilities';

/**
 * Handler for a single where filter key.
 */
type EvaluationHandler = (value: unknown, filterValue: unknown, metadata: PropertyMetadata | undefined) => boolean;

/**
 * Evaluates a Zibri where filter in process, against plain javascript objects.
 *
 * This is used by data sources that cannot push filtering down into the storage engine itself,
 * eg. The ValKeyDataSource. Relations and nested objects need to be resolved on the given item
 * before it is handed to the evaluator.
 *
 * ## Null handling
 * Comparisons follow SQL semantics, meaning that a null value never satisfies a comparison
 * (`not`, `greaterThan`, `like`, ...). The only exceptions are `oneOf` and `notOneOf`: because
 * their type explicitly allows null entries, an explicit null in the array does match a null value,
 * which differs from the `IN (NULL)` behavior of SQL.
 */
export class WhereFilterEvaluator {

    private readonly handlers: Record<WhereFilterKeys, EvaluationHandler> = {
        not: (value, filterValue, metadata) => filterValue === null
            ? value != undefined
            : value != undefined && !WhereValueUtilities.equals(value, filterValue, metadata),
        oneOf: (value, filterValue, metadata) => this.toArray(filterValue, 'oneOf')
            .some(v => v === null ? value == undefined : WhereValueUtilities.equals(value, v, metadata)),
        notOneOf: (value, filterValue, metadata) => !this.toArray(filterValue, 'notOneOf')
            .some(v => v === null ? value == undefined : WhereValueUtilities.equals(value, v, metadata)),
        like: (value, filterValue) => typeof value === 'string' && this.likeToRegex(String(filterValue), false).test(value),
        iLike: (value, filterValue) => typeof value === 'string' && this.likeToRegex(String(filterValue), true).test(value),
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
        where: (value, filterValue, metadata) => this.matchesNestedWhere(value, filterValue, metadata),
        includes: (value, filterValue, metadata) => {
            const items: unknown[] = this.toItems(value);
            return this.toArray(filterValue, 'includes')
                .every(v => items.some(i => WhereValueUtilities.equals(i, v, WhereValueUtilities.itemMetadata(metadata))));
        },
        isIncludedIn: (value, filterValue, metadata) => {
            const allowed: unknown[] = this.toArray(filterValue, 'isIncludedIn');
            return this.toItems(value)
                .every(i => allowed.some(v => WhereValueUtilities.equals(i, v, WhereValueUtilities.itemMetadata(metadata))));
        },
        length: (value, filterValue) => this.toItems(value).length === Number(filterValue),
        lengthGreaterThan: (value, filterValue) => this.toItems(value).length > Number(filterValue),
        lengthGreaterThanEquals: (value, filterValue) => this.toItems(value).length >= Number(filterValue),
        lengthLesserThan: (value, filterValue) => this.toItems(value).length < Number(filterValue),
        lengthLesserThanEquals: (value, filterValue) => this.toItems(value).length <= Number(filterValue)
    };

    /**
     * Checks whether or not the given item matches the given where filter.
     * @param item - The item to check.
     * @param filter - The where filter that the item needs to match.
     * @param entityClass - The class of the item, used to resolve the property metadata.
     * @returns True when the item matches the filter, false otherwise.
     */
    matches<T extends object>(item: T, filter: Where<T>, entityClass: Newable<T>): boolean {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        if (Array.isArray(filter)) {
            return filter.some(f => this.matchesSingleFilter(item, f, properties));
        }
        return this.matchesSingleFilter(item, filter, properties);
    }

    private matchesSingleFilter<T extends object>(
        item: T,
        filter: WhereFilter<T>,
        properties: Record<string, PropertyMetadata>
    ): boolean {
        for (const key of ObjectUtilities.keys(filter)) {
            const filterProperty: WhereFilterProperty<T[typeof key]> | WhereFilterProperty<T[typeof key]>[] | undefined = filter[key];
            if (filterProperty === undefined) {
                continue;
            }
            if (!this.matchesProperty(
                (item as Record<string, unknown>)[key as string],
                filterProperty,
                properties[key as string]
            )) {
                return false;
            }
        }
        return true;
    }

    private matchesProperty(value: unknown, filterProperty: unknown, metadata: PropertyMetadata | undefined): boolean {
        // an array of filters means "or", unless the property itself holds an array, in which case it is the value to compare against
        if (Array.isArray(filterProperty) && metadata?.type !== 'array') {
            return filterProperty.some(f => this.matchesSingleProperty(value, f, metadata));
        }
        return this.matchesSingleProperty(value, filterProperty, metadata);
    }

    private matchesSingleProperty(value: unknown, filterProperty: unknown, metadata: PropertyMetadata | undefined): boolean {
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
            return WhereValueUtilities.equals(value, filterProperty, metadata);
        }
        if (typeof filterProperty !== 'object') {
            // eslint-disable-next-line typescript/no-base-to-string
            throw new InternalError(`Unexpected where filter value "${String(filterProperty)}"`);
        }
        if (metadata?.type === 'oneOf') {
            return this.matchesOneOf(value, filterProperty as Record<string, unknown>, metadata);
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
            if (!this.everyOf(key, filterValue).every(v => this.handlers[key](value, v, metadata))) {
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
     * @returns Whether the value matches the filter of its shape.
     * @throws When the filter leaves a shape out, or names one the property does not have.
     */
    private matchesOneOf(value: unknown, filter: Record<string, unknown>, metadata: OneOfPropertyMetadata): boolean {
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
        return this.matchesProperty(value.value, shapeFilter, { ...shape } as PropertyMetadata);
    }

    private matchesNestedWhere(value: unknown, filterValue: unknown, metadata: PropertyMetadata | undefined): boolean {
        if (metadata == undefined) {
            throw new InternalError('The "where" operator is not supported on this property without metadata.');
        }
        if (metadata.type === 'object') {
            return value != undefined && this.matches(value as object, filterValue as Where<object>, metadata.cls() as Newable<object>);
        }
        if (metadata.type === 'array') {
            if (metadata.items.type !== 'object') {
                const itemMetadata: PropertyMetadata = { ...metadata.items } as PropertyMetadata;
                return this.toItems(value).some(i => this.matchesProperty(i, filterValue, itemMetadata));
            }
            const itemClass: Newable<object> = metadata.items.cls() as Newable<object>;
            return this.toItems(value).some(i => this.matches(i as object, filterValue as Where<object>, itemClass));
        }
        if (this.isRelation(metadata)) {
            const targetClass: Newable<BaseEntity> = metadata.target();
            if (metadata.type === Relation.ONE_TO_MANY || metadata.type === Relation.MANY_TO_MANY) {
                return this.toItems(value).some(i => this.matches(i as BaseEntity, filterValue as Where<BaseEntity>, targetClass));
            }
            return value != undefined && this.matches(value as BaseEntity, filterValue as Where<BaseEntity>, targetClass);
        }
        throw new InternalError('The "where" operator was used on a property that is not an object, array or relation.');
    }

    private matchesFuzzyLike(value: unknown, filterValue: unknown): boolean {
        const { value: search, minSimilarityRatio } = parseFuzzyLikeFilter(filterValue);
        if (typeof value !== 'string') {
            return false;
        }
        return this.similarity(value, search) >= minSimilarityRatio;
    }

    /**
     * Calculates the trigram similarity of two strings the same way that the postgres pg_trgm extension does.
     * @param a - The first string.
     * @param b - The second string.
     * @returns The similarity as a value between 0 and 1.
     */
    private similarity(a: string, b: string): number {
        const aTrigrams: Set<string> = this.trigrams(a);
        const bTrigrams: Set<string> = this.trigrams(b);
        if (!aTrigrams.size && !bTrigrams.size) {
            return 0;
        }
        let shared: number = 0;
        for (const trigram of aTrigrams) {
            if (bTrigrams.has(trigram)) {
                shared++;
            }
        }
        return shared / (aTrigrams.size + bTrigrams.size - shared);
    }

    private trigrams(value: string): Set<string> {
        const res: Set<string> = new Set();
        const words: string[] = value.toLowerCase().split(/[^\da-z]+/i)
            .filter(Boolean);
        for (const word of words) {
            const padded: string = `  ${word} `;
            for (let i: number = 0; i + 3 <= padded.length; i++) {
                res.add(padded.slice(i, i + 3));
            }
        }
        return res;
    }

    private likeToRegex(pattern: string, ignoreCase: boolean): RegExp {
        const escaped: string = pattern.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)
            .replaceAll('%', '.*')
            .replaceAll('_', '.');
        return new RegExp(`^${escaped}$`, ignoreCase ? 'is' : 's');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    private isRelation(metadata: PropertyMetadata): metadata is Extract<PropertyMetadata, { target: unknown }> {
        return metadata.type === Relation.HAS_ONE
            || metadata.type === Relation.BELONGS_TO_ONE
            || metadata.type === Relation.MANY_TO_ONE
            || metadata.type === Relation.ONE_TO_MANY
            || metadata.type === Relation.MANY_TO_MANY;
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

    private toArray(value: unknown, key: string): unknown[] {
        if (!Array.isArray(value)) {
            throw new InternalError(`The "${key}" property of the where filter needs to be an array.`);
        }
        return value;
    }
}