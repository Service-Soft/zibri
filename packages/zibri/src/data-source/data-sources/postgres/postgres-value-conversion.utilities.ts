import { PostgresColumnSql } from './postgres-column-sql.model';
import { NumberFormat, NumberPropertyMetadata } from '../../../entity/models/number-property-metadata.model';
import { StoredStringPropertyMetadata } from '../../../entity/models/string-property-metadata.model';
import { INTEGER_REGEX } from '../../../parsing/functions/parse-number.function';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { UUID_REGEX } from '../../../validation/functions/validate-string.function';
import { literalToSql } from '../../literal-to-sql.function';
import { ConversionRefusal } from '../../models/conversion-refusal.enum';
import { ResolvedPropertyConversion } from '../../models/resolved-property-conversion.model';
import { ValueConversion } from '../../models/value-conversion.enum';
import { ValueConversionUtilities } from '../../value-conversion.utilities';

/**
 * A string property of any kind, which is all a conversion reads of one.
 */
type AnyStringPropertyMetadata = StoredStringPropertyMetadata;

/**
 * The largest finite magnitude a double holds. Text past it is asked about before it is read,
 * because postgres fails the whole statement on such text rather than answering whether it fits.
 */
const LARGEST_DOUBLE: string = '1.7976931348623157e308';

/**
 * The smallest magnitude above zero a double holds, for the same reason.
 */
const SMALLEST_DOUBLE: string = '4.9406564584124654e-324';

/**
 * Writes the conversion of a property change as sql, converting exactly as
 * {@link ValueConversionUtilities} does for a store that keeps json.
 *
 * Every statement here reads a double as text, which is only the shortest text that reads back as
 * the same double once `extra_float_digits` is at least 1 - so the queries using them set it first.
 */
export abstract class PostgresValueConversionUtilities {

    /**
     * Resolves the query for the values a change cannot convert.
     * @param table - The table, quoted.
     * @param current - The column as it is stored now.
     * @param changed - The column as it is to be stored.
     * @param conversion - The change.
     * @returns A query answering each distinct refused value and why, as `value` and `refusal`. Undefined
     * when the change cannot refuse anything, so that nothing has to read the table.
     */
    static resolveRefusalsQuery(
        table: string,
        current: PostgresColumnSql,
        changed: PostgresColumnSql,
        conversion: ResolvedPropertyConversion
    ): string | undefined {
        const refusals: string[] = [];
        if (conversion.default === ValueConversion.NONE) {
            refusals.push(`ELSE '${ConversionRefusal.NOT_LISTED}'`);
        }
        else {
            // the column itself says whether a value can be missing now, which is what a property
            // added and not yet made required is
            if (!changed.stored.isNullable && current.stored.isNullable) {
                refusals.push(`WHEN ${current.name} IS NULL THEN '${ConversionRefusal.MISSING}'`);
            }
            const fits: string | undefined = this.findFitsSql(current, conversion);
            if (fits != undefined) {
                refusals.push(`WHEN ${current.name} IS NOT NULL AND NOT (${fits}) THEN '${ConversionRefusal.DOES_NOT_FIT}'`);
            }
        }
        if (!refusals.length) {
            return undefined;
        }
        // a listed value first, which the change converts whatever a cast would make of it
        const listed: string[] = conversion.values.length ? [`WHEN ${this.resolveListedSql(current, conversion)} THEN NULL`] : [];
        return `SELECT DISTINCT value, refusal FROM (SELECT ${current.name} AS value, CASE ${[...listed, ...refusals].join(' ')} END`
            + ` AS refusal FROM ${table}) AS converted WHERE refusal IS NOT NULL`;
    }

    /**
     * Resolves what each stored value becomes, as the expression of an `ALTER COLUMN ... USING`.
     * @param current - The column as it is stored now.
     * @param changed - The column as it is to be stored.
     * @param conversion - The change.
     * @returns The expression.
     */
    static resolveConvertedSql(current: PostgresColumnSql, changed: PostgresColumnSql, conversion: ResolvedPropertyConversion): string {
        const otherwise: string = conversion.default === ValueConversion.CAST
            ? this.resolveCastSql(current, changed, conversion)
            // every value is listed by now, which the refusals made sure of
            : `CAST(NULL AS ${changed.type})`;
        const branches: string[] = conversion.values
            .map(v => `WHEN ${current.name} IS NOT DISTINCT FROM ${this.literalOf(v.from, current)} THEN ${this.literalOf(v.to, changed)}`);
        return branches.length ? `CASE ${branches.join(' ')} ELSE ${otherwise} END` : otherwise;
    }

    /**
     * The condition that a stored value is one the change lists.
     * @param current - The column as it is stored now.
     * @param conversion - The change.
     * @returns The condition.
     */
    private static resolveListedSql(current: PostgresColumnSql, conversion: ResolvedPropertyConversion): string {
        // IS NOT DISTINCT FROM rather than =, so that null can be listed like any other value
        return conversion.values.map(v => `${current.name} IS NOT DISTINCT FROM ${this.literalOf(v.from, current)}`).join(' OR ');
    }

    /**
     * The cast of a value that is there.
     * @param current - The column as it is stored now.
     * @param changed - The column as it is to be stored.
     * @param conversion - The change.
     * @returns The expression.
     */
    private static resolveCastSql(current: PostgresColumnSql, changed: PostgresColumnSql, conversion: ResolvedPropertyConversion): string {
        const { current: from, changed: into } = conversion;
        if (from.type === 'number' && into.type === 'string') {
            return `CAST(${this.numberAsTextSql(current.name, from.format)} AS ${changed.type})`;
        }
        // through its text, because postgres turns a double into a numeric by fifteen digits rather
        // than by the decimal it stands for
        if (from.type === 'number' && from.format === 'number' && into.type === 'number' && into.format === 'bignumber') {
            return `CAST(CAST(${current.name} AS text) AS ${changed.type})`;
        }
        return `CAST(${current.name} AS ${changed.type})`;
    }

    /**
     * The condition that a stored value that is there is the same value cast.
     * @param current - The column as it is stored now.
     * @param conversion - The change.
     * @returns The condition, or undefined when every value fits.
     */
    private static findFitsSql(current: PostgresColumnSql, conversion: ResolvedPropertyConversion): string | undefined {
        const { current: from, changed: into } = conversion;
        if (into.type === 'number') {
            return this.findNumberFitsSql(current, from, into);
        }
        if (into.type === 'string') {
            if (from.type === 'number') {
                return this.stringFitsSql(this.numberAsTextSql(current.name, from.format), into);
            }
            return from.type === 'string' && this.isNoStricterThan(into, from)
                ? undefined
                : this.stringFitsSql(`CAST(${current.name} AS text)`, into);
        }
        return undefined;
    }

    /**
     * The condition that a stored value that is there is the same value cast into a number.
     * @param current - The column as it is stored now.
     * @param from - The property as it is stored now.
     * @param into - The number property it is cast into.
     * @returns The condition, or undefined when every value fits.
     */
    private static findNumberFitsSql(
        current: PostgresColumnSql,
        from: ResolvedPropertyConversion['current'],
        into: NumberPropertyMetadata
    ): string | undefined {
        if (from.type === 'number') {
            const decimal: string = from.format === 'number'
                ? `CAST(CAST(${current.name} AS text) AS numeric)`
                : `CAST(${current.name} AS numeric)`;
            return from.format === into.format && into.enum == undefined ? undefined : this.numberFitsSql(decimal, into);
        }
        const pattern: RegExp = into.format === 'integer' || into.format === 'bigint'
            ? INTEGER_REGEX
            : ValueConversionUtilities.DECIMAL_REGEX;
        const fits: string = this.numberFitsSql(`CAST(${current.name} AS numeric)`, into);
        return `CASE WHEN ${current.name} ~ ${literalToSql(pattern.source)} THEN ${fits} ELSE FALSE END`;
    }

    /**
     * The condition that an exact decimal is a number of the given property.
     * @param decimal - The decimal, as a numeric expression.
     * @param into - The property.
     * @returns The condition.
     */
    private static numberFitsSql(decimal: string, into: NumberPropertyMetadata): string {
        const finite: string = `${decimal} NOT IN ('NaN', 'Infinity', '-Infinity')`;
        const whole: string = `trunc(${decimal}) = ${decimal}`;
        // the same decimal back from the double, inside the range a double reads at all
        const double: string = `CASE WHEN ${finite} AND abs(${decimal}) <= ${LARGEST_DOUBLE}`
            + ` AND (${decimal} = 0 OR abs(${decimal}) >= ${SMALLEST_DOUBLE})`
            + ` THEN CAST(CAST(CAST(${decimal} AS double precision) AS text) AS numeric) = ${decimal} ELSE FALSE END`;
        const conditions: string[] = [];
        switch (into.format) {
            case 'integer': {
                conditions.push(finite, whole, `abs(${decimal}) <= ${Number.MAX_SAFE_INTEGER}`);
                break;
            }
            case 'number': {
                conditions.push(double);
                break;
            }
            case 'bigint': {
                conditions.push(finite, whole);
                break;
            }
            case 'bignumber': {
                conditions.push(finite);
                break;
            }
        }
        if (into.enum != undefined) {
            conditions.push(`${decimal} IN (${this.listSql(ObjectUtilities.values(into.enum))})`);
        }
        return conditions.join(' AND ');
    }

    /**
     * The condition that a text can be held by the given string property.
     * @param text - The text, as an expression.
     * @param into - The property.
     * @returns The condition, or undefined when any text can.
     */
    private static stringFitsSql(text: string, into: AnyStringPropertyMetadata): string | undefined {
        const conditions: string[] = [];
        if (this.isUuid(into)) {
            conditions.push(`${text} ~ ${literalToSql(UUID_REGEX.source)}`);
        }
        if (into.enum != undefined) {
            conditions.push(`${text} IN (${this.listSql(ObjectUtilities.values(into.enum))})`);
        }
        if (into.maxLength != undefined) {
            conditions.push(`char_length(${text}) <= ${into.maxLength}`);
        }
        return conditions.length ? conditions.join(' AND ') : undefined;
    }

    /**
     * Whether every text one string property can hold, another one can hold too.
     * @param into - The property the text is to be held by.
     * @param from - The property holding it now.
     * @returns True when the one asks nothing of a text that the other does not already.
     */
    private static isNoStricterThan(into: AnyStringPropertyMetadata, from: AnyStringPropertyMetadata): boolean {
        const intoEnum: unknown[] | undefined = into.enum == undefined ? undefined : ObjectUtilities.values(into.enum);
        const fromEnum: unknown[] | undefined = from.enum == undefined ? undefined : ObjectUtilities.values(from.enum);
        return (!this.isUuid(into) || this.isUuid(from))
            && (intoEnum == undefined || (fromEnum?.every(v => intoEnum.includes(v)) ?? false))
            && (into.maxLength == undefined || (from.maxLength != undefined && from.maxLength <= into.maxLength));
    }

    /**
     * Whether a string property holds uuids, which is what postgres stores in a column of its own type.
     * @param metadata - The property.
     * @returns True for a uuid format, and for a primary key.
     */
    private static isUuid(metadata: AnyStringPropertyMetadata): boolean {
        return metadata.format === 'uuid' || metadata.primary;
    }

    /**
     * Writes values as the list of an `IN`.
     * @param values - The values.
     * @returns The literals, separated by commas.
     */
    private static listSql(values: unknown[]): string {
        return values.map(v => literalToSql(v)).join(', ');
    }

    /**
     * A number as the text a cast makes of it.
     * @param column - The column, quoted.
     * @param format - The format of the number.
     * @returns A text expression: a double as javascript writes it, every other format in decimal digits.
     */
    private static numberAsTextSql(column: string, format: NumberFormat): string {
        switch (format) {
            case 'integer':
            case 'bigint': {
                return `CAST(${column} AS text)`;
            }
            case 'bignumber': {
                return `CAST(trim_scale(${column}) AS text)`;
            }
            case 'number': {
                // postgres writes the same shortest digits as javascript, but switches to an exponent
                // sooner and writes it with at least two digits. Where javascript writes digits
                // only, the exponent is read back as a numeric, which writes digits only too
                return `CASE WHEN ${column} = 0 THEN '0'`
                    + ` WHEN abs(${column}) >= 1e21 OR abs(${column}) < 1e-6`
                    + ` THEN regexp_replace(CAST(${column} AS text), 'e([+-])0*([0-9])', 'e\\1\\2')`
                    + ` ELSE CAST(CAST(CAST(${column} AS text) AS numeric) AS text) END`;
            }
        }
    }

    /**
     * Writes a value, in the form it is stored as json, as a value of a column.
     * @param value - The value.
     * @param column - The column.
     * @returns The literal, cast to the column's type.
     */
    private static literalOf(value: unknown, column: PostgresColumnSql): string {
        if (value === null) {
            return `CAST(NULL AS ${column.type})`;
        }
        if (column.stored.isArray) {
            // each item as the text json holds it, which postgres reads into the array's items
            return `CAST(ARRAY(SELECT item FROM jsonb_array_elements_text(CAST(${literalToSql(JsonUtilities.stringify(value))} AS jsonb))`
                + ` WITH ORDINALITY AS items(item, position) ORDER BY position) AS ${column.type})`;
        }
        if (column.stored.type === 'jsonb') {
            return `CAST(${literalToSql(JsonUtilities.stringify(value))} AS jsonb)`;
        }
        return `CAST(${literalToSql(value)} AS ${column.type})`;
    }
}