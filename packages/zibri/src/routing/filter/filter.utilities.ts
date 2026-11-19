import { FilterConfig, FilterMatch } from 'zibri-contract';

import { FuzzySearchUtilities } from '../../data-source/models/where/fuzzy-search.utilities';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Property, PropertyMetadata } from '../../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadataInput } from '../../entity/models/array-property-metadata.model';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { holdsPlainValue } from './holds-plain-value.function';

/**
 * A level of a filter config as it is at runtime: a match or the config of the properties inside, by property.
 */
type FilterConfigLevel = Record<string, unknown>;

/**
 * A condition on a single property, or the `where` of the properties inside of it.
 */
type FilterCondition = unknown;

/**
 * The conditions of a filter by property, nested like the where of a repository.
 */
type FilterConditions = Record<string, FilterCondition>;

/**
 * The matches of the properties of each type that holds a single value.
 */
const MATCHES: Readonly<Record<string, readonly FilterMatch[]>> = {
    string: ['equals', 'iLike', 'fuzzy', 'oneOf'],
    number: ['equals', 'oneOf', 'range'],
    date: ['equals', 'oneOf', 'range'],
    boolean: ['equals'],
    array: ['includes', 'oneOf']
};

/**
 * The types an array can be filtered by the values of.
 */
const VALUE_TYPES: readonly string[] = ['string', 'number', 'date', 'boolean'];

/**
 * Utilities for the filter of a list, a FilterConfig that says for each property of the entity how its value matches.
 */
export abstract class FilterUtilities {
    /**
     * Resolves the class the filter of a request is validated with: every property of the config may be left out, a
     * filter that matches by equality takes the type, format and enum of its property, a text filter a string, a
     * range the `from` and the `to` of the type of its property, and a filter of several values an array of them.
     * @param config - How each property of the entity is filtered.
     * @param entityClass - The entity.
     * @returns The class.
     * @throws {InternalError} When the config can't filter the entity: it names a property the entity lacks, a
     * relation, an excluded, encrypted or hashed property or a password, or matches a property by something its type
     * can't.
     */
    static resolveFilterClass<T extends object>(config: FilterConfig<T>, entityClass: Newable<T>): Newable<object> {
        return FilterUtilities.resolveLevelClass(config, entityClass, entityClass.name);
    }

    /**
     * Resolves the where of a repository from the filter of a request: every filter that has a value is a condition,
     * and a row needs to meet all of them. A text filter matches a value that contains it, ignoring the case, with
     * `%` and `_` taken as they are. A filter without a value, an empty string or an empty list filters nothing.
     * @param config - How each property of the entity is filtered.
     * @param entityClass - The entity.
     * @param filter - The filter, validated by the class of resolveFilterClass.
     * @returns The where, or undefined when no filter has a value.
     */
    static resolveWhere<T extends object>(config: FilterConfig<T>, entityClass: Newable<T>, filter: object): Where<T> | undefined {
        const conditions: FilterConditions | undefined = FilterUtilities.resolveLevelWhere(config, entityClass, filter);
        // built from the names of the config, which resolveFilterClass checked against the entity
        return conditions as Where<T> | undefined;
    }

    private static resolveLevelClass(config: FilterConfigLevel, cls: Newable<object>, path: string): Newable<object> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        class Filter {}
        Object.defineProperty(Filter, 'name', { value: `${cls.name}Filter` });
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        for (const [key, entry] of Object.entries(config)) {
            const name: string = `The filter "${path}.${key}"`;
            const metadata: PropertyMetadata | undefined = properties[key];
            if (metadata == undefined) {
                throw new InternalError(`${name} names a property ${cls.name} doesn't have.`);
            }
            if (typeof entry === 'string') {
                FilterUtilities.validateMatch(name, entry, metadata);
                FilterUtilities.resolveValueDecorator(entry, metadata)(Filter.prototype, key);
                continue;
            }
            const nestedClass: Newable<object> | undefined = FilterUtilities.findNestedClass(metadata);
            if (typeof entry !== 'object' || entry == undefined || nestedClass == undefined) {
                throw new InternalError(
                    `${name} is neither a match nor the filter of the properties of an object, a relation or the items of an array.`
                );
            }
            const nested: Newable<object> = FilterUtilities.resolveLevelClass({ ...entry }, nestedClass, `${path}.${key}`);
            Property.object({ cls: () => nested, required: false })(Filter.prototype, key);
        }
        return Filter;
    }

    private static resolveLevelWhere(config: FilterConfigLevel, cls: Newable<object>, filter: object): FilterConditions | undefined {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        const values: Record<string, unknown> = { ...filter };
        const conditions: FilterConditions = {};
        for (const [key, entry] of Object.entries(config)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            const value: unknown = values[key];
            if (metadata == undefined || FilterUtilities.isEmpty(value)) {
                continue;
            }
            if (typeof entry === 'string') {
                const condition: FilterCondition | undefined = FilterUtilities.resolveCondition(entry, metadata, value);
                if (condition !== undefined) {
                    conditions[key] = condition;
                }
                continue;
            }
            const nestedClass: Newable<object> | undefined = FilterUtilities.findNestedClass(metadata);
            if (typeof entry !== 'object' || entry == undefined || nestedClass == undefined) {
                continue;
            }
            if (typeof value !== 'object' || value == undefined) {
                continue;
            }
            // an object, a relation and the items of an array are all filtered through a where of their own
            const nested: FilterConditions | undefined = FilterUtilities.resolveLevelWhere({ ...entry }, nestedClass, value);
            if (nested != undefined) {
                conditions[key] = { where: nested };
            }
        }
        return Object.keys(conditions).length ? conditions : undefined;
    }

    private static resolveCondition(match: string, metadata: PropertyMetadata, value: unknown): FilterCondition | undefined {
        switch (match) {
            case 'equals': {
                return value;
            }
            // the filter class declares a text filter a string, so its validation answered anything else with a 400
            case 'iLike': {
                return typeof value === 'string' ? { iLike: `%${FilterUtilities.escapeLike(value)}%` } : undefined;
            }
            case 'fuzzy': {
                return typeof value === 'string' ? { fuzzyLike: { value } } : undefined;
            }
            case 'oneOf': {
                // of an array: one that holds at least one of the values
                return metadata.type === 'array' ? { where: { oneOf: value } } : { oneOf: value };
            }
            case 'includes': {
                return { includes: value };
            }
            case 'range': {
                return FilterUtilities.resolveRange(metadata, value);
            }
            default: {
                return undefined;
            }
        }
    }

    private static resolveRange(metadata: PropertyMetadata, value: unknown): FilterCondition | undefined {
        if (typeof value !== 'object' || value == undefined) {
            return undefined;
        }
        const bounds: Record<string, unknown> = Object.fromEntries(Object.entries(value));
        const range: FilterConditions = metadata.type === 'date'
            ? { afterOrOn: bounds['from'], beforeOrOn: bounds['to'] }
            : { greaterThanEquals: bounds['from'], lesserThanEquals: bounds['to'] };
        const res: FilterConditions = {};
        for (const [key, bound] of Object.entries(range)) {
            if (bound !== undefined) {
                res[key] = bound;
            }
        }
        return Object.keys(res).length ? res : undefined;
    }

    private static isEmpty(value: unknown): boolean {
        return value === undefined || value === '' || (Array.isArray(value) && !value.length);
    }

    // like patterns take % and _ as wildcards and a backslash to take them as they are, in every data source.
    private static escapeLike(value: string): string {
        return value.replaceAll(/[\\%_]/g, character => `\\${character}`);
    }

    // the class whose properties a nested filter names: of an object, of the items of an array of objects, or the
    // related entity.
    private static findNestedClass(metadata: PropertyMetadata): Newable<object> | undefined {
        if (isRelationMetadata(metadata)) {
            return metadata.target();
        }
        if (metadata.exclude !== false) {
            return undefined;
        }
        if (metadata.type === 'object') {
            return metadata.cls() as Newable<object>;
        }
        return metadata.type === 'array' && metadata.items.type === 'object' ? metadata.items.cls() as Newable<object> : undefined;
    }

    private static validateMatch(name: string, match: string, metadata: PropertyMetadata): void {
        if (!holdsPlainValue(metadata)) {
            throw new InternalError(`${name} filters a relation, an excluded, encrypted or hashed property or a password.`);
        }
        // an array of objects is filtered by the properties of its items, not by a match of its own
        const valueType: string = metadata.type === 'array' && !VALUE_TYPES.includes(metadata.items.type)
            ? 'array of objects'
            : metadata.type;
        const matches: readonly FilterMatch[] = MATCHES[valueType] ?? [];
        if (!matches.some(allowed => allowed === match)) {
            const allowed: string = matches.join(', ') || 'nothing';
            throw new InternalError(`${name} matches a ${valueType} by "${match}", which it can only be by ${allowed}.`);
        }
        if (match === 'fuzzy' && !FuzzySearchUtilities.isSearchable(metadata)) {
            throw new InternalError(`${name} matches by similarity a string that holds nothing to be similar to, like a uuid or an enum.`);
        }
    }

    private static resolveValueDecorator(match: string, metadata: PropertyMetadata): PropertyDecorator {
        switch (match) {
            case 'iLike':
            case 'fuzzy': {
                return Property.string({ required: false });
            }
            case 'oneOf':
            case 'includes': {
                const items: ArrayPropertyItemMetadataInput | undefined = metadata.type === 'array'
                    ? FilterUtilities.resolveItemInput(metadata.items)
                    : FilterUtilities.resolveItemInput(metadata);
                return Property.array({ items: items ?? { type: 'unknown' }, required: false });
            }
            case 'range': {
                const range: Newable<object> = FilterUtilities.resolveRangeClass(metadata);
                return Property.object({ cls: () => range, required: false });
            }
            default: {
                return FilterUtilities.resolveScalarDecorator(metadata);
            }
        }
    }

    // a range takes bounds of the type of its property.
    private static resolveRangeClass(metadata: PropertyMetadata): Newable<object> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        class Range {}
        FilterUtilities.resolveScalarDecorator(metadata)(Range.prototype, 'from');
        FilterUtilities.resolveScalarDecorator(metadata)(Range.prototype, 'to');
        return Range;
    }

    // what a value of the property is validated with: its type, and its format and enum, but none of the rules that
    // only a whole value meets, like a length.
    // validateMatch lets only strings, numbers, dates and booleans through.
    private static resolveScalarDecorator(metadata: PropertyMetadata): PropertyDecorator {
        if (metadata.type === 'string') {
            return Property.string({ format: metadata.format, enum: metadata.enum, required: false });
        }
        if (metadata.type === 'number') {
            return Property.number({ format: metadata.format, required: false });
        }
        return metadata.type === 'date' ? Property.date({ required: false }) : Property.boolean({ required: false });
    }

    private static resolveItemInput(metadata: PropertyMetadata): ArrayPropertyItemMetadataInput | undefined {
        if (metadata.type === 'string') {
            return { type: 'string', format: metadata.format, enum: metadata.enum };
        }
        if (metadata.type === 'number') {
            return { type: 'number', format: metadata.format };
        }
        return metadata.type === 'date' || metadata.type === 'boolean' ? { type: metadata.type } : undefined;
    }
}