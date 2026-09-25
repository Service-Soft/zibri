import { And, ArrayContainedBy, ArrayContains, Equal, FindOperator, ILike, In, IsNull, LessThan, LessThanOrEqual, Like, MoreThan, MoreThanOrEqual, Not, Or, Raw, FindOptionsWhere as ToFindOptionsWhere, FindOptionsWhereProperty as ToFindOptionsWhereProperty, DataSource as ToDataSource } from 'typeorm';

import { TypeOrmParameters } from './typeorm-parameters';
import { BaseEntity } from '../../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../../entity/decorators/property.decorator';
import { OneOfPropertyMetadata } from '../../../entity/models/one-of-property-metadata.model';
import { Relation } from '../../../entity/models/relation.enum';
import { InternalError } from '../../../error-handling/internal-error.model';
import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { Newable } from '../../../types/newable.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { BigNumber } from '../../../utilities/number.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { ArrayWhereFilter } from '../../models/where/array-where-filter.model';
import { isAllOfWhereFilterKey, isWhereFilterKey, WhereFilterKeys } from '../../models/where/where-filter-keys.model';
import { Where, WhereFilter, WhereFilterProperty } from '../../models/where/where-filter.model';

// eslint-disable-next-line typescript/typedef
const lengthWhereFilterKeys = [
    'length',
    'lengthGreaterThan',
    'lengthGreaterThanEquals',
    'lengthLesserThan',
    'lengthLesserThanEquals'
] as const satisfies (keyof ExcludeStrict<ArrayWhereFilter<object>, null | object[]>)[];

/**
 * Handler function for a single where-filter key.
 */
export type WhereFilterHandler = (
    value: unknown,
    metadata: PropertyMetadata,
    nestedProperties: Record<string, PropertyMetadata> | undefined,
    entityClass: Newable<unknown>,
    property: string
) => FindOperator<unknown>;

/**
 * Abstract base converter that transforms a Zibri WhereFilter into a TypeORM FindOptionsWhere.
 */
export abstract class TypeOrmWhereFilterConverter {

    /**
     * Handler for a fuzzyLike filter.
     */
    protected abstract fuzzyLikeWhereFilterHandler: WhereFilterHandler;

    /**
     * A map that defines how Zibri's where filter properties are mapped to their typeorm counterpart.
     */
    protected handleFilterKeyMap: Record<WhereFilterKeys, WhereFilterHandler> = {
        // null needs IsNull, the same way the `is` handler below does it. Not(null) becomes
        // `column != NULL`, which is never true in sql, so `{ not: null }` silently matched nothing
        // at all rather than every row that has a value.
        not: (value) => value === null ? Not(IsNull()) : Not(value),
        like: (value) => Like(value),
        oneOf: (value) => {
            if (!Array.isArray(value)) {
                throw new InternalError('The "oneOf" property of the where filter needs to be an array.');
            }
            return In(value);
        },
        notOneOf: (value) => {
            if (!Array.isArray(value)) {
                throw new InternalError('The "notOneOf" property of the where filter needs to be an array.');
            }
            return Not(In(value));
        },
        after: (value) => MoreThan(value),
        before: (value) => LessThan(value),
        afterOrOn: (value) => MoreThanOrEqual(value),
        beforeOrOn: (value) => LessThanOrEqual(value),
        greaterThan: (value) => MoreThan(value),
        greaterThanEquals: (value) => MoreThanOrEqual(value),
        lesserThan: (value) => LessThan(value),
        lesserThanEquals: (value) => LessThanOrEqual(value),
        iLike: (value) => ILike(value),
        fuzzyLike: (value, metadata, nestedProperties, entityClass, property) => this.fuzzyLikeWhereFilterHandler(
            value,
            metadata,
            nestedProperties,
            entityClass,
            property
        ),
        is: (value, metadata) => {
            if (value === null) {
                return IsNull();
            }
            // Unwrap a full entity for MANY_TO_ONE / BELONGS_TO_ONE
            if (
                (metadata.type === Relation.MANY_TO_ONE
                    || metadata.type === Relation.BELONGS_TO_ONE)
                && typeof value === 'object'
                && !Array.isArray(value)
                && 'id' in value
            ) {
                return Equal(value.id);
            }
            return Equal(value);
        },
        where: (value, metadata, nestedProperties, entityClass) => this.whereHandler(value, metadata, nestedProperties, entityClass),
        includes: (value) => {
            if (!Array.isArray(value)) {
                throw new InternalError('The "includes" property of the where filter needs to be an array.');
            }
            return ArrayContains(value);
        },
        isIncludedIn: (value) => {
            if (!Array.isArray(value)) {
                throw new InternalError('The "isIncludedIn" property of the where filter needs to be an array.');
            }
            return ArrayContainedBy(value);
        },
        length: (value) => this.arrayLengthOperator('=', value),
        lengthGreaterThan: (value) => this.arrayLengthOperator('>', value),
        lengthGreaterThanEquals: (value) => this.arrayLengthOperator('>=', value),
        lengthLesserThan: (value) => this.arrayLengthOperator('<', value),
        lengthLesserThanEquals: (value) => this.arrayLengthOperator('<=', value)
    };

    /**
     * Numbers the bound values of every statement this converter builds.
     *
     * Never reset: typeorm merges the parameters of all raw operators into one set per query, so two
     * conditions reusing a name would mean the second one silently deciding what the first compares
     * against.
     */
    private parameterIndex: number = 0;

    constructor(protected readonly typeOrmDataSource: ToDataSource) {}

    /**
     * Starts collecting the values of one raw statement.
     * @returns A collector whose values are handed to the raw operator that is being built.
     */
    protected createParameters(): TypeOrmParameters {
        return new TypeOrmParameters(() => `zi_p${this.parameterIndex++}`);
    }

    private arrayLengthOperator(operator: string, value: unknown): FindOperator<unknown> {
        // the filter value is typed as a number but nothing checks that at runtime, so it is bound
        // rather than written into the statement. A caller that sends something else now gets the
        // database refusing it instead of a statement that says something else than it reads like.
        const parameters: TypeOrmParameters = this.createParameters();
        const length: string = parameters.add(value);
        return Raw(alias => `array_length(${alias}, 1) ${operator} ${length}`, parameters.values);
    }

    // ── Public entry point (concrete) ──────────────────────────
    /**
     * Converts the given zibri filter to a typeorm filter.
     * @param filter - The zibri filter to convert.
     * @param entityClass - The entity class to search for by this filter.
     * @returns The typeorm filter.
     */
    convert<T extends object>(
        filter: Where<T>,
        entityClass: Newable<T>
    ): ToFindOptionsWhere<T> | ToFindOptionsWhere<T>[] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        if (Array.isArray(filter)) {
            return filter.map(f => this.singleWhereFilterToFindOptionsWhere(f, properties, entityClass));
        }
        return this.singleWhereFilterToFindOptionsWhere(filter, properties, entityClass);
    }

    /**
     * Handles converting a where filter to a typeorm FindOperator.
     * @param value - The value of the where filter.
     * @param metadata - The metadata of the property for which the where filter has been specified.
     * @param nestedProperties - Nested properties on the where filter. Need to exist.
     * @param entityClass - The entity class that the where filter belongs to.
     * @returns A typeorm FindOperator.
     * @throws Wheen now nested properties have been found.
     */
    protected whereHandler(
        value: unknown,
        metadata: PropertyMetadata,
        nestedProperties: Record<string, PropertyMetadata> | undefined,
        entityClass: Newable<unknown>
    ): FindOperator<unknown> {
        if (nestedProperties == undefined) {
            throw new InternalError('The "where" operator is not supported on this property without nested metadata.');
        }
        let targetClass: Newable<unknown> = entityClass;
        if (metadata.type === 'object') {
            targetClass = metadata.cls();
        }
        else if (
            metadata.type === Relation.HAS_ONE || metadata.type === Relation.BELONGS_TO_ONE
            || metadata.type === Relation.MANY_TO_ONE || metadata.type === Relation.ONE_TO_MANY
            || metadata.type === Relation.MANY_TO_MANY
        ) {
            targetClass = metadata.target();
        }
        return this.singleWhereFilterToFindOptionsWhere(
            value as WhereFilter<Record<string, unknown>>,
            nestedProperties,
            targetClass as Newable<Record<string, unknown>>
        ) as unknown as FindOperator<unknown>;
    }

    // ── Pipeline stages (concrete, overridable) ─────────────────

    /**
     * Converts a single where filter to a typeorm FindOptionsWhere property.
     * @param filter - The filter to convert.
     * @param properties - The property metadata of the model that the filter is for.
     * @param entityClass - The entity class to search for by this filter.
     * @returns A typeorm FindOptionsWhere property.
     * @throws When the filter includes a property that has no metadata.
     */
    protected singleWhereFilterToFindOptionsWhere<T extends Object>(
        filter: WhereFilter<T>,
        properties: Record<string, PropertyMetadata>,
        entityClass: Newable<T>
    ): ToFindOptionsWhere<T> {
        const res: ToFindOptionsWhere<T> = {};
        const extraRawConditions: FindOperator<unknown>[] = [];

        for (const key of ObjectUtilities.keys(filter)) {
            const prop: WhereFilterProperty<T[typeof key]> | WhereFilterProperty<T[typeof key]>[] | undefined = filter[key];
            if (prop === undefined) {
                continue;
            }

            const propertyMetadata: PropertyMetadata | undefined = properties[key];
            if (propertyMetadata == undefined) {
                // the filter type only allows declared keys, so this is a filter that was built
                // from data rather than written down. Naming the key beats the TypeError that
                // reading its type used to raise a line later
                throw new InternalError(
                    `Cannot filter "${entityClass.name}" by "${String(key)}", which it does not declare as a property.`
                );
            }
            let nestedProperties: Record<string, PropertyMetadata> | undefined;

            if (propertyMetadata.type === Relation.ONE_TO_MANY || propertyMetadata.type === Relation.MANY_TO_MANY) {
                this.processRelationFilter(key, prop, propertyMetadata, entityClass, res, extraRawConditions);
                continue;
            }

            if (propertyMetadata.type === 'object') {
                nestedProperties = MetadataUtilities.getModelProperties(propertyMetadata.cls());
            }
            else if (
                propertyMetadata.type === Relation.HAS_ONE
                || propertyMetadata.type === Relation.BELONGS_TO_ONE
                || propertyMetadata.type === Relation.MANY_TO_ONE
            ) {
                nestedProperties = MetadataUtilities.getModelProperties(propertyMetadata.target());
            }

            res[key] = this.propertyToFindOperator(
                prop,
                propertyMetadata,
                nestedProperties,
                entityClass as Newable<T[Extract<keyof T, string>]>,
                String(key)
            ) as typeof key extends 'toString' ? unknown : ToFindOptionsWhereProperty<NonNullable<T[typeof key]>>;
        }

        if (extraRawConditions.length) {
            const existingIdFilter: FindOperator<unknown> | undefined = res['id' as keyof T] as FindOperator<unknown> | undefined;
            const combined: FindOperator<unknown> = existingIdFilter
                ? And(existingIdFilter, ...extraRawConditions)
                : And(...extraRawConditions);
            (res as Record<string, FindOperator<unknown>>)['id'] = combined;
        }

        return res;
    }

    private processRelationFilter<T extends Object>(
        key: string,
        prop: WhereFilterProperty<T[Extract<keyof T, string>]> | WhereFilterProperty<T[Extract<keyof T, string>]>[],
        propertyMetadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<T>,
        res: ToFindOptionsWhere<T>,
        extraRawConditions: FindOperator<unknown>[]
    ): void {
        const filterObj: Record<string, unknown> = prop as Record<string, unknown>;

        for (const lengthKey of lengthWhereFilterKeys) {
            if (lengthKey in filterObj && typeof filterObj[lengthKey] === 'number') {
                extraRawConditions.push(
                    this.buildRelationLengthRawOperator(
                        entityClass, key, propertyMetadata, lengthKey, filterObj[lengthKey]
                    )
                );
                // eslint-disable-next-line typescript/no-dynamic-delete
                delete filterObj[lengthKey];
            }
        }

        // 2) includes / isIncludedIn
        if ('includes' in filterObj && Array.isArray(filterObj['includes'])) {
            extraRawConditions.push(
                this.buildRelationIncludesOperator(
                    entityClass, key, propertyMetadata, filterObj['includes'] as BaseEntity[]
                )
            );
            delete filterObj['includes'];
        }
        if ('isIncludedIn' in filterObj && Array.isArray(filterObj['isIncludedIn'])) {
            extraRawConditions.push(
                this.buildRelationIsIncludedInOperator(
                    entityClass, key, propertyMetadata, filterObj['isIncludedIn'] as BaseEntity[]
                )
            );
            delete filterObj['isIncludedIn'];
        }

        // 3) Remaining element filters (e.g. where)
        if (ObjectUtilities.keys(filterObj).length) {
            const targetEntity: Newable<BaseEntity> = propertyMetadata.target();
            const nestedProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetEntity);
            (res as Record<string, unknown>)[key] = this.propertyToFindOperator(
                filterObj as WhereFilterProperty<T> | WhereFilterProperty<T>[],
                propertyMetadata,
                nestedProps,
                entityClass,
                key
            );
        }
    }

    /**
     * Converts a where filter property to a typeorm FindOperator property.
     * @param property - The property to convert.
     * @param propertyMetadata - The property metadata of the property.
     * @param nestedProperties - Nested properties, if any.
     * @param entityClass - The entity class that the property is on.
     * @param propertyName - The name the entity declares the property under.
     * @returns A typeorm FindOperator property.
     */
    protected propertyToFindOperator<T>(
        property: WhereFilterProperty<T> | WhereFilterProperty<T>[],
        propertyMetadata: PropertyMetadata,
        nestedProperties: Record<string, PropertyMetadata> | undefined,
        entityClass: Newable<T>,
        propertyName: string
    ): FindOperator<T> {
        if (Array.isArray(property)) {
            return propertyMetadata.type === 'array'
                ? this.singlePropertyToFindOperator(
                    property as WhereFilterProperty<T>,
                    propertyMetadata,
                    nestedProperties,
                    entityClass,
                    propertyName
                )
                : Or(
                    ...property.map(
                        p => this.singlePropertyToFindOperator<T>(
                            p as WhereFilterProperty<T>,
                            propertyMetadata,
                            nestedProperties,
                            entityClass,
                            propertyName
                        )
                    )
                );
        }
        return this.singlePropertyToFindOperator(property, propertyMetadata, nestedProperties, entityClass, propertyName);
    }

    /**
     * Transforms a single where filter property to a typeorm FindOperator.
     * @param property - The where filter property to transform.
     * @param propertyMetadata - The metadata of the where filter property.
     * @param nestedProperties - Any nested properties of the where filter.
     * @param entityClass - The entity class that the property is on.
     * @param propertyName - The name the entity declares the property under.
     * @returns A typeorm FindOperator.
     * @throws When the where filter property is invalid.
     */
    protected singlePropertyToFindOperator<T>(
        property: WhereFilterProperty<T>,
        propertyMetadata: PropertyMetadata,
        nestedProperties: Record<string, PropertyMetadata> | undefined,
        entityClass: Newable<T>,
        propertyName: string
    ): FindOperator<T> {
        if (property === null) {
            // eslint-disable-next-line typescript/no-unsafe-return
            return IsNull();
        }
        if (
            typeof property === 'string'
            || typeof property === 'bigint'
            || typeof property === 'number'
            || typeof property === 'boolean'
            || property instanceof Date
            || property instanceof BigNumber
            || (Array.isArray(property) && propertyMetadata.type === 'array')
        ) {
            return Equal(property as T);
        }
        if (propertyMetadata.type === 'oneOf') {
            return this.buildOneOfOperator(property as Record<string, unknown>, propertyMetadata) as FindOperator<T>;
        }

        const operators: FindOperator<T>[] = [];
        const filterKeys: unknown[] = ObjectUtilities.keys(property);
        if (!filterKeys.length) {
            throw new InternalError('Empty where filter');
        }

        for (const key of filterKeys) {
            if (!isWhereFilterKey(key)) {
                throw new InternalError(`Unknown key "${key}" on where filter ${property}`);
            }
            const handler: WhereFilterHandler = this.handleFilterKeyMap[key];
            const value: unknown = (property as Record<string, unknown>)[key];
            // a key taking several values becomes one condition per value, which the AND below
            // already joins - the same list every other key here contributes a single condition to
            for (const one of this.everyOf(key, value)) {
                const op: FindOperator<unknown> = handler(one, propertyMetadata, nestedProperties, entityClass, propertyName);
                if (op !== undefined) {
                    operators.push(op as FindOperator<T>);
                }
            }
        }

        const single: FindOperator<T> | undefined = operators.length === 1 ? operators[0] : undefined;
        return single ?? And(...operators);
    }

    /**
     * The values a key asks of the property.
     * @param key - The key of the filter.
     * @param value - What the key holds.
     * @returns Every value the property has to satisfy, which is one for every key but the few that
     * take several.
     * @throws When a key that takes several values is given none.
     */
    protected everyOf(key: WhereFilterKeys, value: unknown): unknown[] {
        if (!isAllOfWhereFilterKey(key) || !Array.isArray(value)) {
            return [value];
        }
        if (!value.length) {
            throw new InternalError(`The "${key}" property of the where filter needs at least one value.`);
        }
        return value;
    }

    // ── Abstract – DB‑specific building blocks ───────────────────

    protected abstract buildRelationLengthRawOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        lengthKey: string,
        value: number
    ): FindOperator<unknown>;

    protected abstract buildRelationIncludesOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        entities: BaseEntity[]
    ): FindOperator<unknown>;

    /**
     * Builds the operator for the filter of a value of several named shapes.
     * @param filter - The filter, naming every shape as `when` followed by its name.
     * @param metadata - The property.
     * @returns A typeorm FindOperator.
     */
    protected abstract buildOneOfOperator(filter: Record<string, unknown>, metadata: OneOfPropertyMetadata): FindOperator<unknown>;

    protected abstract buildRelationIsIncludedInOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        entities: BaseEntity[]
    ): FindOperator<unknown>;
}