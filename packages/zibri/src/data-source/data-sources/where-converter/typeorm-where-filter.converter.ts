import { And, Equal, FindOperator, ILike, IsNull, LessThan, LessThanOrEqual, Like, MoreThan, MoreThanOrEqual, Not, Or, Raw, SelectQueryBuilder, FindOptionsWhere as ToFindOptionsWhere, FindOptionsWhereProperty as ToFindOptionsWhereProperty, DataSource as ToDataSource } from 'typeorm';

import { ParameterizedSql } from './parameterized-sql.model';
import { TypeOrmParameters } from './typeorm-parameters';
import { BaseEntity } from '../../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../../entity/decorators/property.decorator';
import { denyAll, DenyAll } from '../../../entity/models/entity-scope.model';
import { isRelationMetadata } from '../../../entity/models/is-relation-metadata.function';
import { OneOfPropertyMetadata } from '../../../entity/models/one-of-property-metadata.model';
import { Relation } from '../../../entity/models/relation.enum';
import { InternalError } from '../../../error-handling/internal-error.model';
import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { Newable } from '../../../types/newable.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { BigNumber } from '../../../utilities/number.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { RelatedNarrowing } from '../../models/related-narrowing.model';
import { ArrayWhereFilter } from '../../models/where/array-where-filter.model';
import { isAllOfWhereFilterKey, isWhereFilterKey, WhereFilterKeys } from '../../models/where/where-filter-keys.model';
import { Where, WhereFilter, WhereFilterProperty } from '../../models/where/where-filter.model';
import { WhereValueUtilities } from '../../models/where/where-value.utilities';
import { RelatedNarrowingUtilities } from '../../scopes/related-narrowing.utilities';
import { ScopedWhere, ScopeWhereUtilities } from '../../scopes/scope-where.utilities';

// eslint-disable-next-line typescript/typedef
const lengthWhereFilterKeys = [
    'length',
    'lengthGreaterThan',
    'lengthGreaterThanEquals',
    'lengthLesserThan',
    'lengthLesserThanEquals'
] as const satisfies (keyof ExcludeStrict<ArrayWhereFilter<object>, null | object[]>)[];

/**
 * What separates a statement's condition from the rest of it.
 */
const WHERE: string = ' WHERE ';

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
        // and a row holding no value is not the value named, which `column != value` alone answers
        // with null rather than yes
        not: (value, metadata) => {
            if (value === null) {
                return Not(IsNull());
            }
            const differs: FindOperator<unknown> = Array.isArray(value) && metadata.type === 'array'
                ? Not(this.buildArrayEqualsOperator(value, metadata))
                // a related row is named by its id, which is what the column holds
                : Not(WhereValueUtilities.unwrapRelation(value, metadata));
            return Or(IsNull(), differs);
        },
        like: (value) => Like(value),
        oneOf: (value, metadata, nestedProperties, entityClass, property) => {
            if (!Array.isArray(value)) {
                throw new InternalError('The "oneOf" property of the where filter needs to be an array.');
            }
            const listed: unknown[] = value.filter(v => v !== null)
                .map(v => WhereValueUtilities.unwrapRelation(v, metadata));
            const equalsListed: FindOperator<unknown> = this.equalsOneOf(listed, entityClass, property);
            // null equals nothing in sql, `IN (NULL)` included, so a null in the list is asked for on
            // its own - which is what an in process evaluation of the same list answers
            return listed.length === value.length ? equalsListed : Or(equalsListed, IsNull());
        },
        notOneOf: (value, metadata, nestedProperties, entityClass, property) => {
            if (!Array.isArray(value)) {
                throw new InternalError('The "notOneOf" property of the where filter needs to be an array.');
            }
            const listed: unknown[] = value.filter(v => v !== null)
                .map(v => WhereValueUtilities.unwrapRelation(v, metadata));
            const notListed: FindOperator<unknown> = Not(this.equalsOneOf(listed, entityClass, property));
            // a row holding no value is not one of the values listed unless null is, the way `not`
            // answers it. `NOT IN` answers it with null either way, and keeps no row at all once
            // the list holds a null
            return listed.length === value.length ? Or(IsNull(), notListed) : And(Not(IsNull()), notListed);
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
        // the complement of like, which `NOT LIKE` alone answers with null for a row holding no value
        notLike: (value) => Or(IsNull(), Not(Like(value))),
        notILike: (value) => Or(IsNull(), Not(ILike(value))),
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
        includes: (value, metadata) => {
            if (!Array.isArray(value)) {
                throw new InternalError('The "includes" property of the where filter needs to be an array.');
            }
            return this.buildArrayIncludesOperator(value, metadata);
        },
        isIncludedIn: (value, metadata) => {
            if (!Array.isArray(value)) {
                throw new InternalError('The "isIncludedIn" property of the where filter needs to be an array.');
            }
            return this.buildArrayIsIncludedInOperator(value, metadata);
        },
        length: (value, metadata) => this.buildArrayLengthOperator('=', value, metadata),
        lengthGreaterThan: (value, metadata) => this.buildArrayLengthOperator('>', value, metadata),
        lengthGreaterThanEquals: (value, metadata) => this.buildArrayLengthOperator('>=', value, metadata),
        lengthLesserThan: (value, metadata) => this.buildArrayLengthOperator('<', value, metadata),
        lengthLesserThanEquals: (value, metadata) => this.buildArrayLengthOperator('<=', value, metadata)
    };

    /**
     * Numbers the bound values of every statement this converter builds.
     *
     * Never reset: typeorm merges the parameters of all raw operators into one set per query, so two
     * conditions reusing a name would mean the second one silently deciding what the first compares
     * against.
     */
    private parameterIndex: number = 0;

    /**
     * What the rows of each entity the filter being converted reaches through a relation are
     * narrowed to.
     *
     * Held for the length of one conversion rather than passed down, because the conversion is
     * synchronous and reaches every relation through the same few methods. A conversion started
     * inside another one, for a filter narrowing a related entity, carries the same narrowing.
     */
    protected related: RelatedNarrowing | undefined;

    constructor(protected readonly typeOrmDataSource: ToDataSource) {}

    /**
     * The expression a read is ordered by when it orders by similarity to a search.
     *
     * The same measure a fuzzyLike filter matches by, so that a search and an order over the same text
     * agree about which rows come closest.
     * @param path - The text being compared, as a property path the query builder resolves.
     * @param similarTo - The search the text is compared with.
     * @returns The expression, with the search bound rather than written into it.
     */
    abstract similarityExpression(path: string, similarTo: string): ParameterizedSql;

    /**
     * Starts collecting the values of one raw statement.
     * @returns A collector whose values are handed to the raw operator that is being built.
     */
    protected createParameters(): TypeOrmParameters {
        return new TypeOrmParameters(() => `zi_p${this.parameterIndex++}`);
    }

    // ── Public entry point (concrete) ──────────────────────────
    /**
     * Converts the given zibri filter to a typeorm filter.
     * @param filter - The zibri filter to convert.
     * @param entityClass - The entity class to search for by this filter.
     * @param related - What the rows of each entity the filter reaches through a relation are
     * narrowed to, which every filter through a relation in it is narrowed by.
     * @returns The typeorm filter.
     */
    convert<T extends BaseEntity>(
        filter: Where<T>,
        entityClass: Newable<T>,
        related?: RelatedNarrowing
    ): ToFindOptionsWhere<T> | ToFindOptionsWhere<T>[] {
        const previous: RelatedNarrowing | undefined = this.related;
        this.related = related ?? previous;
        try {
            return this.convertNarrowed(filter, entityClass);
        }
        finally {
            this.related = previous;
        }
    }

    /**
     * Converts a filter under the narrowing {@link convert} set.
     * @param filter - The zibri filter to convert.
     * @param entityClass - The entity class to search for by this filter.
     * @returns The typeorm filter.
     */
    private convertNarrowed<T extends BaseEntity>(
        filter: Where<T>,
        entityClass: Newable<T>
    ): ToFindOptionsWhere<T> | ToFindOptionsWhere<T>[] {
        // before the alternatives are distributed, since a narrowing can be several branches itself
        const narrowed: ScopedWhere<T> = RelatedNarrowingUtilities.narrowFilter(filter, entityClass, this.related);
        if (narrowed.matchesNothing || narrowed.where == undefined) {
            return this.matchesNoRow();
        }
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const written: WhereFilter<T>[] = ScopeWhereUtilities.branchesOf(narrowed.where);
        const branches: WhereFilter<T>[] = written.flatMap(f => this.distributeRelationAlternatives(f, properties));
        if (!Array.isArray(filter) && branches.length === 1 && branches[0] != undefined) {
            return this.singleWhereFilterToFindOptionsWhere(branches[0], properties, entityClass);
        }
        return branches.map(f => this.singleWhereFilterToFindOptionsWhere(f, properties, entityClass));
    }

    /**
     * The condition a join of an entity's rows carries so that it joins the rows the caller may see
     * of them, over the alias the join reads them under.
     *
     * Rendered the way every other filter is, by a statement the orm builds over that alias, which
     * is then cut down to its condition - so a narrowing is answered the same whether it narrows a
     * read or a join. A narrowing that reaches through a relation has joins of its own that a
     * condition cannot carry, so that statement is kept whole and the joined rows are asked to be
     * among the ones it selects.
     * @param target - The entity the join reads.
     * @param alias - The alias the join reads it under.
     * @param related - What the rows of each entity reached through a relation are narrowed to.
     * @returns The condition and what it binds, undefined when the rows are not narrowed.
     */
    relationJoinCondition(
        target: Newable<BaseEntity>,
        alias: string,
        related: RelatedNarrowing | undefined
    ): ParameterizedSql | undefined {
        const narrowing: Where<BaseEntity> | DenyAll | undefined = related?.get(target);
        if (narrowing == undefined) {
            return undefined;
        }
        if (narrowing === denyAll) {
            return { sql: 'FALSE', parameters: {} };
        }
        const select: SelectQueryBuilder<BaseEntity> = this.selectIdsOf(target, alias, narrowing, related);
        const statement: ParameterizedSql = this.toParameterizedSql(select, alias);
        const at: number = statement.sql.indexOf(WHERE);
        if (at === -1) {
            // a narrowing every row satisfies renders to no condition at all
            return undefined;
        }
        if (select.expressionMap.joinAttributes.length) {
            return { sql: `${alias}.id IN (${statement.sql})`, parameters: statement.parameters };
        }
        return { sql: statement.sql.slice(at + WHERE.length), parameters: statement.parameters };
    }

    /**
     * A statement the orm builds that selects the ids of the rows of an entity a filter matches.
     * @param target - The entity.
     * @param alias - The alias the statement reads it under.
     * @param where - The filter.
     * @param related - What the rows of each entity the filter reaches through a relation are
     * narrowed to.
     * @returns The statement, not yet rendered.
     */
    protected selectIdsOf(
        target: Newable<BaseEntity>,
        alias: string,
        where: Where<BaseEntity>,
        related: RelatedNarrowing | undefined
    ): SelectQueryBuilder<BaseEntity> {
        return this.typeOrmDataSource
            .createQueryBuilder(target, alias)
            .setFindOptions({ where: this.convert(where, target, related) })
            .select(`${alias}.id`);
    }

    /**
     * Renders a statement as sql with the values it binds, ready to land inside another statement.
     *
     * The orm numbers the values it binds per statement, and the statement this lands in numbers
     * its own the same way, so they are renamed after the alias the statement reads under.
     * @param statement - The statement.
     * @param alias - Its alias.
     * @returns The sql and the values.
     */
    toParameterizedSql<T extends BaseEntity>(statement: SelectQueryBuilder<T>, alias: string): ParameterizedSql {
        const prefix: string = `${alias}_`;
        const parameters: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(statement.getParameters())) {
            parameters[name.startsWith('orm_param_') ? `${prefix}${name}` : name] = value;
        }
        return {
            sql: statement.getQuery().replaceAll(/:orm_param_(\d+)\b/g, `:${prefix}orm_param_$1`),
            parameters
        };
    }

    /**
     * The find options no row matches, for a filter nothing can satisfy.
     * @returns The find options.
     */
    private matchesNoRow<T extends BaseEntity>(): ToFindOptionsWhere<T> {
        // on the id every entity has: the orm's find options are mapped over the entity, so a
        // condition written for the base is not one it can show to hold for every entity
        return { id: Raw(() => 'FALSE') } as ToFindOptionsWhere<T>;
    }

    /**
     * One branch of a filter as the branches it is an OR of, once every OR on a relation is moved to
     * the top.
     *
     * A condition on a relation is answered by a statement over the related rows, built for one
     * condition. A list of them is the same question as one branch per condition, with the rest of
     * the branch on each: `{ owner: [a, b], done: false }` is `[{ owner: a, done: false }, { owner: b,
     * done: false }]`. A list inside a `where` needs no moving, since the statement over the related
     * rows reads it as a filter of its own.
     * @param branch - The branch as the caller wrote it.
     * @param properties - The property metadata of the entity the branch filters.
     * @returns The branches it is an OR of. Just the branch when nothing in it has to move.
     */
    private distributeRelationAlternatives<T extends object>(
        branch: WhereFilter<T>,
        properties: Record<string, PropertyMetadata>
    ): WhereFilter<T>[] {
        let res: Record<string, unknown>[] = [{ ...branch }];
        for (const [key, condition] of Object.entries(branch)) {
            if (!isRelationMetadata(properties[key]) || !Array.isArray(condition)) {
                continue;
            }
            res = res.flatMap(r => condition.map((alternative: unknown) => ({ ...r, [key]: alternative })));
        }
        // the same keys as the branch it came from, each holding one of the conditions it allowed
        return res as WhereFilter<T>[];
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
            let condition: WhereFilterProperty<T[typeof key]> | WhereFilterProperty<T[typeof key]>[] = prop;

            if (isRelationMetadata(propertyMetadata)) {
                nestedProperties = MetadataUtilities.getModelProperties(propertyMetadata.target());
                const remaining: WhereFilterProperty<T[typeof key]> | undefined = this.answerOverRelatedRows(
                    String(key),
                    prop,
                    propertyMetadata,
                    entityClass,
                    extraRawConditions
                );
                if (remaining === undefined) {
                    continue;
                }
                condition = remaining;
            }
            else if (propertyMetadata.type === 'object') {
                nestedProperties = MetadataUtilities.getModelProperties(propertyMetadata.cls());
            }

            res[key] = this.propertyToFindOperator(
                condition,
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

    /**
     * Answers the keys of a condition on a relation that a statement over the related rows answers,
     * and hands back the keys it does not.
     *
     * A `where` through a relation asks for a related row matching it, which a statement over the
     * related rows asks exactly. A join asks something else: joined with no related row it holds
     * nulls, and a filter a null satisfies - `not`, `notLike`, `null` - is satisfied by the row that
     * has nothing related. The length and membership keys of a relation to many rows are statements
     * over the related rows as well.
     * @param key - The relation's property.
     * @param condition - The condition on it, as the caller wrote it.
     * @param metadata - The relation's metadata.
     * @param entityClass - The entity the relation is read from.
     * @param extraRawConditions - Where the statements are collected.
     * @returns The condition without the keys answered, or undefined when nothing is left of it.
     */
    private answerOverRelatedRows<P>(
        key: string,
        condition: WhereFilterProperty<P> | WhereFilterProperty<P>[],
        metadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<unknown>,
        extraRawConditions: FindOperator<unknown>[]
    ): WhereFilterProperty<P> | undefined {
        if (!ScopeWhereUtilities.isConditionObject(condition)) {
            // a value or null, which is asked of the row itself. A list was distributed into branches
            return condition as WhereFilterProperty<P>;
        }
        const res: Record<string, unknown> = { ...condition };
        if (metadata.type === Relation.ONE_TO_MANY || metadata.type === Relation.MANY_TO_MANY) {
            for (const lengthKey of lengthWhereFilterKeys) {
                const length: unknown = res[lengthKey];
                if (typeof length === 'number') {
                    extraRawConditions.push(this.buildRelationLengthRawOperator(entityClass, key, metadata, lengthKey, length));
                    // eslint-disable-next-line typescript/no-dynamic-delete
                    delete res[lengthKey];
                }
            }
            if (Array.isArray(res['includes'])) {
                extraRawConditions.push(this.buildRelationIncludesOperator(entityClass, key, metadata, res['includes'] as BaseEntity[]));
                delete res['includes'];
            }
            if (Array.isArray(res['isIncludedIn'])) {
                extraRawConditions.push(
                    this.buildRelationIsIncludedInOperator(entityClass, key, metadata, res['isIncludedIn'] as BaseEntity[])
                );
                delete res['isIncludedIn'];
            }
        }
        if (res['where'] != undefined) {
            extraRawConditions.push(this.buildRelationWhereOperator(entityClass, key, metadata, res['where'] as Where<BaseEntity>));
            delete res['where'];
        }
        return ObjectUtilities.keys(res).length ? res as WhereFilterProperty<P> : undefined;
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
        if (Array.isArray(property) && propertyMetadata.type === 'array') {
            return this.buildArrayEqualsOperator(property, propertyMetadata) as FindOperator<T>;
        }
        if (
            typeof property === 'string'
            || typeof property === 'bigint'
            || typeof property === 'number'
            || typeof property === 'boolean'
            || property instanceof Date
            || property instanceof BigNumber
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

    /**
     * Builds the operator matching a column that equals one of the given values.
     *
     * Abstract because how a list reaches the statement is the dialect's to say, and a list can be
     * as long as whoever wrote the filter made it.
     * @param values - The values, none of them null.
     * @param entityClass - The entity the column belongs to.
     * @param property - The property the column stores.
     * @returns A typeorm FindOperator, matching nothing for an empty list.
     */
    protected abstract equalsOneOf(values: unknown[], entityClass: Newable<unknown>, property: string): FindOperator<unknown>;

    /**
     * Builds the operator matching an array that is exactly the given one.
     *
     * Abstract because an array is stored the way the dialect stores it, and an array of objects may
     * not be an array column at all.
     * @param values - The values, in order.
     * @param metadata - The array property.
     * @returns A typeorm FindOperator, matching no row without an array.
     */
    protected abstract buildArrayEqualsOperator(values: unknown[], metadata: PropertyMetadata): FindOperator<unknown>;

    /**
     * Builds the operator matching an array that holds every one of the given values.
     *
     * Abstract because an array is stored the way the dialect stores it, and an array of objects may
     * not be an array column at all.
     * @param values - The values.
     * @param metadata - The array property.
     * @returns A typeorm FindOperator, matching no row without an array.
     */
    protected abstract buildArrayIncludesOperator(values: unknown[], metadata: PropertyMetadata): FindOperator<unknown>;

    /**
     * Builds the operator matching an array that holds at least one item, each of them one of the
     * given values.
     * @param values - The values.
     * @param metadata - The array property.
     * @returns A typeorm FindOperator, matching no row with an empty array or without one.
     */
    protected abstract buildArrayIsIncludedInOperator(values: unknown[], metadata: PropertyMetadata): FindOperator<unknown>;

    /**
     * Builds the operator comparing the length of an array.
     * @param operator - The sql comparison, eg. `>=`.
     * @param value - The length to compare with, which nothing has checked to be a number.
     * @param metadata - The array property.
     * @returns A typeorm FindOperator, matching no row without an array.
     */
    protected abstract buildArrayLengthOperator(operator: string, value: unknown, metadata: PropertyMetadata): FindOperator<unknown>;

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

    /**
     * Builds the operator matching a row with a related row that matches a filter.
     * @param entityClass - The entity the relation is read from.
     * @param propertyName - The relation's property.
     * @param metadata - The relation's metadata.
     * @param where - The filter on the related rows, narrowed to the ones the caller may see.
     * @returns A typeorm FindOperator, matching no row without a related row.
     */
    protected abstract buildRelationWhereOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        where: Where<BaseEntity>
    ): FindOperator<unknown>;
}