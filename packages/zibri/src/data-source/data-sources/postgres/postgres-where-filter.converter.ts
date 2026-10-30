import { PostgresParameters } from './postgres-parameters.model';
import { PostgresSchema } from './postgres-schema.model';
import { PostgresSqlUtilities } from './postgres-sql.utilities';
import { PostgresColumn, PostgresRelationJoin } from './postgres-table.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../../entity/decorators/property.decorator';
import { denyAll, DenyAll } from '../../../entity/models/entity-scope.model';
import { isRelationMetadata } from '../../../entity/models/is-relation-metadata.function';
import { OneOfPropertyMetadata } from '../../../entity/models/one-of-property-metadata.model';
import { Relation } from '../../../entity/models/relation.enum';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { BigNumber } from '../../../utilities/number.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { RelatedNarrowing } from '../../models/related-narrowing.model';
import { parseFuzzyLikeFilter, SimilarityBound } from '../../models/where/fuzzy-like.model';
import { OneOfWhereFilterUtilities } from '../../models/where/one-of-where-filter.utilities';
import { isAllOfWhereFilterKey, isWhereFilterKey, WhereFilterKeys } from '../../models/where/where-filter-keys.model';
import { Where, WhereFilter } from '../../models/where/where-filter.model';
import { WhereValueUtilities } from '../../models/where/where-value.utilities';
import { RelatedNarrowingUtilities } from '../../scopes/related-narrowing.utilities';
import { ScopedWhere, ScopeWhereUtilities } from '../../scopes/scope-where.utilities';
import { PropertyReferenceUtilities } from '../../where/property-reference.utilities';
import { ParameterizedSql } from '../where-converter/parameterized-sql.model';

/**
 * What this server's trigram support answers for, as it was measured at boot.
 *
 * Both fields decide whether a search can be written so that an index serves it, and neither can be
 * assumed: the threshold belongs to the server's configuration, and whether the operator includes it
 * is something postgres's documentation and its source disagree about.
 */
export type TrigramSupport = {
    /**
     * The similarity the `%` operator answers for, or undefined when pg_trgm is not installed.
     */
    threshold: number | undefined,
    /**
     * Whether the operator counts a similarity equal to the threshold as a match.
     */
    thresholdIsInclusive: boolean
};

/**
 * The keys of a filter on a relation to many rows that measure how many there are.
 */
const LENGTH_OPERATORS: ReadonlyMap<string, string> = new Map([
    ['length', '='],
    ['lengthGreaterThan', '>'],
    ['lengthGreaterThanEquals', '>='],
    ['lengthLesserThan', '<'],
    ['lengthLesserThanEquals', '<=']
]);

/**
 * The keys comparing a value with another, and how sql compares.
 */
const COMPARISONS: ReadonlyMap<string, string> = new Map([
    ['after', '>'],
    ['greaterThan', '>'],
    ['afterOrOn', '>='],
    ['greaterThanEquals', '>='],
    ['before', '<'],
    ['lesserThan', '<'],
    ['beforeOrOn', '<='],
    ['lesserThanEquals', '<=']
]);

/**
 * Marks a cast in the statement with the property it was emitted for.
 *
 * A cast is the one thing in a json condition that can fail on the data rather than on the query,
 * and postgres reports that failure with the value it could not read and nothing about where it came
 * from. Written into the statement as a comment so that the answer travels with the query that
 * raises the error.
 * @param path - The path to the property, starting at the column.
 * @param declaredType - The type the property declares.
 * @returns The comment to put after the cast.
 */
function castMarker(path: string, declaredType: string): string {
    return ` /* zibri-json:${path}:${declaredType} */`;
}

/**
 * The condition for a json value that is there to be compared.
 *
 * A key that is absent and a key that holds json null are the same thing to a caller, because a
 * value left undefined is not written at all - so both are what `null` asks for.
 * @param path - The expression reading the value as json.
 * @returns The sql condition.
 */
function hasJsonValue(path: string): string {
    return `(${path} IS NOT NULL AND ${path} <> 'null'::jsonb)`;
}

/**
 * Whether a value a filter names is an object or a list, which is compared as a whole json document.
 *
 * Equality rather than containment: `@>` also finds a value holding more than the one named, an
 * object with a property beside the ones named or a list with items beside them, where a filter
 * names one value (round-2 11 §S5).
 * @param value - The value.
 * @returns Whether it is an object or a list.
 */
function isJsonDocument(value: unknown): value is object {
    return typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof BigNumber);
}

/**
 * A value a filter names inside a json value, as it is bound: a large number as its digits, which the
 * numeric cast it is compared with reads, and anything else as it is.
 * @param value - The value.
 * @returns What to bind.
 */
function toJsonComparand(value: unknown): unknown {
    return typeof value === 'bigint' || value instanceof BigNumber ? value.toString() : value;
}

/**
 * The column a condition is on, and what it needs to compare with it.
 */
type ColumnContext = {
    /**
     * The column, qualified with the alias its row is read under.
     */
    sql: string,
    /**
     * The column.
     */
    column: PostgresColumn,
    /**
     * The property stored in it.
     */
    metadata: PropertyMetadata,
    /**
     * The entity the row is of.
     */
    entityClass: Newable<BaseEntity>,
    /**
     * The alias the row is read under.
     */
    alias: string,
    /**
     * Collects what the condition binds.
     */
    parameters: PostgresParameters
};

/**
 * Everything a single where-filter key inside of jsonb needs to build its condition.
 */
type JsonbOperatorContext = {
    /**
     * The field read as jsonb.
     */
    jsonPath: string,
    /**
     * The same field read as text.
     */
    textPath: string,
    /**
     * The text form cast to the type the property declares.
     */
    castPath: string,
    /**
     * The value that was filtered for.
     */
    value: unknown,
    /**
     * The name of the field that is being filtered on. For error messages.
     */
    fieldKey: string,
    /**
     * The path to the field, starting at the column. For error messages.
     */
    path: string,
    /**
     * The metadata of the field, when the property is declared on the model.
     */
    propMeta: PropertyMetadata | undefined,
    /**
     * Collects every value that is bound rather than written into the statement.
     */
    parameters: PostgresParameters,
    /**
     * Reads another property of the object the field is in, for a comparison naming it. Undefined for
     * a value that is in no object of properties, such as an item of a list.
     */
    sibling: ((property: string) => string) | undefined
};

/**
 * Handler function for a single where-filter key inside of jsonb.
 */
type JsonbOperatorHandler = (context: JsonbOperatorContext) => string;

/**
 * Where the rows of a relation are found by a statement over them, for a row reading it.
 */
type RelatedSide = {
    /**
     * The table holding one row per related row.
     */
    table: string,
    /**
     * The column of it naming the row the relation is read from.
     */
    ownColumn: string,
    /**
     * The column of it naming the related row.
     */
    targetColumn: string
};

/**
 * Turns a Zibri where filter into the condition of a postgres statement.
 */
export class PostgresWhereFilterConverter {

    private readonly jsonbOperatorHandlers: Record<WhereFilterKeys, JsonbOperatorHandler> = {
        is: ({ jsonPath, castPath, value, parameters }) => {
            if (value === null) {
                return `NOT ${hasJsonValue(jsonPath)}`;
            }
            if (isJsonDocument(value)) {
                return `${jsonPath} = ${this.toJsonbParameter(value, parameters)}`;
            }
            if (typeof value === 'bigint' || value instanceof BigNumber) {
                return `${castPath} = ${parameters.add(toJsonComparand(value))}`;
            }
            return `${jsonPath} @> ${this.toJsonbParameter(value as object, parameters)}`;
        },
        not: ({ jsonPath, castPath, value, parameters }) => {
            if (value === null) {
                // the complement of `is: null` rather than `IS NOT NULL`, which answers about the key
                // being there and leaves a row holding json null matching both questions at once
                return hasJsonValue(jsonPath);
            }
            // a value that is not there is not the value named either, as it is on a column
            if (isJsonDocument(value)) {
                return `(NOT ${hasJsonValue(jsonPath)} OR ${jsonPath} <> ${this.toJsonbParameter(value, parameters)})`;
            }
            return `(NOT ${hasJsonValue(jsonPath)} OR ${castPath} != ${parameters.add(toJsonComparand(value))})`;
        },
        oneOf: ({ jsonPath, castPath, value, fieldKey, parameters }) => {
            const all: unknown[] = this.toJsonbList(value, 'oneOf', fieldKey);
            const listed: unknown[] = all.filter(v => v !== null);
            const equalsListed: string = this.equalsAnyJson(jsonPath, castPath, listed, parameters);
            return listed.length === all.length ? equalsListed : `(${equalsListed} OR NOT ${hasJsonValue(jsonPath)})`;
        },
        notOneOf: ({ jsonPath, castPath, value, fieldKey, parameters }) => {
            const all: unknown[] = this.toJsonbList(value, 'notOneOf', fieldKey);
            const listed: unknown[] = all.filter(v => v !== null);
            const notListed: string = `NOT ${this.equalsAnyJson(jsonPath, castPath, listed, parameters)}`;
            return listed.length === all.length
                ? `(NOT ${hasJsonValue(jsonPath)} OR ${notListed})`
                : `(${hasJsonValue(jsonPath)} AND ${notListed})`;
        },
        like: ({ textPath, value, parameters }) => `${textPath} LIKE ${parameters.add(value)}`,
        iLike: ({ textPath, value, parameters }) => `${textPath} ILIKE ${parameters.add(value)}`,
        notLike: ({ jsonPath, textPath, value, parameters }) => {
            return `(NOT ${hasJsonValue(jsonPath)} OR ${textPath} NOT LIKE ${parameters.add(value)})`;
        },
        notILike: ({ jsonPath, textPath, value, parameters }) => {
            return `(NOT ${hasJsonValue(jsonPath)} OR ${textPath} NOT ILIKE ${parameters.add(value)})`;
        },
        fuzzyLike: ({ textPath, value, path, parameters }) => {
            const { value: searchString, minSimilarityRatio, bound } = parseFuzzyLikeFilter(value);
            const search: string = parameters.add(searchString);
            if (bound != undefined) {
                return this.boundCondition(textPath, search, parameters.add(bound.text), bound);
            }
            // no operator here whatever the ratio is: a trigram index covers a column, and a value
            // inside a json document is not one, so there is no index for it to reach
            this.reportUnindexedSearch(path, minSimilarityRatio);
            // the ratio is a number by construction, so it cannot carry sql. Left in the statement
            // rather than bound so that a NaN still fails loudly instead of matching nothing
            return `similarity(${textPath}, ${search}) >= ${minSimilarityRatio}`;
        },
        greaterThan: context => this.jsonbComparison(context, '>'),
        after: context => this.jsonbComparison(context, '>'),
        greaterThanEquals: context => this.jsonbComparison(context, '>='),
        afterOrOn: context => this.jsonbComparison(context, '>='),
        lesserThan: context => this.jsonbComparison(context, '<'),
        before: context => this.jsonbComparison(context, '<'),
        lesserThanEquals: context => this.jsonbComparison(context, '<='),
        beforeOrOn: context => this.jsonbComparison(context, '<='),
        length: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) = ${parameters.add(value)}`,
        lengthGreaterThan: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) > ${parameters.add(value)}`,
        lengthGreaterThanEquals: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) >= ${parameters.add(value)}`,
        lengthLesserThan: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) < ${parameters.add(value)}`,
        lengthLesserThanEquals: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) <= ${parameters.add(value)}`,
        includes: ({ jsonPath, value, fieldKey, propMeta, parameters }) => {
            const list: string = this.toJsonbParameter(this.toJsonbList(value, 'includes', fieldKey), parameters);
            return this.holdsScalarItems(propMeta) ? `${jsonPath} @> ${list}` : this.includesEveryItem(jsonPath, list);
        },
        isIncludedIn: ({ jsonPath, value, fieldKey, propMeta, parameters }) => {
            const list: string = this.toJsonbParameter(this.toJsonbList(value, 'isIncludedIn', fieldKey), parameters);
            // not empty, as on a column. Compared rather than measured, as jsonb_array_length raises on
            // a json scalar
            return this.holdsScalarItems(propMeta)
                ? `(${jsonPath} <@ ${list} AND ${jsonPath} <> '[]'::jsonb)`
                : this.everyItemIncludedIn(jsonPath, list);
        },
        where: ({ jsonPath, value, fieldKey, path, propMeta, parameters }) => this.buildJsonbWhereCondition(
            jsonPath,
            value,
            propMeta,
            fieldKey,
            parameters,
            path
        )
    };

    /**
     * Numbers the bound values of every statement this converter builds, never reset, so that the
     * conditions of one statement never share a name.
     */
    private parameterIndex: number = 0;

    /**
     * Numbers the aliases of the statements inside a condition: the elements of a json array, and the
     * rows of a relation.
     */
    private aliasIndex: number = 0;

    /**
     * What the rows of each entity the filter being converted reaches through a relation are narrowed
     * to, held for the length of one conversion.
     */
    private related: RelatedNarrowing | undefined;

    /**
     * The searches this converter has already reported as reading every row, so that the warning is
     * given once rather than per query.
     */
    private readonly reportedUnindexedSearches: Set<string> = new Set();

    constructor(
        private readonly schema: PostgresSchema,
        private readonly logger: LoggerInterface,
        private readonly trigram: TrigramSupport
    ) {}

    /**
     * Starts collecting the values of one statement.
     * @returns The collector.
     */
    createParameters(): PostgresParameters {
        return new PostgresParameters(() => `zi_p${this.parameterIndex++}`);
    }

    /**
     * Names an alias that no other part of the statements this converter builds uses.
     * @param prefix - What it starts with.
     * @returns The alias.
     */
    createAlias(prefix: string = 'zi_r'): string {
        return `${prefix}${this.aliasIndex++}`;
    }

    /**
     * Converts a filter into the condition of a statement reading its rows under an alias.
     * @param filter - The filter.
     * @param entityClass - The entity it filters.
     * @param alias - The alias its rows are read under.
     * @param related - What the rows of each entity the filter reaches through a relation are narrowed
     * to, which every filter through a relation in it is narrowed by.
     * @returns The condition, and what it binds.
     */
    convert<T extends BaseEntity>(filter: Where<T>, entityClass: Newable<T>, alias: string, related?: RelatedNarrowing): ParameterizedSql {
        const parameters: PostgresParameters = this.createParameters();
        return { sql: this.convertWith(filter, entityClass, alias, parameters, related), parameters: parameters.values };
    }

    /**
     * The condition narrowing the rows of an entity read under an alias to the ones the caller may see.
     * @param target - The entity.
     * @param alias - The alias its rows are read under.
     * @param related - What the rows of each entity are narrowed to.
     * @returns The condition, or undefined when its rows are not narrowed.
     */
    convertNarrowing(target: Newable<BaseEntity>, alias: string, related: RelatedNarrowing | undefined): ParameterizedSql | undefined {
        const narrowing: Where<BaseEntity> | DenyAll | undefined = related?.get(target);
        if (narrowing == undefined) {
            return undefined;
        }
        return narrowing === denyAll ? { sql: 'FALSE', parameters: {} } : this.convert(narrowing, target, alias, related);
    }

    /**
     * The expression a read is ordered by when it orders by similarity to a search: the same measure a
     * fuzzyLike filter matches by, so that a search and an order over the same text agree.
     * @param column - The text being compared, as sql.
     * @param similarTo - The search the text is compared with.
     * @returns The expression, with the search bound rather than written into it.
     */
    similarityExpression(column: string, similarTo: string): ParameterizedSql {
        const parameters: PostgresParameters = this.createParameters();
        return { sql: `similarity(${column}, ${parameters.add(similarTo)})`, parameters: parameters.values };
    }

    /**
     * The statement selecting the ids of the rows of an entity a filter matches.
     * @param target - The entity.
     * @param where - The filter.
     * @param parameters - Collects what it binds.
     * @param related - What the rows the filter reaches through a relation are narrowed to.
     * @returns The statement.
     */
    selectIdsOf(
        target: Newable<BaseEntity>,
        where: Where<BaseEntity>,
        parameters: PostgresParameters,
        related: RelatedNarrowing | undefined
    ): string {
        const alias: string = this.createAlias();
        const table: string = this.schema.getTable(target).name;
        return `SELECT ${this.qualifyId(target, alias)}`
            + ` FROM ${PostgresSqlUtilities.escapeIdentifier(table)} ${PostgresSqlUtilities.escapeIdentifier(alias)}`
            + ` WHERE ${this.convertWith(where, target, alias, parameters, related)}`;
    }

    private convertWith<T extends BaseEntity>(
        filter: Where<T>,
        entityClass: Newable<T>,
        alias: string,
        parameters: PostgresParameters,
        related: RelatedNarrowing | undefined
    ): string {
        const previous: RelatedNarrowing | undefined = this.related;
        this.related = related ?? previous;
        try {
            // before the alternatives are distributed, since a narrowing can be several branches itself
            const narrowed: ScopedWhere<T> = RelatedNarrowingUtilities.narrowFilter(filter, entityClass, this.related);
            if (narrowed.matchesNothing || narrowed.where == undefined) {
                return 'FALSE';
            }
            const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
            const branches: WhereFilter<T>[] = ScopeWhereUtilities.branchesOf(narrowed.where)
                .flatMap(branch => this.distributeRelationAlternatives(branch, properties));
            return this.or(branches.map(branch => this.convertBranch(branch, properties, entityClass, alias, parameters)));
        }
        finally {
            this.related = previous;
        }
    }

    /**
     * One branch of a filter as the branches it is an OR of, once every OR on a relation is moved to
     * the top: `{ owner: [a, b], done: false }` is `[{ owner: a, done: false }, { owner: b, done: false }]`.
     * @param branch - The branch as the caller wrote it.
     * @param properties - The property metadata of the entity the branch filters.
     * @returns The branches it is an OR of.
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

    private convertBranch<T extends BaseEntity>(
        branch: WhereFilter<T>,
        properties: Record<string, PropertyMetadata>,
        entityClass: Newable<T>,
        alias: string,
        parameters: PostgresParameters
    ): string {
        const conditions: string[] = [];
        for (const [key, condition] of Object.entries(branch)) {
            if (condition === undefined) {
                continue;
            }
            const metadata: PropertyMetadata | undefined = properties[key];
            if (metadata == undefined) {
                // the filter type only allows declared keys, so this is a filter that was built from data
                throw new InternalError(`Cannot filter "${entityClass.name}" by "${key}", which it does not declare as a property.`);
            }
            if (isRelationMetadata(metadata)) {
                conditions.push(...this.convertRelationCondition(key, condition, metadata, entityClass, alias, parameters));
                continue;
            }
            const column: PostgresColumn = this.schema.getColumn(entityClass, key);
            const context: ColumnContext = {
                sql: PostgresSqlUtilities.qualify(alias, column.name),
                column,
                metadata,
                entityClass,
                alias,
                parameters
            };
            conditions.push(this.convertProperty(condition, context));
        }
        return this.and(conditions);
    }

    /**
     * Converts a condition on a relation.
     *
     * A `where` through a relation asks for a related row matching it, which a statement over the
     * related rows asks exactly - as do the length and membership keys of a relation to many rows. A
     * value or `null` on a relation whose key the row holds is asked of that key.
     * @param key - The relation's property.
     * @param condition - The condition, as the caller wrote it.
     * @param metadata - The relation.
     * @param entityClass - The entity the relation is read from.
     * @param alias - The alias its rows are read under.
     * @param parameters - Collects what the conditions bind.
     * @returns The conditions, all of which a row has to meet.
     * @throws When the row stores no key for a relation whose key it holds.
     */
    private convertRelationCondition(
        key: string,
        condition: unknown,
        metadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<BaseEntity>,
        alias: string,
        parameters: PostgresParameters
    ): string[] {
        const join: PostgresRelationJoin = this.schema.getJoin(entityClass, key);
        if (!ScopeWhereUtilities.isConditionObject(condition)) {
            return [this.convertRelationValue(key, condition, join, metadata, entityClass, alias, parameters)];
        }
        const keys: Record<string, unknown> = { ...condition };
        const res: string[] = this.convertRelatedRowsKeys(keys, join, metadata, entityClass, alias, parameters);
        if (!ObjectUtilities.keys(keys).length) {
            return res;
        }
        return [...res, this.convertRelationValue(key, keys, join, metadata, entityClass, alias, parameters)];
    }

    /**
     * Converts the keys of a condition on a relation that ask about the related rows themselves: how
     * many there are, which they are, and whether one matches a filter. Removes each key it converts.
     * @param keys - The keys of the condition, as the caller wrote them.
     * @param join - The relation's join.
     * @param metadata - The relation.
     * @param entityClass - The entity the relation is read from.
     * @param alias - The alias its rows are read under.
     * @param parameters - Collects what the conditions bind.
     * @returns The conditions, all of which a row has to meet.
     */
    private convertRelatedRowsKeys(
        keys: Record<string, unknown>,
        join: PostgresRelationJoin,
        metadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<BaseEntity>,
        alias: string,
        parameters: PostgresParameters
    ): string[] {
        const res: string[] = [];
        const side: RelatedSide | undefined = join.kind === 'key' ? undefined : this.resolveRelatedSide(join);
        if (side != undefined && (metadata.type === Relation.ONE_TO_MANY || metadata.type === Relation.MANY_TO_MANY)) {
            for (const [lengthKey, operator] of LENGTH_OPERATORS) {
                const length: unknown = keys[lengthKey];
                if (typeof length === 'number') {
                    // a number by its type, so it cannot carry sql
                    res.push(`(${this.countRelated(side, metadata, entityClass, alias, parameters)}) ${operator} ${length}`);
                    Reflect.deleteProperty(keys, lengthKey);
                }
            }
            if (Array.isArray(keys['includes'])) {
                res.push(this.convertIncludes(side, metadata, entityClass, alias, keys['includes'] as BaseEntity[], parameters));
                Reflect.deleteProperty(keys, 'includes');
            }
            if (Array.isArray(keys['isIncludedIn'])) {
                const allowed: BaseEntity[] = keys['isIncludedIn'] as BaseEntity[];
                res.push(this.convertIsIncludedIn(side, metadata, entityClass, alias, allowed, parameters));
                Reflect.deleteProperty(keys, 'isIncludedIn');
            }
        }
        if (keys['where'] != undefined) {
            res.push(this.convertRelationWhere(join, metadata, entityClass, alias, keys['where'] as Where<BaseEntity>, parameters));
            Reflect.deleteProperty(keys, 'where');
        }
        return res;
    }

    /**
     * Converts what a condition on a relation asks of its value: of the key the row holds, or of
     * whether a related row holding the key of this one is there.
     * @param key - The relation's property.
     * @param condition - What is asked of the value, or `null` for none.
     * @param join - The relation's join.
     * @param metadata - The relation.
     * @param entityClass - The entity the relation is read from.
     * @param alias - The alias its rows are read under.
     * @param parameters - Collects what the condition binds.
     * @returns The sql condition.
     * @throws When the row stores no key for a relation whose key it holds.
     */
    private convertRelationValue(
        key: string,
        condition: unknown,
        join: PostgresRelationJoin,
        metadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<BaseEntity>,
        alias: string,
        parameters: PostgresParameters
    ): string {
        if (join.kind === 'key') {
            const column: PostgresColumn | undefined = this.schema.getTable(entityClass).columns.find(c => c.name === join.column);
            if (column == undefined) {
                throw new InternalError(`"${entityClass.name}" stores no key for "${key}".`);
            }
            const context: ColumnContext = {
                sql: PostgresSqlUtilities.qualify(alias, column.name),
                column,
                metadata,
                entityClass,
                alias,
                parameters
            };
            return this.convertProperty(condition, context);
        }
        // a relation to rows holding the key of this one, asked for a value or for none: whether such a
        // row is there
        const side: RelatedSide = this.resolveRelatedSide(join);
        const rows: string = this.relatedRows(side, metadata, entityClass, alias, parameters);
        if (condition === null) {
            return `NOT EXISTS (${rows})`;
        }
        const target: PostgresColumn = this.schema.getColumn(metadata.target(), 'id');
        const context: ColumnContext = {
            sql: PostgresSqlUtilities.qualify(side.table, side.targetColumn),
            column: target,
            metadata,
            entityClass,
            alias: side.table,
            parameters
        };
        return `EXISTS (${rows} AND ${this.convertProperty(condition, context)})`;
    }

    /**
     * Converts the condition on one property stored in a column.
     * @param condition - The condition, or several of which one has to hold.
     * @param context - The column.
     * @returns The sql condition.
     */
    private convertProperty(condition: unknown, context: ColumnContext): string {
        if (Array.isArray(condition) && context.metadata.type !== 'array') {
            return this.or(condition.map(alternative => this.convertSingle(alternative, context)));
        }
        return this.convertSingle(condition, context);
    }

    /**
     * Converts one condition on a property stored in a column.
     * @param condition - The condition.
     * @param context - The column.
     * @returns The sql condition.
     * @throws When the condition is empty or names a key no filter has.
     */
    private convertSingle(condition: unknown, context: ColumnContext): string {
        const { sql, column, metadata, parameters } = context;
        if (condition === null) {
            return `${sql} IS NULL`;
        }
        if (Array.isArray(condition) && metadata.type === 'array') {
            return this.arrayEquals(condition, context);
        }
        if (
            typeof condition === 'string' || typeof condition === 'bigint' || typeof condition === 'number'
            || typeof condition === 'boolean' || condition instanceof Date || condition instanceof BigNumber
        ) {
            return `${sql} = ${parameters.add(column.toColumn(condition))}`;
        }
        if (metadata.type === 'oneOf') {
            return `(${hasJsonValue(sql)} AND ${this.buildJsonbOneOfCondition(sql, condition, metadata, parameters, column.name)})`;
        }
        if (typeof condition !== 'object' || condition == undefined) {
            throw new InternalError(`Unexpected where filter ${JsonUtilities.stringify(condition)}`);
        }
        const keys: string[] = Object.keys(condition);
        if (!keys.length) {
            throw new InternalError('Empty where filter');
        }
        const conditions: string[] = [];
        for (const key of keys) {
            if (!isWhereFilterKey(key)) {
                throw new InternalError(`Unknown key "${key}" on where filter ${JsonUtilities.stringify(condition)}`);
            }
            // a key taking several values becomes one condition per value, joined by the AND below
            for (const value of this.everyOf(key, (condition as Record<string, unknown>)[key])) {
                conditions.push(this.convertKey(key, value, context));
            }
        }
        return this.and(conditions);
    }

    /**
     * Converts one key of a condition on a column.
     * @param key - The key.
     * @param value - What it asks.
     * @param context - The column.
     * @returns The sql condition.
     */
    private convertKey(key: WhereFilterKeys, value: unknown, context: ColumnContext): string {
        const { sql, column, metadata, parameters } = context;
        const operator: string | undefined = COMPARISONS.get(key);
        if (operator != undefined) {
            return `${sql} ${operator} ${this.comparand(value, context)}`;
        }
        switch (key) {
            case 'is': {
                return value === null
                    ? `${sql} IS NULL`
                    : `${sql} = ${parameters.add(column.toColumn(WhereValueUtilities.unwrapRelation(value, metadata)))}`;
            }
            case 'not': {
                if (value === null) {
                    return `${sql} IS NOT NULL`;
                }
                // a row holding no value is not the value named, which `!=` alone answers with null
                const differs: string = Array.isArray(value) && metadata.type === 'array'
                    ? `NOT ${this.arrayEquals(value, context)}`
                    : `${sql} != ${parameters.add(column.toColumn(WhereValueUtilities.unwrapRelation(value, metadata)))}`;
                return `(${sql} IS NULL OR ${differs})`;
            }
            case 'oneOf':
            case 'notOneOf': {
                return this.convertOneOf(key, value, context);
            }
            case 'like': {
                return `${sql} LIKE ${parameters.add(value)}`;
            }
            case 'iLike': {
                return `${sql} ILIKE ${parameters.add(value)}`;
            }
            // the complement of like, which `NOT LIKE` alone answers with null for a row holding no value
            case 'notLike': {
                return `(${sql} IS NULL OR ${sql} NOT LIKE ${parameters.add(value)})`;
            }
            case 'notILike': {
                return `(${sql} IS NULL OR ${sql} NOT ILIKE ${parameters.add(value)})`;
            }
            case 'fuzzyLike': {
                return this.convertFuzzyLike(value, context);
            }
            case 'where': {
                return this.convertJsonWhere(value, context);
            }
            case 'includes': {
                const values: unknown[] = this.toList(value, key, column.name);
                // a json column holds objects or values of several shapes, which containment would match by part
                return this.isStoredAsJson(metadata)
                    ? this.includesEveryItem(sql, this.toJsonbParameter(values, parameters))
                    : `${sql} @> ${parameters.add(column.toColumn(values))}`;
            }
            case 'isIncludedIn': {
                const values: unknown[] = this.toList(value, key, column.name);
                // not empty as well: an empty array is asked for with a length of 0 alone
                return this.isStoredAsJson(metadata)
                    ? this.everyItemIncludedIn(sql, this.toJsonbParameter(values, parameters))
                    : `(${sql} <@ ${parameters.add(column.toColumn(values))} AND cardinality(${sql}) > 0)`;
            }
            case 'length':
            case 'lengthGreaterThan':
            case 'lengthGreaterThanEquals':
            case 'lengthLesserThan':
            case 'lengthLesserThanEquals': {
                // bound rather than written, since nothing checks at runtime that it is a number
                const length: string = parameters.add(value);
                const lengthOperator: string = LENGTH_OPERATORS.get(key) ?? '=';
                // cardinality rather than array_length, which answers null for an empty array. A CASE for
                // json rather than an AND guarding it, because jsonb_array_length raises on a json scalar
                const jsonLength: string = `CASE WHEN jsonb_typeof(${sql}) = 'array' THEN jsonb_array_length(${sql}) END`;
                return this.isStoredAsJson(metadata)
                    ? `${jsonLength} ${lengthOperator} ${length}`
                    : `cardinality(${sql}) ${lengthOperator} ${length}`;
            }
            case 'after':
            case 'before':
            case 'afterOrOn':
            case 'beforeOrOn':
            case 'greaterThan':
            case 'greaterThanEquals':
            case 'lesserThan':
            case 'lesserThanEquals': {
                // answered above, by the comparisons
                return `${sql} ${COMPARISONS.get(key) ?? '='} ${this.comparand(value, context)}`;
            }
        }
    }

    /**
     * Converts a `oneOf` or a `notOneOf` on a column.
     * @param key - Which of the two it is.
     * @param value - The values listed.
     * @param context - The column.
     * @returns The sql condition.
     */
    private convertOneOf(key: 'oneOf' | 'notOneOf', value: unknown, context: ColumnContext): string {
        const { sql, column, metadata, parameters } = context;
        const all: unknown[] = this.toList(value, key, column.name);
        const listed: unknown[] = all
            .filter(v => v !== null)
            .map(v => this.toListElement(column.toColumn(WhereValueUtilities.unwrapRelation(v, metadata))));
        // one array rather than a placeholder per value: `= ANY` compares against every element
        // the way `IN` compares against every placeholder, and binds one value however long it is
        const equalsListed: string = `${sql} = ANY(${parameters.addList(listed)})`;
        if (key === 'oneOf') {
            // null equals nothing in sql, `IN (NULL)` included, so a null listed is asked for on its own
            return listed.length === all.length ? equalsListed : `(${equalsListed} OR ${sql} IS NULL)`;
        }
        return listed.length === all.length
            ? `(${sql} IS NULL OR NOT ${equalsListed})`
            : `(${sql} IS NOT NULL AND NOT ${equalsListed})`;
    }

    /**
     * What a comparison compares with: the value it names, bound, or another column of the same row.
     * @param value - The value, or a reference to another property.
     * @param context - The column compared.
     * @returns The sql.
     */
    private comparand(value: unknown, context: ColumnContext): string {
        if (!PropertyReferenceUtilities.isReference(value)) {
            return context.parameters.add(context.column.toColumn(value));
        }
        // a row holding no value in either column matches no comparison, which is what sql answers
        return PostgresSqlUtilities.qualify(context.alias, this.schema.getColumn(context.entityClass, value.property).name);
    }

    private convertFuzzyLike(value: unknown, context: ColumnContext): string {
        const { sql, column, entityClass, parameters } = context;
        const { value: searchString, minSimilarityRatio, bound } = parseFuzzyLikeFilter(value);
        const search: string = parameters.add(searchString);
        if (bound != undefined) {
            // only ever next to the filter the walk was started with, which is what an index answers
            return this.boundCondition(sql, search, parameters.add(bound.text), bound);
        }
        const ratioCondition: string = `similarity(${sql}, ${search}) >= ${minSimilarityRatio}`;
        if (!this.indexCanAnswer(minSimilarityRatio)) {
            this.reportUnindexedSearch(`${entityClass.name}.${column.name}`, minSimilarityRatio);
            return ratioCondition;
        }
        // the operator asks for the server's own threshold and takes no argument, so it can only be
        // added where it lets through everything the ratio does - and there it asks for strictly less
        // than the condition beside it, which is what makes it free to add. What it buys is an index
        return `(${sql} % ${search} AND ${ratioCondition})`;
    }

    private arrayEquals(values: unknown[], context: ColumnContext): string {
        // as a json document: handed over as an array it would reach the column as array text
        return this.isStoredAsJson(context.metadata)
            ? `${context.sql} = ${this.toJsonbParameter(values, context.parameters)}`
            : `${context.sql} = ${context.parameters.add(context.column.toColumn(values))}`;
    }

    /**
     * Whether an array property is one json value rather than an array column, which is how an array
     * of objects or of values of several shapes is stored.
     * @param metadata - The property.
     * @returns Whether the column is jsonb.
     */
    private isStoredAsJson(metadata: PropertyMetadata): boolean {
        return metadata.type === 'array' && (metadata.items.type === 'object' || metadata.items.type === 'oneOf');
    }

    /**
     * The form a value takes as an element of a list bound as one value, which reaches the server as
     * array text: a large whole number and a json document as the text they are written as.
     * @param value - The value as the column stores it.
     * @returns The value to put into the list.
     */
    private toListElement(value: unknown): unknown {
        if (typeof value === 'bigint') {
            return value.toString();
        }
        if (typeof value === 'object' && value !== null && !(value instanceof Date) && !Buffer.isBuffer(value)) {
            return JsonUtilities.stringify(value);
        }
        return value;
    }

    private toList(value: unknown, key: string, fieldKey: string): unknown[] {
        if (!Array.isArray(value)) {
            throw new InternalError(`The "${key}" property of the where filter on "${fieldKey}" needs to be an array.`);
        }
        return value;
    }

    private toJsonbList(value: unknown, key: string, fieldKey: string): unknown[] {
        if (!Array.isArray(value)) {
            throw new InternalError(`"${key}" must be an array for JSONB field "${fieldKey}"`);
        }
        return value;
    }

    /**
     * The values a key asks of the property: one for every key but the few that take several.
     * @param key - The key of the filter.
     * @param value - What the key holds.
     * @returns Every value the property has to satisfy.
     * @throws When a key that takes several values is given none.
     */
    private everyOf(key: WhereFilterKeys, value: unknown): unknown[] {
        if (!isAllOfWhereFilterKey(key) || !Array.isArray(value)) {
            return [value];
        }
        if (!value.length) {
            throw new InternalError(`The "${key}" property of the where filter needs at least one value.`);
        }
        return value;
    }

    private and(conditions: string[]): string {
        return conditions.length === 0 ? 'TRUE' : conditions.length === 1 ? conditions[0] ?? 'TRUE' : `(${conditions.join(' AND ')})`;
    }

    private or(conditions: string[]): string {
        return conditions.length === 0 ? 'FALSE' : conditions.length === 1 ? conditions[0] ?? 'FALSE' : `(${conditions.join(' OR ')})`;
    }

    private qualifyId(entityClass: Newable<BaseEntity>, alias: string): string {
        return PostgresSqlUtilities.qualify(alias, this.schema.getTable(entityClass).primaryKey.columns[0] ?? 'id');
    }

    // ── relations ───────────────────────────────────────────────

    /**
     * Where the rows of a relation whose key the related rows hold are found: the related entity's own
     * table for a one to many or has one relation, the join table for a many to many one.
     * @param join - The relation's join.
     * @returns The side.
     */
    private resolveRelatedSide(join: Exclude<PostgresRelationJoin, Record<'kind', 'key'>>): RelatedSide {
        return join.kind === 'inverse'
            ? { table: join.table, ownColumn: join.column, targetColumn: 'id' }
            : { table: join.junction, ownColumn: join.ownColumn, targetColumn: join.targetColumn };
    }

    /**
     * The statement selecting the related rows of the row read under an alias, narrowed to the ones
     * the caller may see.
     * @param side - Where the related rows are.
     * @param metadata - The relation.
     * @param entityClass - The entity the relation is read from.
     * @param alias - The alias its row is read under.
     * @param parameters - Collects what the statement binds.
     * @returns The statement, ready for more conditions.
     */
    private relatedRows(
        side: RelatedSide,
        metadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<BaseEntity>,
        alias: string,
        parameters: PostgresParameters
    ): string {
        const table: string = PostgresSqlUtilities.escapeIdentifier(side.table);
        const target: string = PostgresSqlUtilities.qualify(side.table, side.targetColumn);
        const narrowing: Where<BaseEntity> | DenyAll | undefined = this.related?.get(metadata.target());
        const narrowed: string = narrowing == undefined
            ? ''
            : narrowing === denyAll
                ? ' AND FALSE'
                : ` AND ${target} IN (${this.selectIdsOf(metadata.target(), narrowing, parameters, this.related)})`;
        const own: string = PostgresSqlUtilities.qualify(side.table, side.ownColumn);
        return `SELECT 1 FROM ${table} WHERE ${own} = ${this.qualifyId(entityClass, alias)}${narrowed}`;
    }

    private countRelated(
        side: RelatedSide,
        metadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<BaseEntity>,
        alias: string,
        parameters: PostgresParameters
    ): string {
        return this.relatedRows(side, metadata, entityClass, alias, parameters).replace('SELECT 1', 'SELECT COUNT(*)');
    }

    private convertIncludes(
        side: RelatedSide,
        metadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<BaseEntity>,
        alias: string,
        entities: BaseEntity[],
        parameters: PostgresParameters
    ): string {
        if (!entities.length) {
            return 'TRUE';
        }
        const ids: string = parameters.addList(entities.map(e => e.id));
        const count: string = this.countRelated(side, metadata, entityClass, alias, parameters);
        return `(${count} AND ${PostgresSqlUtilities.qualify(side.table, side.targetColumn)} = ANY(${ids})) = ${entities.length}`;
    }

    private convertIsIncludedIn(
        side: RelatedSide,
        metadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<BaseEntity>,
        alias: string,
        entities: BaseEntity[],
        parameters: PostgresParameters
    ): string {
        // a row has to have related rows, and all of them allowed, so allowing none is allowing no row
        if (!entities.length) {
            return 'FALSE';
        }
        const ids: string = parameters.addList(entities.map(e => e.id));
        const rows: string = this.relatedRows(side, metadata, entityClass, alias, parameters);
        // the EXISTS is what leaves out a row without related rows, which a length of 0 asks for alone
        const target: string = PostgresSqlUtilities.qualify(side.table, side.targetColumn);
        return `(EXISTS (${rows}) AND NOT EXISTS (${rows} AND ${target} <> ALL(${ids})))`;
    }

    /**
     * Converts a filter through a relation: the row has a related row matching it, named by a statement
     * built the way every other filter is, so that it is answered as the same filter on the related
     * entity is - narrowing and all.
     * @param join - The relation's join.
     * @param metadata - The relation.
     * @param entityClass - The entity the relation is read from.
     * @param alias - The alias its row is read under.
     * @param where - The filter on the related rows.
     * @param parameters - Collects what the condition binds.
     * @returns The sql condition.
     */
    private convertRelationWhere(
        join: PostgresRelationJoin,
        metadata: RelationMetadata<BaseEntity>,
        entityClass: Newable<BaseEntity>,
        alias: string,
        where: Where<BaseEntity>,
        parameters: PostgresParameters
    ): string {
        const matching: string = this.selectIdsOf(metadata.target(), where, parameters, this.related);
        if (join.kind === 'key') {
            return `${PostgresSqlUtilities.qualify(alias, join.column)} IN (${matching})`;
        }
        const side: RelatedSide = this.resolveRelatedSide(join);
        // the statement narrows its rows already, so the side's narrowing is not asked a second time
        return `EXISTS (SELECT 1 FROM ${PostgresSqlUtilities.escapeIdentifier(side.table)}`
            + ` WHERE ${PostgresSqlUtilities.qualify(side.table, side.ownColumn)} = ${this.qualifyId(entityClass, alias)}`
            + ` AND ${PostgresSqlUtilities.qualify(side.table, side.targetColumn)} IN (${matching}))`;
    }

    // ── json ────────────────────────────────────────────────────

    /**
     * Converts a `where` on an object or an array column.
     * @param value - The filter.
     * @param context - The column.
     * @returns The sql condition.
     * @throws When the column holds no object and no array.
     */
    private convertJsonWhere(value: unknown, context: ColumnContext): string {
        const { sql, column, metadata, parameters } = context;
        const itemsPath: string = `${column.name}[]`;
        if (metadata.type === 'array' && metadata.items.type === 'oneOf') {
            const element: string = this.createAlias('zi_elem_');
            const item: string = this.buildJsonbOneOfCondition(element, value, metadata.items, parameters, itemsPath);
            return `(${hasJsonValue(sql)} AND EXISTS (SELECT 1 FROM jsonb_array_elements(${sql}) AS ${element} WHERE ${item}))`;
        }
        if (metadata.type === 'array') {
            const element: string = this.createAlias('zi_elem_');
            if (metadata.items.type !== 'object') {
                // a real array column, read as json so that an item is asked what a value inside a json
                // column is asked. A column holding no value has no items, as to_jsonb keeps it NULL
                const item: string = this.buildJsonbItemCondition(element, value, metadata, 'item', parameters, itemsPath);
                return `EXISTS (SELECT 1 FROM jsonb_array_elements(to_jsonb(${sql})) AS ${element} WHERE ${item})`;
            }
            const inner: string = this.buildJsonbCondition(
                element,
                value as Where<Record<string, unknown>>,
                MetadataUtilities.getModelProperties(metadata.items.cls()),
                parameters,
                itemsPath
            );
            // guarded rather than left to jsonb_array_elements, which raises on a column holding the
            // json scalar null instead of returning the no rows it returns for an absent one
            return `(${hasJsonValue(sql)} AND EXISTS (SELECT 1 FROM jsonb_array_elements(${sql}) AS ${element} WHERE ${inner}))`;
        }
        if (metadata.type !== 'object') {
            throw new InternalError(
                'The "where" operator is not supported on this property without nested metadata:'
                + ` "${column.name}" holds no object and no list.`
            );
        }
        // a question about a property of an object is not one a row without that object answers, so the
        // whole nested condition is false there rather than each part of it deciding separately
        const nested: string = this.buildJsonbCondition(
            sql,
            value as Where<Record<string, unknown>>,
            MetadataUtilities.getModelProperties(metadata.cls()),
            parameters,
            column.name
        );
        return `(${hasJsonValue(sql)} AND ${nested})`;
    }

    /**
     * Builds the condition for a value of several named shapes: the value names a shape the filter
     * matches, and holds what the filter of that shape asks for.
     * @param jsonPath - The value, read as json.
     * @param filter - The filter, or several filters of which one has to match.
     * @param metadata - The shapes the value can be.
     * @param parameters - Collects the values the condition binds.
     * @param path - The path to the value, for the markers of its casts.
     * @returns The sql condition.
     * @throws When the filter is no object.
     */
    private buildJsonbOneOfCondition(
        jsonPath: string,
        filter: unknown,
        metadata: Pick<OneOfPropertyMetadata, 'shapes'>,
        parameters: PostgresParameters,
        path: string
    ): string {
        if (Array.isArray(filter)) {
            return this.or(filter.map(f => this.buildJsonbOneOfCondition(jsonPath, f, metadata, parameters, path)));
        }
        if (typeof filter !== 'object' || filter === null) {
            throw new InternalError(`Unexpected filter of a value of several shapes at "${path}": ${JsonUtilities.stringify(filter)}`);
        }
        const shapeFilters: Map<string, unknown> = OneOfWhereFilterUtilities.shapeFilters(filter as Record<string, unknown>, metadata);
        const parts: string[] = [];
        for (const [name, shape] of ObjectUtilities.entries(metadata.shapes)) {
            if (!shapeFilters.has(name)) {
                continue;
            }
            const shapeFilter: unknown = shapeFilters.get(name);
            const isShape: string = `(${jsonPath}->>'shape') = ${parameters.add(name)}`;
            if (OneOfWhereFilterUtilities.matchesEveryValue(shapeFilter)) {
                parts.push(`(${isShape})`);
                continue;
            }
            // the value of a shape is one value, with no property beside it to compare with
            const condition: string = this.buildJsonbFieldCondition(
                jsonPath,
                'value',
                shapeFilter,
                { ...shape } as PropertyMetadata,
                parameters,
                `${path}.${name}`,
                undefined
            );
            parts.push(`(${isShape} AND ${condition})`);
        }
        return parts.length ? `(${parts.join(' OR ')})` : 'FALSE';
    }

    private buildJsonbCondition(
        jsonbAlias: string,
        whereFilter: Where<Record<string, unknown>>,
        propertyMetadataMap: Record<string, PropertyMetadata>,
        parameters: PostgresParameters,
        path: string
    ): string {
        if (Array.isArray(whereFilter)) {
            const alternatives: string[] = whereFilter.map(
                f => `(${this.buildJsonbCondition(jsonbAlias, f, propertyMetadataMap, parameters, path)})`
            );
            return `(${alternatives.join(' OR ')})`;
        }
        // a property of the same object, read the way a condition on it reads it
        const sibling: (property: string) => string = property => {
            const key: string = `${parameters.add(property)}::text`;
            const propertyPath: string = `${path}.${property}`;
            return `(${jsonbAlias}->>${key})${this.getJsonbCast(propertyMetadataMap[property], propertyPath)}`;
        };
        const parts: string[] = ObjectUtilities.entries(whereFilter as Record<string, unknown>).map(
            ([key, filterValue]) => this.buildJsonbFieldCondition(
                jsonbAlias,
                key,
                filterValue,
                propertyMetadataMap[key],
                parameters,
                path,
                sibling
            )
        );
        return parts.length ? parts.join(' AND ') : 'TRUE';
    }

    private buildJsonbWhereCondition(
        jsonPath: string,
        val: unknown,
        propMeta: PropertyMetadata | undefined,
        fieldKey: string,
        parameters: PostgresParameters,
        path: string
    ): string {
        if (propMeta?.type === 'object') {
            // guarded the same way the column itself is: an object that is not there answers nothing
            const nested: string = this.buildJsonbCondition(
                jsonPath,
                val as Where<Record<string, unknown>>,
                MetadataUtilities.getModelProperties(propMeta.cls()),
                parameters,
                path
            );
            return `(${hasJsonValue(jsonPath)} AND ${nested})`;
        }
        if (propMeta?.type === 'array') {
            const element: string = this.createAlias('zi_elem_');
            const item: string = propMeta.items.type === 'oneOf'
                ? this.buildJsonbOneOfCondition(element, val, propMeta.items, parameters, `${path}[]`)
                : propMeta.items.type === 'object'
                    ? this.buildJsonbCondition(
                        element,
                        val as Where<Record<string, unknown>>,
                        MetadataUtilities.getModelProperties(propMeta.items.cls()),
                        parameters,
                        `${path}[]`
                    )
                    : this.buildJsonbItemCondition(element, val, propMeta, `${fieldKey}[]`, parameters, `${path}[]`);
            return `(${hasJsonValue(jsonPath)} AND EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonPath}) AS ${element} WHERE ${item}))`;
        }
        throw new InternalError(`"where" operator used on a non-object, non-array JSONB field "${fieldKey}"`);
    }

    private buildJsonbItemCondition(
        elementAlias: string,
        filter: unknown,
        metadata: PropertyMetadata,
        fieldKey: string,
        parameters: PostgresParameters,
        path: string
    ): string {
        return this.buildJsonbValueCondition(filter, {
            jsonPath: elementAlias,
            textPath: `(${elementAlias} #>> '{}')`,
            fieldKey,
            path,
            propMeta: WhereValueUtilities.itemMetadata(metadata),
            parameters,
            // an item of a list is a value alone, with no property beside it
            sibling: undefined
        });
    }

    private buildJsonbFieldCondition(
        jsonbAlias: string,
        fieldKey: string,
        filterValue: unknown,
        propMeta: PropertyMetadata | undefined,
        parameters: PostgresParameters,
        parentPath: string,
        sibling: ((property: string) => string) | undefined
    ): string {
        if (isRelationMetadata(propMeta)) {
            throw new InternalError(`Cannot filter on relation "${fieldKey}" inside a JSONB column. `
                + 'Relations are not supported as part of embedded JSON objects/arrays.');
        }
        // the field name is bound as well: a json key is not a sql identifier and does not have to be
        // spellable as one, so there is nothing to escape it as
        const key: string = `${parameters.add(fieldKey)}::text`;
        return this.buildJsonbValueCondition(filterValue, {
            jsonPath: `(${jsonbAlias}->${key})`,
            textPath: `(${jsonbAlias}->>${key})`,
            fieldKey,
            path: `${parentPath}.${fieldKey}`,
            propMeta,
            parameters,
            sibling
        });
    }

    private buildJsonbValueCondition(filterValue: unknown, context: OmitStrict<JsonbOperatorContext, 'value' | 'castPath'>): string {
        const { jsonPath, textPath, fieldKey, path, propMeta, parameters } = context;
        const castPath: string = `${textPath}${this.getJsonbCast(propMeta, path)}`;
        if (filterValue === null) {
            return `NOT ${hasJsonValue(jsonPath)}`;
        }
        if (propMeta?.type === 'oneOf') {
            return `(${hasJsonValue(jsonPath)} AND ${this.buildJsonbOneOfCondition(jsonPath, filterValue, propMeta, parameters, path)})`;
        }
        if (
            typeof filterValue === 'string' || typeof filterValue === 'number' || typeof filterValue === 'boolean'
            || typeof filterValue === 'bigint' || filterValue instanceof Date || filterValue instanceof BigNumber
        ) {
            return `${castPath} = ${parameters.add(toJsonComparand(filterValue))}`;
        }
        if (Array.isArray(filterValue)) {
            // several conditions mean any of them, unless the value is a list itself, which the array
            // is then the one value to match exactly: in order, item for item, as the evaluator
            // compares two lists. Containment both ways took a list in another order for it
            if (propMeta?.type !== 'array') {
                return filterValue.length ? this.or(filterValue.map(f => `(${this.buildJsonbValueCondition(f, context)})`)) : 'FALSE';
            }
            return `${jsonPath} = ${this.toJsonbParameter(filterValue, parameters)}`;
        }
        if (typeof filterValue !== 'object') {
            throw new InternalError(`Unexpected JSONB filter value for field "${fieldKey}": ${JsonUtilities.stringify(filterValue)}`);
        }
        return this.buildJsonbOperatorConditions(filterValue as Record<string, unknown>, { ...context, castPath });
    }

    /**
     * Builds the condition for the keys of a filter on a value inside json, each converted by its
     * operator.
     * @param filter - The filter, by its keys.
     * @param context - The value.
     * @returns The sql condition, all of whose parts have to hold.
     * @throws When a key names no operator.
     */
    private buildJsonbOperatorConditions(filter: Record<string, unknown>, context: OmitStrict<JsonbOperatorContext, 'value'>): string {
        const conditions: string[] = [];
        for (const [op, value] of ObjectUtilities.entries(filter)) {
            const handler: JsonbOperatorHandler | undefined = this.jsonbOperatorHandlers[op as WhereFilterKeys];
            if (handler == undefined) {
                throw new InternalError(`Unknown JSONB filter operator "${op}" on field "${context.fieldKey}"`);
            }
            for (const one of this.everyOf(op as WhereFilterKeys, value)) {
                conditions.push(handler({ ...context, value: one }));
            }
        }
        return conditions.length ? conditions.join(' AND ') : 'TRUE';
    }

    /**
     * A comparison inside json, with the value it names, bound, or another property of the same object.
     * @param context - The comparison.
     * @param operator - How sql compares.
     * @returns The sql condition.
     * @throws When it names a property where the value has none beside it.
     */
    private jsonbComparison(context: JsonbOperatorContext, operator: string): string {
        const value: unknown = context.value;
        if (!PropertyReferenceUtilities.isReference(value)) {
            return `${context.castPath} ${operator} ${context.parameters.add(toJsonComparand(value))}`;
        }
        if (context.sibling == undefined) {
            throw new InternalError(`"${context.path}" compares with "${value.property}", and holds no property beside it.`);
        }
        return `${context.castPath} ${operator} ${context.sibling(value.property)}`;
    }

    private toJsonbParameter(value: object, parameters: PostgresParameters): string {
        return `${parameters.add(JsonUtilities.stringify(value))}::jsonb`;
    }

    /**
     * Whether a json value equals one of the values listed.
     * @param jsonPath - The value, read as json.
     * @param castPath - The value, read as text and cast to what its property declares.
     * @param listed - The values, none of them null.
     * @param parameters - Collects the values the condition binds.
     * @returns The sql condition.
     */
    private equalsAnyJson(jsonPath: string, castPath: string, listed: unknown[], parameters: PostgresParameters): string {
        // an object or a list is compared as a whole json document, which a list of them bound as an
        // array cannot carry
        if (listed.some(isJsonDocument)) {
            return `(${jsonPath} IN (SELECT jsonb_array_elements(${this.toJsonbParameter(listed, parameters)})))`;
        }
        return `(${castPath} = ANY(${parameters.addList(listed.map(toJsonComparand))}))`;
    }

    /**
     * Whether a list property inside json holds values that containment compares as a whole: texts,
     * numbers, dates and yes or no. An object or a list item it compares by part.
     * @param metadata - The property.
     * @returns Whether its items are such values.
     */
    private holdsScalarItems(metadata: PropertyMetadata | undefined): boolean {
        return metadata?.type === 'array'
            && (metadata.items.type === 'string' || metadata.items.type === 'number'
                || metadata.items.type === 'boolean' || metadata.items.type === 'date');
    }

    /**
     * Whether a json list holds every value of another, each as a whole.
     * @param jsonPath - The list, read as json.
     * @param list - The values, bound as a json list.
     * @returns The sql condition, false for a value that is no list.
     */
    private includesEveryItem(jsonPath: string, list: string): string {
        const wanted: string = this.createAlias('zi_want_');
        const held: string = this.createAlias('zi_held_');
        // a CASE rather than an AND guarding it, because jsonb_array_elements raises on a json scalar
        return `(CASE WHEN jsonb_typeof(${jsonPath}) = 'array' THEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${list}) AS ${wanted}`
            + ` WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonPath}) AS ${held} WHERE ${held} = ${wanted})) ELSE FALSE END)`;
    }

    /**
     * Whether a json list holds at least one value, each of them one of another list's, as a whole.
     * @param jsonPath - The list, read as json.
     * @param list - The values allowed, bound as a json list.
     * @returns The sql condition, false for a value that is no list and for an empty one.
     */
    private everyItemIncludedIn(jsonPath: string, list: string): string {
        const held: string = this.createAlias('zi_held_');
        const allowed: string = this.createAlias('zi_allowed_');
        return `(CASE WHEN jsonb_typeof(${jsonPath}) = 'array' AND ${jsonPath} <> '[]'::jsonb`
            + ` THEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonPath}) AS ${held}`
            + ` WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${list}) AS ${allowed} WHERE ${allowed} = ${held})) ELSE FALSE END)`;
    }

    private getJsonbCast(propMeta: PropertyMetadata | undefined, path: string): string {
        if (!propMeta) {
            return '';
        }
        switch (propMeta.type) {
            case 'number': {
                return `::numeric${castMarker(path, propMeta.type)}`;
            }
            case 'date': {
                return `::timestamptz${castMarker(path, propMeta.type)}`;
            }
            case 'boolean': {
                return `::boolean${castMarker(path, propMeta.type)}`;
            }
            case 'string': {
                // 11 §S10: a text read out of json takes the database's collation, and a text column the
                // application's. Compared by the same one, `after` agrees with the column and the evaluator
                return ` COLLATE ${PostgresSqlUtilities.escapeIdentifier(this.schema.getTextCollation())}`;
            }
            case 'object':
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY:
            case 'array':
            case 'file':
            case 'unknown':
            // no one type to cast as when the value can be one of several
            case 'oneOf': {
                return '';
            }
        }
    }

    // ── similarity ──────────────────────────────────────────────

    /**
     * The condition comparing a similarity with the similarity of the bound's text to the same search,
     * both calculated by the server in the same statement.
     * @param path - The text being compared, as sql.
     * @param search - The placeholder of the search.
     * @param text - The placeholder of the bound's text.
     * @param bound - The bound, for the comparison it asks for.
     * @returns The condition.
     */
    private boundCondition(path: string, search: string, text: string, bound: SimilarityBound): string {
        return `similarity(${path}, ${search}) ${bound.comparison === 'lesser' ? '<' : '='} similarity(${text}, ${search})`;
    }

    /**
     * Whether a trigram index can answer a search for the given similarity: the operator reaching the
     * index asks for the server's threshold, and lets through every row the search wants only at or
     * above it.
     * @param minSimilarityRatio - The similarity the search asks for.
     * @returns True when the operator can be added without changing which rows match.
     */
    private indexCanAnswer(minSimilarityRatio: number): boolean {
        if (this.trigram.threshold == undefined) {
            return false;
        }
        return this.trigram.thresholdIsInclusive
            ? minSimilarityRatio >= this.trigram.threshold
            : minSimilarityRatio > this.trigram.threshold;
    }

    private reportUnindexedSearch(subject: string, minSimilarityRatio: number): void {
        const key: string = `${subject}:${minSimilarityRatio}`;
        if (this.reportedUnindexedSearches.has(key)) {
            return;
        }
        this.reportedUnindexedSearches.add(key);
        const from: string = this.trigram.threshold == undefined
            ? 'nothing, because the pg_trgm extension is not installed'
            : String(this.trigram.threshold);
        this.logger.warn(
            `A "fuzzyLike" on ${subject} asks for a similarity of ${minSimilarityRatio}, and this data source`
            + ` searches from ${from}. Below that the trigram index would leave out rows the search asks for,`
            + ' so this search reads every row instead. Ask for a higher "minSimilarity" to have the index answer it.'
        );
    }
}