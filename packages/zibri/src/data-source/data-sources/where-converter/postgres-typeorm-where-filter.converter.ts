import { And, ArrayContainedBy, ArrayContains, Raw, FindOperator, DataSource as ToDataSource } from 'typeorm';
import { ColumnMetadata as ToColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';
import { RelationMetadata as ToRelationMetadata } from 'typeorm/metadata/RelationMetadata.js';

import { ParameterizedSql } from './parameterized-sql.model.ts';
import { TypeOrmParameters } from './typeorm-parameters.ts';
import { TypeOrmWhereFilterConverter, WhereFilterHandler } from './typeorm-where-filter.converter.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { EntityMetadata } from '../../../entity/decorators/entity.decorator.ts';
import { PropertyMetadata, RelationMetadata } from '../../../entity/decorators/property.decorator.ts';
import { EntityMetadataMissingError } from '../../../entity/entity-metadata-missing.error.ts';
import { OneOfPropertyMetadata } from '../../../entity/models/one-of-property-metadata.model.ts';
import { RelationType } from '../../../entity/models/relation-type.enum.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { type LoggerInterface } from '../../../logging/logger.interface.ts';
import { Newable } from '../../../types/newable.type.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';
import { MetadataUtilities } from '../../../utilities/metadata.utilities.ts';
import { ObjectUtilities } from '../../../utilities/object.utilities.ts';
import { TypeOrmUtilities } from '../../../utilities/typeorm.utilities.ts';
import { parseFuzzyLikeFilter, SimilarityBound } from '../../models/where/fuzzy-like.model.ts';
import { OneOfWhereFilterUtilities } from '../../models/where/one-of-where-filter.utilities.ts';
import { WhereFilterKeys } from '../../models/where/where-filter-keys.model.ts';
import { Where } from '../../models/where/where-filter.model.ts';

const ALIAS: string = '$$COL$$';

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
 * Marks a cast in the statement with the property it was emitted for.
 *
 * A cast is the one thing in a json condition that can fail on the data rather than on the query,
 * and postgres reports that failure with the value it could not read and nothing about where it came
 * from. Written into the statement as a comment so that the answer travels with the query that
 * raises the error: the alternative is rebuilding the filter a second time in the error path, where
 * it would have to agree with this one forever without anything holding it to that.
 * @param path - The path to the property, starting at the column placeholder.
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
 * value left undefined is not written at all - so both are what `null` asks for, and neither is
 * something an ordering or a comparison can be asked about.
 * @param path - The expression reading the value as json.
 * @returns The sql condition.
 */
function hasJsonValue(path: string): string {
    return `(${path} IS NOT NULL AND ${path} <> 'null'::jsonb)`;
}

/**
 * Everything a single where-filter key inside of jsonb needs to build its condition.
 */
type JsonbOperatorContext = {
    /**
     * The field read as jsonb, e.g. `("order"."metadata"->$1::text)`.
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
     * The path to the field, starting at the column placeholder. For error messages.
     */
    path: string,
    /**
     * The metadata of the field, when the property is declared on the model.
     */
    propMeta: PropertyMetadata | undefined,
    /**
     * Collects every value that is bound rather than written into the statement.
     */
    parameters: TypeOrmParameters
};

/**
 * Handler function for a single where-filter key inside of jsonb.
 */
type JsonbOperatorHandler = (context: JsonbOperatorContext) => string;

/**
 * Converter that transforms a Zibri WhereFilter into a TypeORM FindOptionsWhere for postgres.
 */
export class PostgresTypeOrmWhereFilterConverter extends TypeOrmWhereFilterConverter {

    private readonly jsonbOperatorHandlers: Record<WhereFilterKeys, JsonbOperatorHandler> = {
        is: ({ jsonPath, value, parameters }) => value === null
            ? `NOT ${hasJsonValue(jsonPath)}`
            : `${jsonPath} @> ${this.toJsonbParameter(value as object, parameters)}`,
        not: ({ jsonPath, castPath, value, parameters }) => {
            if (value === null) {
                // the complement of `is: null` rather than `IS NOT NULL`, which answers about the key
                // being there and leaves a row holding json null matching both questions at once
                return hasJsonValue(jsonPath);
            }
            // a value that is not there is not the value named either, as it is on a column
            if (typeof value === 'object' && !Array.isArray(value)) {
                return `(NOT ${hasJsonValue(jsonPath)} OR NOT (${jsonPath} @> ${this.toJsonbParameter(value, parameters)}))`;
            }
            return `(NOT ${hasJsonValue(jsonPath)} OR ${castPath} != ${parameters.add(value)})`;
        },
        oneOf: ({ jsonPath, castPath, value, fieldKey, parameters }) => {
            if (!Array.isArray(value)) {
                throw new InternalError(`"oneOf" must be an array for JSONB field "${fieldKey}"`);
            }
            const listed: unknown[] = value.filter(v => v !== null);
            const equalsListed: string = `${castPath} = ANY(${parameters.addList(listed)})`;
            // for the reasons the column handlers give: a null listed is asked for on its own, and
            // the list is bound as one value however long it is
            return listed.length === value.length ? equalsListed : `(${equalsListed} OR NOT ${hasJsonValue(jsonPath)})`;
        },
        notOneOf: ({ jsonPath, castPath, value, fieldKey, parameters }) => {
            if (!Array.isArray(value)) {
                throw new InternalError(`"notOneOf" must be an array for JSONB field "${fieldKey}"`);
            }
            const listed: unknown[] = value.filter(v => v !== null);
            const notListed: string = `NOT (${castPath} = ANY(${parameters.addList(listed)}))`;
            return listed.length === value.length
                ? `(NOT ${hasJsonValue(jsonPath)} OR ${notListed})`
                : `(${hasJsonValue(jsonPath)} AND ${notListed})`;
        },
        like: ({ textPath, value, parameters }) => `${textPath} LIKE ${parameters.add(value)}`,
        iLike: ({ textPath, value, parameters }) => `${textPath} ILIKE ${parameters.add(value)}`,
        // a value that is not there is unlike every pattern, as it is on a column
        notLike: ({ jsonPath, textPath, value, parameters }) => `(NOT ${hasJsonValue(jsonPath)}`
            + ` OR ${textPath} NOT LIKE ${parameters.add(value)})`,
        notILike: ({ jsonPath, textPath, value, parameters }) => `(NOT ${hasJsonValue(jsonPath)}`
            + ` OR ${textPath} NOT ILIKE ${parameters.add(value)})`,
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
            // rather than bound so that a NaN still fails loudly instead of matching nothing.
            return `similarity(${textPath}, ${search}) >= ${minSimilarityRatio}`;
        },
        greaterThan: ({ castPath, value, parameters }) => `${castPath} > ${parameters.add(value)}`,
        after: ({ castPath, value, parameters }) => `${castPath} > ${parameters.add(value)}`,
        greaterThanEquals: ({ castPath, value, parameters }) => `${castPath} >= ${parameters.add(value)}`,
        afterOrOn: ({ castPath, value, parameters }) => `${castPath} >= ${parameters.add(value)}`,
        lesserThan: ({ castPath, value, parameters }) => `${castPath} < ${parameters.add(value)}`,
        before: ({ castPath, value, parameters }) => `${castPath} < ${parameters.add(value)}`,
        lesserThanEquals: ({ castPath, value, parameters }) => `${castPath} <= ${parameters.add(value)}`,
        beforeOrOn: ({ castPath, value, parameters }) => `${castPath} <= ${parameters.add(value)}`,
        length: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) = ${parameters.add(value)}`,
        lengthGreaterThan: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) > ${parameters.add(value)}`,
        lengthGreaterThanEquals: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) >= ${parameters.add(value)}`,
        lengthLesserThan: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) < ${parameters.add(value)}`,
        lengthLesserThanEquals: ({ jsonPath, value, parameters }) => `jsonb_array_length(${jsonPath}) <= ${parameters.add(value)}`,
        includes: ({ jsonPath, value, fieldKey, parameters }) => {
            if (!Array.isArray(value)) {
                throw new InternalError(`"includes" must be an array for JSONB field "${fieldKey}"`);
            }
            return `${jsonPath} @> ${this.toJsonbParameter(value, parameters)}`;
        },
        isIncludedIn: ({ jsonPath, value, fieldKey, parameters }) => {
            if (!Array.isArray(value)) {
                throw new InternalError(`"isIncludedIn" must be an array for JSONB field "${fieldKey}"`);
            }
            // not empty, as on a column. Compared rather than measured, as jsonb_array_length raises
            // on a json scalar
            return `(${jsonPath} <@ ${this.toJsonbParameter(value, parameters)} AND ${jsonPath} <> '[]'::jsonb)`;
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
     * Numbers the aliases this converter gives to the elements of a jsonb array.
     *
     * Derived from a counter rather than from the field name, because an alias is a sql identifier
     * and a json key is not: `line-items` is a perfectly ordinary key and `elem_line-items` is a
     * syntax error.
     */
    private elementAliasIndex: number = 0;

    /**
     * The searches this converter has already reported as reading every row.
     *
     * A filter is built per call, so without this the same warning would be written once per query
     * for as long as the process runs. Keyed by what the warning says, which is a property and a
     * similarity - bounded by what the application asks for, since a similarity is a whole percent.
     */
    private readonly reportedUnindexedSearches: Set<string> = new Set();

    constructor(
        dataSource: ToDataSource,
        private readonly logger: LoggerInterface,
        private readonly trigram: TrigramSupport
    ) {
        super(dataSource);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected fuzzyLikeWhereFilterHandler: WhereFilterHandler = (value, metadata, nestedProperties, entityClass, property) => {
        const { value: searchString, minSimilarityRatio, bound } = parseFuzzyLikeFilter(value);
        const parameters: TypeOrmParameters = this.createParameters();
        const search: string = parameters.add(searchString);
        if (bound != undefined) {
            // only ever next to the filter the walk was started with, which is what an index answers
            // if anything does - a bound is a narrowing of that and asks for no index of its own
            const text: string = parameters.add(bound.text);
            return Raw(alias => this.boundCondition(alias, search, text, bound), parameters.values);
        }
        const ratioCondition: (alias: string) => string = alias => `similarity(${alias}, ${search}) >= ${minSimilarityRatio}`;

        if (!this.indexCanAnswer(minSimilarityRatio)) {
            this.reportUnindexedSearch(`${entityClass.name}.${String(property)}`, minSimilarityRatio);
            return Raw(ratioCondition, parameters.values);
        }

        // the operator asks for the server's own threshold and takes no argument, so it can only be
        // added where it lets through everything the ratio does - and there it asks for strictly less
        // than the condition beside it, which is what makes it free to add. What it buys is an index:
        // a trigram index answers the operator and can answer nothing about `similarity`
        return Raw(alias => `${alias} % ${search} AND ${ratioCondition(alias)}`, parameters.values);
    };

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected equalsOneOf(values: unknown[], entityClass: Newable<unknown>, property: string): FindOperator<unknown> {
        const column: ToColumnMetadata | undefined = this.typeOrmDataSource.hasMetadata(entityClass)
            ? this.typeOrmDataSource.getMetadata(entityClass).findColumnWithPropertyName(property)
            : undefined;
        // one array rather than a placeholder per value: a statement binds at most 65535 values, and
        // `= ANY` compares against every element the way `IN` compares against every placeholder. The
        // column's transformer runs here, per value, because typeorm hands it the operator as a whole
        // and passes a raw operator's own values on untouched
        const elements: unknown[] = values.map(v => this.toListElement(
            column == undefined ? v : TypeOrmUtilities.toColumnValue(column, v)
        ));
        const parameters: TypeOrmParameters = this.createParameters();
        const list: string = parameters.addList(elements);
        return Raw(alias => `${alias} = ANY(${list})`, parameters.values);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected buildArrayIncludesOperator(values: unknown[], metadata: PropertyMetadata): FindOperator<unknown> {
        if (!this.isStoredAsJson(metadata)) {
            return ArrayContains(values);
        }
        const parameters: TypeOrmParameters = this.createParameters();
        return this.rawOnFilteredColumn(
            `(${hasJsonValue(ALIAS)} AND ${ALIAS} @> ${this.toJsonbParameter(values, parameters)})`,
            parameters
        );
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected buildArrayIsIncludedInOperator(values: unknown[], metadata: PropertyMetadata): FindOperator<unknown> {
        // not empty as well: an empty array is asked for with a length of 0 alone, so that no allow
        // list finds one without saying so
        if (!this.isStoredAsJson(metadata)) {
            return And(ArrayContainedBy(values), Raw(alias => `cardinality(${alias}) > 0`));
        }
        const parameters: TypeOrmParameters = this.createParameters();
        return this.rawOnFilteredColumn(
            `(${hasJsonValue(ALIAS)} AND ${ALIAS} <@ ${this.toJsonbParameter(values, parameters)} AND ${ALIAS} <> '[]'::jsonb)`,
            parameters
        );
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected buildArrayLengthOperator(operator: string, value: unknown, metadata: PropertyMetadata): FindOperator<unknown> {
        // the filter value is typed as a number but nothing checks that at runtime, so it is bound
        // rather than written into the statement. A caller that sends something else now gets the
        // database refusing it instead of a statement that says something else than it reads like.
        const parameters: TypeOrmParameters = this.createParameters();
        const length: string = parameters.add(value);
        if (!this.isStoredAsJson(metadata)) {
            // cardinality rather than array_length, which answers null for an empty array and so left
            // a length of 0 finding none. Both answer null for a missing array, which a length passes over
            return Raw(alias => `cardinality(${alias}) ${operator} ${length}`, parameters.values);
        }
        // a CASE rather than an AND guarding it, because jsonb_array_length raises on a json scalar and
        // sql does not promise to look at the left side of an AND first
        return this.rawOnFilteredColumn(
            `CASE WHEN jsonb_typeof(${ALIAS}) = 'array' THEN jsonb_array_length(${ALIAS}) END ${operator} ${length}`,
            parameters
        );
    }

    /**
     * Whether an array property is one json value rather than an array column, which is how the data
     * source stores an array of objects or of values of several shapes.
     * @param metadata - The array property.
     * @returns Whether the column is jsonb.
     */
    private isStoredAsJson(metadata: PropertyMetadata): boolean {
        return metadata.type === 'array' && (metadata.items.type === 'object' || metadata.items.type === 'oneOf');
    }

    /**
     * The form a value takes as an element of a list bound as one value.
     *
     * Such a list reaches the server as array text, so a large whole number and a json document are
     * handed over as the text they are written as, which the column then reads back into its type.
     * @param value - The value as the column stores it.
     * @returns The value to put into the list.
     */
    private toListElement(value: unknown): unknown {
        if (typeof value === 'bigint') {
            return value.toString();
        }
        if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
            return JsonUtilities.stringify(value);
        }
        return value;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    similarityExpression(path: string, similarTo: string): ParameterizedSql {
        const parameters: TypeOrmParameters = this.createParameters();
        return { sql: `similarity(${path}, ${parameters.add(similarTo)})`, parameters: parameters.values };
    }

    /**
     * The condition comparing a similarity with the similarity of the bound's text to the same search.
     *
     * Both sides are calculated by the server in the same statement, so "exactly as similar" is an
     * equality between two results of one function rather than between a stored and a carried number.
     * @param path - The text being compared, as sql.
     * @param search - The placeholder of the search.
     * @param text - The placeholder of the bound's text.
     * @param bound - The bound, for the comparison it asks for.
     * @returns The condition.
     */
    private boundCondition(path: string, search: string, text: string, bound: SimilarityBound): string {
        const operator: string = bound.comparison === 'lesser' ? '<' : '=';
        return `similarity(${path}, ${search}) ${operator} similarity(${text}, ${search})`;
    }

    /**
     * Whether a trigram index can answer a search for the given similarity.
     *
     * The index itself has no similarity in it - it holds the trigrams, and how many of them a row
     * has to share is decided per scan. What decides this is the operator that reaches the index,
     * which asks for the server's threshold and nothing else: above it the operator lets through
     * every row the search wants and more, and below it the operator would leave out rows the search
     * asks for, which is not something to trade a table read for.
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

    /**
     * Reports a search that reads every row, once for each search that does.
     * @param subject - The property being searched, as the entity names it.
     * @param minSimilarityRatio - The similarity the search asks for.
     */
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

    // ── JSONB-aware "where" handler ─────────────────────────────

    protected override whereHandler(
        value: unknown,
        metadata: PropertyMetadata,
        nestedProperties: Record<string, PropertyMetadata> | undefined,
        entityClass: Newable<unknown>
    ): FindOperator<unknown> {
        if (metadata.type !== 'object' && metadata.type !== 'array') {
            return super.whereHandler(value, metadata, nestedProperties, entityClass);
        }

        const parameters: TypeOrmParameters = this.createParameters();

        if (metadata.type === 'array' && metadata.items.type === 'oneOf') {
            const elementAlias: string = this.nextElementAlias();
            const innerSql: string = this.buildJsonbOneOfCondition(elementAlias, value, metadata.items, parameters, `${ALIAS}[]`);
            const sql: string = `(${hasJsonValue(ALIAS)} AND EXISTS `
                + `(SELECT 1 FROM jsonb_array_elements(${ALIAS}) AS ${elementAlias} WHERE ${innerSql}))`;
            return this.rawOnFilteredColumn(sql, parameters);
        }

        if (metadata.type === 'array') {
            if (metadata.items.type !== 'object') {
                throw new InternalError('The "where" operator on an array field requires an array of objects.');
            }
            const itemMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.items.cls());
            const elementAlias: string = this.nextElementAlias();
            const innerSql: string = this.buildJsonbCondition(
                elementAlias,
                value as Where<Record<string, unknown>>,
                itemMeta,
                parameters,
                `${ALIAS}[]`
            );
            // guarded rather than left to jsonb_array_elements, which raises on a column holding the
            // json scalar null instead of returning the no rows it returns for an absent one
            const sql: string = `(${hasJsonValue(ALIAS)} AND EXISTS `
                + `(SELECT 1 FROM jsonb_array_elements(${ALIAS}) AS ${elementAlias} WHERE ${innerSql}))`;
            return this.rawOnFilteredColumn(sql, parameters);
        }

        // object property
        const nestedMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.cls());
        const sql: string = this.buildJsonbCondition(ALIAS, value as Where<Record<string, unknown>>, nestedMeta, parameters, ALIAS);
        // a question about a property of an object is not one a row without that object answers, so
        // the whole nested condition is false there rather than each part of it deciding separately.
        // Load bearing since `null` matches an absent key: without this, asking whether a reading's
        // value is null would be answered yes by every row that has no reading to have a value in
        return this.rawOnFilteredColumn(`(${hasJsonValue(ALIAS)} AND ${sql})`, parameters);
    }

    /**
     * Builds a raw operator from a statement that names the filtered column through ALIAS.
     *
     * The statement is assembled before typeorm says which column it is for, so the column is
     * substituted in afterwards. That is only safe because nothing a caller supplied is in the
     * statement to be substituted along with it - every such value is in `parameters`.
     * @param sql - The statement, with ALIAS standing in for the filtered column.
     * @param parameters - The values the statement binds.
     * @returns The typeorm operator.
     */
    private rawOnFilteredColumn(sql: string, parameters: TypeOrmParameters): FindOperator<unknown> {
        return Raw(alias => {
            const quotedAlias: string = alias.split('.').map(part => `"${part.replaceAll('"', '')}"`)
                .join('.');
            return sql.replaceAll(ALIAS, quotedAlias);
        }, parameters.values) as FindOperator<unknown>;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected buildOneOfOperator(filter: Record<string, unknown>, metadata: OneOfPropertyMetadata): FindOperator<unknown> {
        const parameters: TypeOrmParameters = this.createParameters();
        const sql: string = this.buildJsonbOneOfCondition(ALIAS, filter, metadata, parameters, ALIAS);
        return this.rawOnFilteredColumn(`(${hasJsonValue(ALIAS)} AND ${sql})`, parameters);
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
     * @throws When the filter names a shape the value cannot be, or asks for something no condition
     * on it can express.
     */
    private buildJsonbOneOfCondition(
        jsonPath: string,
        filter: unknown,
        metadata: Pick<OneOfPropertyMetadata, 'shapes'>,
        parameters: TypeOrmParameters,
        path: string
    ): string {
        if (Array.isArray(filter)) {
            return '(' + filter.map(f => this.buildJsonbOneOfCondition(jsonPath, f, metadata, parameters, path)).join(' OR ') + ')';
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
            const condition: string = this.buildJsonbFieldCondition(
                jsonPath,
                'value',
                shapeFilter,
                { ...shape },
                parameters,
                `${path}.${name}`
            );
            parts.push(`(${isShape} AND ${condition})`);
        }
        return parts.length ? `(${parts.join(' OR ')})` : 'FALSE';
    }

    private nextElementAlias(): string {
        return `zi_elem_${this.elementAliasIndex++}`;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected buildRelationLengthRawOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        lengthKey: string,
        value: number
    ): FindOperator<unknown> {
        const operator: string = this.lengthKeyToSqlOperator(lengthKey);

        if (metadata.type === RelationType.ONE_TO_MANY) {
            const targetEntity: Newable<BaseEntity> = metadata.target();
            const targetMeta: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(targetEntity);
            if (!targetMeta) {
                throw new EntityMetadataMissingError(targetEntity, `used in ${entityClass.name}.${propertyName}`);
            }
            const targetProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetEntity);
            const inverseProp: PropertyMetadata | undefined = targetProps[metadata.inverseSide];
            if (inverseProp?.type !== RelationType.MANY_TO_ONE) {
                throw new InternalError(`Could not find inverse many-to-one relation "${metadata.inverseSide}" on ${targetEntity.name}`);
            }
            const fkColumn: string | undefined = inverseProp.joinColumn;
            const rawSql: string = `(SELECT COUNT(*) FROM "${targetMeta.tableName}" `
                + `WHERE "${targetMeta.tableName}"."${fkColumn}" = $alias$) ${operator} ${value}`;
            return Raw(alias => rawSql.replaceAll('$alias$', alias));
        }

        // MANY_TO_MANY
        const ormRelation: ToRelationMetadata | undefined = this.typeOrmDataSource
            .getMetadata(entityClass)
            .findRelationWithPropertyPath(propertyName);
        const ownColumn: ToColumnMetadata | undefined = ormRelation?.junctionEntityMetadata?.columns[0];
        if (ormRelation?.isManyToMany !== true || !ormRelation.junctionEntityMetadata || ownColumn == undefined) {
            throw new InternalError(`Could not resolve many-to-many relation metadata for ${entityClass.name}.${propertyName}`);
        }
        const junctionTable: string = ormRelation.junctionEntityMetadata.tableName;
        const ownFkColumn: string = ownColumn.databaseName;
        const rawSql: string = `(SELECT COUNT(*) FROM "${junctionTable}" `
            + `WHERE "${junctionTable}"."${ownFkColumn}" = $alias$) ${operator} ${value}`;
        return Raw(alias => rawSql.replaceAll('$alias$', alias));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected buildRelationIncludesOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        entities: BaseEntity[]
    ): FindOperator<unknown> {
        if (entities.length === 0) {
            return Raw(() => 'TRUE');
        }

        const parameters: TypeOrmParameters = this.createParameters();

        if (metadata.type === RelationType.ONE_TO_MANY) {
            const targetEntity: Newable<BaseEntity> = metadata.target();
            const targetMeta: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(targetEntity);
            if (!targetMeta) {
                throw new EntityMetadataMissingError(targetEntity, `used in ${entityClass.name}.${propertyName}`);
            }
            const targetProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetEntity);
            const inverseProp: PropertyMetadata | undefined = targetProps[metadata.inverseSide];
            if (inverseProp?.type !== RelationType.MANY_TO_ONE) {
                throw new InternalError(`Could not find inverse many-to-one relation "${metadata.inverseSide}" on ${targetEntity.name}`);
            }
            const fkColumn: string | undefined = inverseProp.joinColumn;
            const ids: string = this.idParameters(entities, parameters);
            const rawSql: string = `(SELECT COUNT(*) FROM "${targetMeta.tableName}" `
                + `WHERE "${targetMeta.tableName}"."${fkColumn}" = $alias$ `
                + `AND "${targetMeta.tableName}"."id" = ANY(${ids})) = ${entities.length}`;
            return this.rawOnRelation(rawSql, parameters);
        }

        // MANY_TO_MANY
        const ormRelation: ToRelationMetadata | undefined = this.typeOrmDataSource
            .getMetadata(entityClass)
            .findRelationWithPropertyPath(propertyName);
        const ownColumn: ToColumnMetadata | undefined = ormRelation?.junctionEntityMetadata?.columns[0];
        const targetColumn: ToColumnMetadata | undefined = ormRelation?.junctionEntityMetadata?.columns[1];
        if (
            ormRelation?.isManyToMany !== true
            || !ormRelation.junctionEntityMetadata
            || ownColumn == undefined
            || targetColumn == undefined
        ) {
            throw new InternalError(`Could not resolve many-to-many relation metadata for ${entityClass.name}.${propertyName}`);
        }
        const junctionTable: string = ormRelation.junctionEntityMetadata.tableName;
        const ownFkColumn: string = ownColumn.databaseName;
        const targetFkColumn: string = targetColumn.databaseName;
        const ids: string = this.idParameters(entities, parameters);
        const rawSql: string = `(SELECT COUNT(*) FROM "${junctionTable}" `
            + `WHERE "${junctionTable}"."${ownFkColumn}" = $alias$ `
            + `AND "${junctionTable}"."${targetFkColumn}" = ANY(${ids})) = ${entities.length}`;
        return this.rawOnRelation(rawSql, parameters);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    protected buildRelationIsIncludedInOperator<T>(
        entityClass: Newable<T>,
        propertyName: string,
        metadata: RelationMetadata<BaseEntity>,
        entities: BaseEntity[]
    ): FindOperator<unknown> {
        // a row has to have related rows, and all of them allowed, so allowing none is allowing no row
        if (entities.length === 0) {
            return Raw(() => 'FALSE');
        }

        const parameters: TypeOrmParameters = this.createParameters();

        if (metadata.type === RelationType.ONE_TO_MANY) {
            const targetEntity: Newable<BaseEntity> = metadata.target();
            const targetMeta: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(targetEntity);
            if (!targetMeta) {
                throw new EntityMetadataMissingError(targetEntity, `used in ${entityClass.name}.${propertyName}`);
            }
            const targetProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetEntity);
            const inverseProp: PropertyMetadata | undefined = targetProps[metadata.inverseSide];
            if (inverseProp?.type !== RelationType.MANY_TO_ONE || !inverseProp.joinColumn) {
                throw new InternalError(`Could not find inverse many-to-one relation "${metadata.inverseSide}" on ${targetEntity.name}`);
            }
            const fkColumn: string = inverseProp.joinColumn;
            const ids: string = this.idParameters(entities, parameters);
            // the EXISTS is what leaves out a row without related rows, which is asked for with a
            // length of 0 alone
            const rawSql: string = `EXISTS (SELECT 1 FROM "${targetMeta.tableName}" `
                + `WHERE "${targetMeta.tableName}"."${fkColumn}" = $alias$) `
                + `AND NOT EXISTS (SELECT 1 FROM "${targetMeta.tableName}" `
                + `WHERE "${targetMeta.tableName}"."${fkColumn}" = $alias$ `
                + `AND "${targetMeta.tableName}"."id" <> ALL(${ids}))`;
            return this.rawOnRelation(rawSql, parameters);
        }

        // MANY_TO_MANY
        const ormRelation: ToRelationMetadata | undefined = this.typeOrmDataSource
            .getMetadata(entityClass)
            .findRelationWithPropertyPath(propertyName);
        const ownColumn: ToColumnMetadata | undefined = ormRelation?.junctionEntityMetadata?.columns[0];
        const targetColumn: ToColumnMetadata | undefined = ormRelation?.junctionEntityMetadata?.columns[1];
        if (
            ormRelation?.isManyToMany !== true
            || !ormRelation.junctionEntityMetadata
            || ownColumn == undefined
            || targetColumn == undefined
        ) {
            throw new InternalError(`Could not resolve many-to-many relation metadata for ${entityClass.name}.${propertyName}`);
        }
        const junctionTable: string = ormRelation.junctionEntityMetadata.tableName;
        const ownFkColumn: string = ownColumn.databaseName;
        const targetFkColumn: string = targetColumn.databaseName;
        const ids: string = this.idParameters(entities, parameters);
        const rawSql: string = `EXISTS (SELECT 1 FROM "${junctionTable}" `
            + `WHERE "${junctionTable}"."${ownFkColumn}" = $alias$) `
            + `AND NOT EXISTS (SELECT 1 FROM "${junctionTable}" `
            + `WHERE "${junctionTable}"."${ownFkColumn}" = $alias$ `
            + `AND "${junctionTable}"."${targetFkColumn}" <> ALL(${ids}))`;
        return this.rawOnRelation(rawSql, parameters);
    }

    /**
     * Builds a raw operator from a relation statement that names the filtered column through $alias$.
     *
     * Same reasoning as rawOnFilteredColumn: substituting the column into the finished statement is
     * only safe while the statement holds no value a caller supplied, which is what parameters is for.
     * @param sql - The statement, with $alias$ standing in for the filtered column.
     * @param parameters - The values the statement binds.
     * @returns The typeorm operator.
     */
    private rawOnRelation(sql: string, parameters: TypeOrmParameters): FindOperator<unknown> {
        return Raw(alias => sql.replaceAll('$alias$', alias), parameters.values);
    }

    private idParameters(entities: BaseEntity[], parameters: TypeOrmParameters): string {
        return parameters.addList(entities.map(e => e.id));
    }

    // ── JSONB SQL generation (moved from PostgresDataSource) ────

    private buildJsonbCondition(
        jsonbAlias: string,
        whereFilter: Where<Record<string, unknown>>,
        propertyMetadataMap: Record<string, PropertyMetadata>,
        parameters: TypeOrmParameters,
        path: string
    ): string {
        if (Array.isArray(whereFilter)) {
            return '(' + whereFilter
                .map(f => `(${this.buildJsonbCondition(jsonbAlias, f, propertyMetadataMap, parameters, path)})`)
                .join(' OR ') + ')';
        }

        const andParts: string[] = [];
        for (const [key, filterValue] of ObjectUtilities.entries(whereFilter)) {
            const propMeta: PropertyMetadata | undefined = propertyMetadataMap[key];
            andParts.push(this.buildJsonbFieldCondition(jsonbAlias, key, filterValue, propMeta, parameters, path));
        }
        return andParts.length ? andParts.join(' AND ') : 'TRUE';
    }

    private buildJsonbWhereCondition(
        jsonPath: string,
        val: unknown,
        propMeta: PropertyMetadata | undefined,
        fieldKey: string,
        parameters: TypeOrmParameters,
        path: string
    ): string {
        if (propMeta?.type === 'object') {
            // guarded the same way the column itself is: an object that is not there answers nothing
            // about the properties it would have had
            return `(${hasJsonValue(jsonPath)} AND ${this.buildJsonbCondition(
                jsonPath,
                val as Where<Record<string, unknown>>,
                MetadataUtilities.getModelProperties(propMeta.cls()),
                parameters,
                path
            )})`;
        }
        if (propMeta?.type === 'array' && propMeta.items.type === 'oneOf') {
            const elementAlias: string = this.nextElementAlias();
            return `(${hasJsonValue(jsonPath)} AND EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonPath}) AS ${elementAlias} WHERE `
                + this.buildJsonbOneOfCondition(elementAlias, val, propMeta.items, parameters, `${path}[]`) + '))';
        }
        if (propMeta?.type === 'array') {
            if (propMeta.items.type !== 'object') {
                throw new InternalError(`"where" on array field "${fieldKey}" requires object items`);
            }
            const itemMeta: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(propMeta.items.cls());
            const elementAlias: string = this.nextElementAlias();
            return `(${hasJsonValue(jsonPath)} AND EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonPath}) AS ${elementAlias} WHERE `
                + this.buildJsonbCondition(elementAlias, val as Where<Record<string, unknown>>, itemMeta, parameters, `${path}[]`) + '))';
        }
        throw new InternalError(`"where" operator used on a non-object, non-array JSONB field "${fieldKey}"`);
    }

    private buildJsonbFieldCondition(
        jsonbAlias: string,
        fieldKey: string,
        filterValue: unknown,
        propMeta: PropertyMetadata | undefined,
        parameters: TypeOrmParameters,
        parentPath: string
    ): string {
        // Guard against relations inside JSONB
        if (propMeta && (
            propMeta.type === RelationType.HAS_ONE
            || propMeta.type === RelationType.BELONGS_TO_ONE
            || propMeta.type === RelationType.MANY_TO_ONE
            || propMeta.type === RelationType.ONE_TO_MANY
            || propMeta.type === RelationType.MANY_TO_MANY
        )) {
            throw new InternalError(`Cannot filter on relation "${fieldKey}" inside a JSONB column. `
                + 'Relations are not supported as part of embedded JSON objects/arrays.');
        }

        // the field name is bound as well, not just the values. A json key is not a sql identifier
        // and does not have to be spellable as one, so there is nothing to escape it as.
        const key: string = `${parameters.add(fieldKey)}::text`;
        const jsonPath: string = `(${jsonbAlias}->${key})`;
        const textPath: string = `(${jsonbAlias}->>${key})`;
        const path: string = `${parentPath}.${fieldKey}`;
        const castPath: string = `${textPath}${this.getJsonbCast(propMeta, path)}`;

        if (filterValue === null) {
            return `NOT ${hasJsonValue(jsonPath)}`;
        }

        if (propMeta?.type === 'oneOf') {
            return `(${hasJsonValue(jsonPath)} AND ${this.buildJsonbOneOfCondition(jsonPath, filterValue, propMeta, parameters, path)})`;
        }

        if (typeof filterValue === 'string' || typeof filterValue === 'number'
            || typeof filterValue === 'boolean' || filterValue instanceof Date) {
            return `${castPath} = ${parameters.add(filterValue)}`;
        }

        if (Array.isArray(filterValue)) {
            // exact array match
            const array: string = this.toJsonbParameter(filterValue, parameters);
            return `(${jsonPath} @> ${array} AND ${jsonPath} <@ ${array})`;
        }

        if (typeof filterValue !== 'object') {
            throw new InternalError(`Unexpected JSONB filter value for field "${fieldKey}": ${JsonUtilities.stringify(filterValue)}`);
        }

        return this.buildJsonbOperatorCondition(filterValue, { jsonPath, textPath, castPath, fieldKey, path, propMeta, parameters });
    }

    private buildJsonbOperatorCondition(
        filterValue: object,
        context: OmitStrict<JsonbOperatorContext, 'value'>
    ): string {
        const filterObj: Record<string, unknown> = filterValue as Record<string, unknown>;
        const conditions: string[] = [];

        for (const [op, value] of ObjectUtilities.entries(filterObj)) {
            const handler: JsonbOperatorHandler | undefined = this.jsonbOperatorHandlers[op as WhereFilterKeys];
            if (handler == undefined) {
                throw new InternalError(`Unknown JSONB filter operator "${op}" on field "${context.fieldKey}"`);
            }
            // a key taking several values becomes one condition per value, joined by the AND below
            for (const one of this.everyOf(op as WhereFilterKeys, value)) {
                conditions.push(handler({ ...context, value: one }));
            }
        }

        return conditions.length ? conditions.join(' AND ') : 'TRUE';
    }

    private toJsonbParameter(val: object, parameters: TypeOrmParameters): string {
        return `${parameters.add(JsonUtilities.stringify(val))}::jsonb`;
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
            case 'string':
            case 'object':
            case RelationType.HAS_ONE:
            case RelationType.BELONGS_TO_ONE:
            case RelationType.ONE_TO_MANY:
            case RelationType.MANY_TO_ONE:
            case RelationType.MANY_TO_MANY:
            case 'array':
            case 'file':
            case 'unknown':
            // no one type to cast as when the value can be one of several
            case 'oneOf': {
                return '';
            }
        }
    }

    private lengthKeyToSqlOperator(lengthKey: string): string {
        switch (lengthKey) {
            case 'length': {
                return '=';
            }
            case 'lengthGreaterThan': {
                return '>';
            }
            case 'lengthGreaterThanEquals': {
                return '>=';
            }
            case 'lengthLesserThan': {
                return '<';
            }
            case 'lengthLesserThanEquals': {
                return '<=';
            }
            default: {
                throw new InternalError(`Unknown length filter key: ${lengthKey}`);
            }
        }
    }
}