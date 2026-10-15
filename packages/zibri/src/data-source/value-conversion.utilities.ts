import { MigratedEntityUtilities } from './migration/migrated-entity.utilities';
import { ChangePropertyOfEntityInput } from './models/change-property-of-entity-input.model';
import { ConversionRefusal } from './models/conversion-refusal.enum';
import { ConvertedValue } from './models/converted-value.model';
import { MigrationPropertyMetadata } from './models/migration-property-metadata.model';
import { RefusedValue } from './models/refused-value.model';
import { ResolvedPropertyConversion } from './models/resolved-property-conversion.model';
import { ValueConversion } from './models/value-conversion.enum';
import { BaseEntity } from '../entity/base-entity.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { NumberFormat, NumberPropertyMetadata } from '../entity/models/number-property-metadata.model';
import { Relation } from '../entity/models/relation.enum';
import { StoredStringPropertyMetadata } from '../entity/models/string-property-metadata.model';
import { InternalError } from '../error-handling/internal-error.model';
import { INTEGER_REGEX } from '../parsing/functions/parse-number.function';
import { toJsonValue } from '../parsing/functions/to-json-value.function';
import { JsonUtilities } from '../utilities/json.utilities';
import { BigNumber } from '../utilities/number.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { UUID_REGEX } from '../validation/functions/validate-string.function';

/**
 * What a property change does to the values it converts, whichever data source stores them.
 *
 * A cast keeps a value or refuses it, and never stores something else in its place: a number becomes
 * the text it is written as and that text the same number again, a number narrowed into another
 * format has to be the same number in it, and a string has to satisfy what the new property says
 * about its length, its enum and whether it is a uuid.
 */
export abstract class ValueConversionUtilities {

    /**
     * Regex that matches a number written out as decimal text, which is what a cast reads into any
     * number but a whole one.
     */
    static readonly DECIMAL_REGEX: RegExp = /^-?(0|[1-9]\d*)(\.\d+)?([Ee][+-]?\d+)?$/;

    /**
     * Resolves what a migration says about a property change, and checks that it can be done at all.
     * @param input - What the migration says.
     * @returns The change, with both properties resolved and the listed values in the form they are
     * stored as json.
     * @throws When it casts between two types that have no cast, or lists a value the new property
     * cannot hold.
     */
    static resolveConversion<T extends BaseEntity, C extends MigrationPropertyMetadata, M extends MigrationPropertyMetadata>(
        input: ChangePropertyOfEntityInput<T, C, M>
    ): ResolvedPropertyConversion {
        const res: ResolvedPropertyConversion = {
            entity: input.entity.name,
            currentName: String(input.currentProperty.name),
            current: MigratedEntityUtilities.resolvePropertyMetadata(input.currentProperty),
            changedName: String(input.property.name),
            changed: MigratedEntityUtilities.resolvePropertyMetadata(input.property),
            values: (input.convert?.values ?? []).map(v => ({ from: toJsonValue(v.from), to: toJsonValue(v.to) })),
            default: input.convert?.default ?? ValueConversion.CAST
        };
        // typed away already, but a migration typed against a wider type gets here all the same
        if (res.default === ValueConversion.CAST && !this.isCastable(res.current, res.changed)) {
            throw new InternalError(
                `Cannot change ${res.entity}.${res.currentName}, because ${this.describe(res.current)} has no cast into`
                + ` ${this.describe(res.changed)}. List the values it holds, with ValueConversion.NONE.`
            );
        }
        // checked as a cast of the new property into itself, which is the same test a stored value passes
        const unfit: RefusedValue[] = res.values.flatMap(v => {
            const converted: ConvertedValue | RefusedValue = this.resolveCastValue(v.to, res.changed, res.changed);
            return 'refusal' in converted ? [converted] : [];
        });
        if (unfit.length) {
            throw new InternalError(
                `Cannot change ${res.entity}.${res.currentName}, because the conversion lists values it cannot hold:`
                + this.listRefusals(res, unfit)
            );
        }
        return res;
    }

    /**
     * Converts one value of a data source that stores each value as json.
     * @param stored - The value as it is stored, parsed from json. Null when nothing is stored.
     * @param conversion - The change.
     * @returns The value to store instead, or why it cannot be converted.
     */
    static resolveConvertedValue(stored: unknown, conversion: ResolvedPropertyConversion): ConvertedValue | RefusedValue {
        if (!this.isStoredAs(stored, conversion.current)) {
            return { value: stored, refusal: ConversionRefusal.NOT_CURRENT };
        }
        const listed: ResolvedPropertyConversion['values'][number] | undefined = conversion.values
            .find(v => this.isSameValue(v.from, stored));
        if (listed != undefined) {
            return { value: listed.to };
        }
        switch (conversion.default) {
            case ValueConversion.NONE: {
                return { value: stored, refusal: ConversionRefusal.NOT_LISTED };
            }
            case ValueConversion.CAST: {
                return this.resolveCastValue(stored, conversion.current, conversion.changed);
            }
        }
    }

    /**
     * Validates that a change converts every stored value.
     * @param conversion - The change.
     * @param refused - The stored values it cannot convert.
     * @throws Naming each value it cannot convert, and why.
     */
    static validateNothingRefused(conversion: ResolvedPropertyConversion, refused: RefusedValue[]): void {
        if (refused.length) {
            throw new InternalError(
                `Cannot change ${conversion.entity}.${conversion.currentName}, because it holds values that cannot be converted:`
                + this.listRefusals(conversion, refused)
            );
        }
    }

    /**
     * Whether a property's values can be cast into another's.
     * @param current - The property as it is stored now.
     * @param changed - The property as it is stored from now on.
     * @returns True for two properties of the same type, and for a number and a string either way. Two
     * arrays only when their items are the same.
     */
    private static isCastable(current: PropertyMetadata, changed: PropertyMetadata): boolean {
        if (current.type === 'array' && changed.type === 'array') {
            return current.items.type === changed.items.type
                && this.formatOf(current.items) === this.formatOf(changed.items);
        }
        if (current.type === changed.type) {
            return true;
        }
        return (current.type === 'number' || current.type === 'string') && (changed.type === 'number' || changed.type === 'string');
    }

    /**
     * Casts one value, which may be null.
     * @param value - The value, in the form it is stored as json.
     * @param from - The property the value is a value of.
     * @param into - The property to cast it into.
     * @returns The value cast, or why it cannot be.
     */
    private static resolveCastValue(value: unknown, from: PropertyMetadata, into: PropertyMetadata): ConvertedValue | RefusedValue {
        if (value === null) {
            // required unless it says otherwise, the way the decorator reads it - a property that is
            // required only sometimes is one whose column takes no value at all
            return into.required === true ? { value, refusal: ConversionRefusal.MISSING } : { value };
        }
        return this.findCast(value, from, into) ?? { value, refusal: ConversionRefusal.DOES_NOT_FIT };
    }

    /**
     * Casts a value that is there.
     * @param value - The value, in the form it is stored as json.
     * @param from - The property the value is a value of.
     * @param into - The property to cast it into.
     * @returns The value cast, or undefined when it would not be the same value afterwards.
     */
    private static findCast(value: unknown, from: PropertyMetadata, into: PropertyMetadata): ConvertedValue | undefined {
        if (into.type === 'number') {
            const decimal: BigNumber | undefined = this.findDecimal(value, from, into.format);
            return decimal == undefined ? undefined : this.findNumber(decimal, into);
        }
        if (into.type === 'string') {
            const text: unknown = from.type === 'number' ? this.textOfNumber(value, from.format) : value;
            return typeof text === 'string' && this.fitsString(text, into) ? { value: text } : undefined;
        }
        // a cast between two properties of the same type, which keeps what the value is
        return { value };
    }

    /**
     * Reads a value as the exact decimal it stands for.
     * @param value - The value, in the form it is stored as json.
     * @param from - The property the value is a value of.
     * @param format - The format of the number it is cast into, which decides what text reads as one.
     * @returns The decimal, or undefined for text that is not a number written out.
     */
    private static findDecimal(value: unknown, from: PropertyMetadata, format: NumberFormat): BigNumber | undefined {
        if (from.type === 'number') {
            // a double as the shortest text that reads back as it, which is the decimal it stands for
            // everywhere a number is written down

            return new BigNumber(String(value));
        }
        const pattern: RegExp = format === 'integer' || format === 'bigint' ? INTEGER_REGEX : this.DECIMAL_REGEX;
        return typeof value === 'string' && pattern.test(value) ? new BigNumber(value) : undefined;
    }

    /**
     * Stores an exact decimal as a number of the given property.
     * @param decimal - The decimal.
     * @param into - The property.
     * @returns The number in the form it is stored as json, or undefined when the property cannot
     * hold that exact number.
     */
    private static findNumber(decimal: BigNumber, into: NumberPropertyMetadata): ConvertedValue | undefined {
        if (into.enum != undefined && !ObjectUtilities.values(into.enum).includes(decimal.toNumber())) {
            return undefined;
        }
        switch (into.format) {
            case 'integer':
            case 'number': {
                const res: number = decimal.toNumber();
                // the same decimal back, which a double too large, too small or too precise is not
                const isSame: boolean = new BigNumber(String(res)).isEqualTo(decimal);
                return isSame && (into.format === 'number' || Number.isInteger(res)) ? { value: res } : undefined;
            }
            case 'bigint': {
                return decimal.isInteger() ? { value: decimal.toFixed() } : undefined;
            }
            case 'bignumber': {
                return decimal.isFinite() ? { value: decimal.toFixed() } : undefined;
            }
        }
    }

    /**
     * Writes a number as text.
     * @param value - The number, in the form it is stored as json.
     * @param format - The format of the number.
     * @returns The text: a double as javascript writes it, every other format in decimal digits.
     */
    private static textOfNumber(value: unknown, format: NumberFormat): string {

        const text: string = String(value);
        return format === 'bignumber' ? new BigNumber(text).toFixed() : text;
    }

    /**
     * Whether a string property can hold a text.
     * @param text - The text.
     * @param into - The property.
     * @returns True when the text is a uuid if it has to be one, one of the enum if there is one, and
     * no longer than the property's length.
     */
    private static fitsString(text: string, into: StoredStringPropertyMetadata): boolean {
        if ((into.format === 'uuid' || into.primary) && !UUID_REGEX.test(text)) {
            return false;
        }
        if (into.enum != undefined && !ObjectUtilities.values(into.enum).includes(text)) {
            return false;
        }
        // in characters rather than utf-16 code units, which is what a length of text counts in a
        // database too
        return into.maxLength == undefined || [...text].length <= into.maxLength;
    }

    /**
     * Whether a value is one of the given property, as it is stored as json.
     * @param value - The value, parsed from json.
     * @param metadata - The property.
     * @returns Whether the property could have stored the value.
     */
    private static isStoredAs(value: unknown, metadata: PropertyMetadata): boolean {
        if (value === null) {
            return true;
        }
        switch (metadata.type) {
            case 'string': {
                return typeof value === 'string';
            }
            case 'number': {
                return this.isNumberStoredAs(value, metadata.format);
            }
            case 'boolean': {
                return typeof value === 'boolean';
            }
            case 'date': {
                return typeof value === 'string' && !Number.isNaN(Date.parse(value));
            }
            case 'object':
            case 'oneOf': {
                return typeof value === 'object' && !Array.isArray(value);
            }
            case 'array': {
                return Array.isArray(value);
            }
            // a property that says nothing about its values, and the kinds no migration describes
            case 'unknown':
            case 'file':
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY: {
                return true;
            }
        }
    }

    /**
     * Whether a value is a number of the given format, as it is stored as json.
     * @param value - The value, parsed from json.
     * @param format - The format.
     * @returns Whether a number of that format could have been stored as the value.
     */
    private static isNumberStoredAs(value: unknown, format: NumberFormat): boolean {
        switch (format) {
            // stored as text, since neither survives being a json number - but a json number is a
            // value of either as well, and one stored before the property had its format is one
            case 'bigint': {
                return Number.isInteger(value) || (typeof value === 'string' && INTEGER_REGEX.test(value));
            }
            case 'bignumber': {
                return typeof value === 'number' || (typeof value === 'string' && this.DECIMAL_REGEX.test(value));
            }
            case 'integer': {
                return Number.isInteger(value);
            }
            case 'number': {
                return typeof value === 'number';
            }
        }
    }

    /**
     * Whether two values parsed from json are the same value.
     * @param a - The one value.
     * @param b - The other value.
     * @returns True for equal primitives, and for arrays and objects holding the same values.
     */
    private static isSameValue(a: unknown, b: unknown): boolean {
        if (Array.isArray(a) || Array.isArray(b)) {
            return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => this.isSameValue(v, b[i]));
        }
        if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
            return a === b;
        }
        const keys: string[] = ObjectUtilities.keys(a);
        return keys.length === ObjectUtilities.keys(b).length
            && keys.every(key => key in b && this.isSameValue(Reflect.get(a, key), Reflect.get(b, key)));
    }

    /**
     * Lists refused values by why they were refused.
     * @param conversion - The change.
     * @param refused - The values.
     * @returns One line per reason, each naming its values once.
     */
    private static listRefusals(conversion: ResolvedPropertyConversion, refused: RefusedValue[]): string {
        return Object.values(ConversionRefusal)
            .map(refusal => {
                const values: string[] = [
                    ...new Set(refused
                        .filter(r => r.refusal === refusal)
                        .map(r => JsonUtilities.stringify(r.value)))
                ];
                return values.length ? `\n- ${this.describeRefusal(refusal, conversion)}: ${values.join(', ')}` : '';
            })
            .join('');
    }

    /**
     * Describes why values were refused.
     * @param refusal - Why.
     * @param conversion - The change.
     * @returns The reason, as a line of what a failed change says.
     */
    private static describeRefusal(refusal: ConversionRefusal, conversion: ResolvedPropertyConversion): string {
        switch (refusal) {
            case ConversionRefusal.NOT_CURRENT: {
                return `not ${this.describe(conversion.current)}, which the current property says`;
            }
            case ConversionRefusal.NOT_LISTED: {
                return 'not listed by the conversion';
            }
            case ConversionRefusal.DOES_NOT_FIT: {
                return `not the same value as ${this.describe(conversion.changed)}`;
            }
            case ConversionRefusal.MISSING: {
                return 'missing, which the new property requires';
            }
        }
    }

    /**
     * Describes what a property holds.
     * @param metadata - The property.
     * @returns For example `a number of format "integer"`.
     */
    private static describe(metadata: PropertyMetadata): string {
        switch (metadata.type) {
            case 'number': {
                return `a number of format "${metadata.format}"`;
            }
            case 'array': {
                return `an array of ${metadata.items.type}`;
            }
            case 'string':
            case 'boolean':
            case 'date':
            case 'object':
            case 'oneOf':
            case 'unknown':
            case 'file': {
                return `a ${metadata.type}`;
            }
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY: {
                return `a ${metadata.type} relation`;
            }
        }
    }

    /**
     * The format of a number, for telling apart two arrays whose items are numbers.
     * @param metadata - The items.
     * @returns The format, or undefined for anything that is not a number.
     */
    private static formatOf(metadata: PropertyMetadata): NumberFormat | undefined {
        return metadata.type === 'number' ? metadata.format : undefined;
    }
}