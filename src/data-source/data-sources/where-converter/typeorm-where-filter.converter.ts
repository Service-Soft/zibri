import { And, ArrayContainedBy, ArrayContains, Equal, FindOperator, ILike, In, IsNull, LessThan, LessThanOrEqual, Like, MoreThan, MoreThanOrEqual, Not, Or, Raw, FindOptionsWhere as ToFindOptionsWhere, FindOptionsWhereProperty as ToFindOptionsWhereProperty, DataSource as ToDataSource } from 'typeorm';

import { BaseEntity } from '../../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../../entity/decorators/property.decorator';
import { Relation } from '../../../entity/models/relation.enum';
import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { Newable } from '../../../types/newable.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { ArrayWhereFilter } from '../../models/where/array-where-filter.model';
import { isWhereFilterKey, WhereFilterKeys } from '../../models/where/where-filter-keys.model';
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
    entityClass: Newable<unknown>
) => FindOperator<unknown>;

/**
 * Abstract base converter that transforms a Zibri WhereFilter into a TypeORM FindOptionsWhere.
 */
export abstract class TypeOrmWhereFilterConverter {
    /**
     * A map that defines how Zibri's where filter properties are mapped to their typeorm counterpart.
     */
    protected handleFilterKeyMap: Record<WhereFilterKeys, WhereFilterHandler> = {
        not: (value) => Not(value),
        like: (value) => Like(value),
        oneOf: (value) => {
            if (!Array.isArray(value)) {
                throw new Error('The "oneOf" property of the where filter needs to be an array.');
            }
            return In(value);
        },
        notOneOf: (value) => {
            if (!Array.isArray(value)) {
                throw new Error('The "notOneOf" property of the where filter needs to be an array.');
            }
            return Not(In(value));
        },
        after: (value) => MoreThan(value),
        before: (value) => LessThan(value),
        greaterThan: (value) => MoreThan(value),
        greaterThanEquals: (value) => MoreThanOrEqual(value),
        lesserThan: (value) => LessThan(value),
        lesserThanEquals: (value) => LessThanOrEqual(value),
        iLike: (value) => ILike(value),
        is: (value, metadata) => {
            if (value === null) {
                return IsNull();
            }
            // Unwrap a full entity for MANY_TO_ONE / BELONGS_TO_ONE
            if (
                (metadata.type === Relation.MANY_TO_ONE
                    || metadata.type === Relation.BELONGS_TO_ONE)
                && value !== null
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
                throw new Error('The "includes" property of the where filter needs to be an array.');
            }
            return ArrayContains(value);
        },
        isIncludedIn: (value) => {
            if (!Array.isArray(value)) {
                throw new Error('The "isIncludedIn" property of the where filter needs to be an array.');
            }
            return ArrayContainedBy(value);
        },
        length: (value) => Raw(alias => `array_length(${alias}, 1) = ${value}`),
        lengthGreaterThan: (value) => Raw(alias => `array_length(${alias}, 1) > ${value}`),
        lengthGreaterThanEquals: (value) => Raw(alias => `array_length(${alias}, 1) >= ${value}`),
        lengthLesserThan: (value) => Raw(alias => `array_length(${alias}, 1) < ${value}`),
        lengthLesserThanEquals: (value) => Raw(alias => `array_length(${alias}, 1) <= ${value}`)
    };

    constructor(protected readonly typeOrmDataSource: ToDataSource) {}

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
            throw new Error('The "where" operator is not supported on this property without nested metadata.');
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

            const propertyMetadata: PropertyMetadata = properties[key];
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
                entityClass as Newable<T[Extract<keyof T, string>]>
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
        if ('includes' in filterObj && Array.isArray(filterObj.includes)) {
            extraRawConditions.push(
                this.buildRelationIncludesOperator(
                    entityClass, key, propertyMetadata, filterObj.includes as BaseEntity[]
                )
            );
            delete filterObj.includes;
        }
        if ('isIncludedIn' in filterObj && Array.isArray(filterObj.isIncludedIn)) {
            extraRawConditions.push(
                this.buildRelationIsIncludedInOperator(
                    entityClass, key, propertyMetadata, filterObj.isIncludedIn as BaseEntity[]
                )
            );
            delete filterObj.isIncludedIn;
        }

        // 3) Remaining element filters (e.g. where)
        if (Object.keys(filterObj).length > 0) {
            const targetEntity: Newable<BaseEntity> = propertyMetadata.target();
            const nestedProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetEntity);
            (res as Record<string, unknown>)[key] = this.propertyToFindOperator(
                filterObj as WhereFilterProperty<T> | WhereFilterProperty<T>[],
                propertyMetadata,
                nestedProps,
                entityClass
            );
        }
    }

    /**
     * Converts a where filter property to a typeorm FindOperator property.
     * @param property - The property to convert.
     * @param propertyMetadata - The property metadata of the property.
     * @param nestedProperties - Nested properties, if any.
     * @param entityClass - The entity class that the property is on.
     * @returns A typeorm FindOperator property.
     */
    protected propertyToFindOperator<T>(
        property: WhereFilterProperty<T> | WhereFilterProperty<T>[],
        propertyMetadata: PropertyMetadata,
        nestedProperties: Record<string, PropertyMetadata> | undefined,
        entityClass: Newable<T>
    ): FindOperator<T> {
        if (Array.isArray(property)) {
            return propertyMetadata.type === 'array'
                ? this.singlePropertyToFindOperator(property as WhereFilterProperty<T>, propertyMetadata, nestedProperties, entityClass)
                : Or(
                    ...property.map(
                        p => this.singlePropertyToFindOperator<T>(
                            p as WhereFilterProperty<T>,
                            propertyMetadata,
                            nestedProperties,
                            entityClass
                        )
                    )
                );
        }
        return this.singlePropertyToFindOperator(property, propertyMetadata, nestedProperties, entityClass);
    }

    /**
     * Transforms a single where filter property to a typeorm FindOperator.
     * @param property - The where filter property to transform.
     * @param propertyMetadata - The metadata of the where filter property.
     * @param nestedProperties - Any nested properties of the where filter.
     * @param entityClass - The entity class that the property is on.
     * @returns A typeorm FindOperator.
     * @throws When the where filter property is invalid.
     */
    protected singlePropertyToFindOperator<T>(
        property: WhereFilterProperty<T>,
        propertyMetadata: PropertyMetadata,
        nestedProperties: Record<string, PropertyMetadata> | undefined,
        entityClass: Newable<T>
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
            || (Array.isArray(property) && propertyMetadata.type === 'array')
        ) {
            return Equal(property as T);
        }

        const operators: FindOperator<T>[] = [];
        const filterKeys: unknown[] = ObjectUtilities.keys(property);
        if (!filterKeys.length) {
            throw new Error('Empty where filter');
        }

        for (const key of filterKeys) {
            if (!isWhereFilterKey(key)) {
                throw new Error(`Unknown key "${key}" on where filter ${property}`);
            }
            const handler: WhereFilterHandler = this.handleFilterKeyMap[key];
            const value: unknown = (property as Record<string, unknown>)[key];
            const op: FindOperator<unknown> = handler(value, propertyMetadata, nestedProperties, entityClass);
            if (op !== undefined) {
                operators.push(op as FindOperator<T>);
            }
        }

        return operators.length === 1
            ? operators[0]
            : And(...operators);
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

    protected abstract buildRelationIsIncludedInOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        entities: BaseEntity[]
    ): FindOperator<unknown>;
}