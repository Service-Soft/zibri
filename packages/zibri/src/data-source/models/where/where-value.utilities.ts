import { AnyNumber } from './number-where-filter.model';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { PropertyMetadata } from '../../../entity/decorators/property.decorator';
import { Relation } from '../../../entity/models/relation.enum';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';

/**
 * Compares the values a where filter is written with the same way everywhere one is read.
 *
 * Shared by the evaluator, which compares them against stored values, and by the scopes, which
 * compare two filters against each other - a value asked for twice has to mean the same thing in both.
 */
export abstract class WhereValueUtilities {

    /**
     * Whether two values are the same value.
     *
     * The shapes a value takes are compared as the thing they hold rather than as objects: a date read
     * back as an iso string is the date it spells, and two big numbers holding the same number are the
     * same number.
     * @param value - The value to compare.
     * @param filterValue - What it is compared against.
     * @param metadata - The metadata of the property, used to compare the items of an array.
     * @returns Whether the two are equal.
     */
    static equals(value: unknown, filterValue: unknown, metadata: PropertyMetadata | undefined): boolean {
        if (value == undefined || filterValue == undefined) {
            return value == undefined && filterValue == undefined;
        }
        if (value instanceof Date || filterValue instanceof Date) {
            // eslint-disable-next-line typescript/no-base-to-string
            const left: Date = value instanceof Date ? value : new Date(String(value));
            // eslint-disable-next-line typescript/no-base-to-string
            const right: Date = filterValue instanceof Date ? filterValue : new Date(String(filterValue));
            return left.getTime() === right.getTime();
        }
        if (typeof value === 'bigint' || typeof filterValue === 'bigint') {
            // eslint-disable-next-line typescript/no-base-to-string
            return String(value) === String(filterValue);
        }
        // before the object branch below, which would compare a BigNumber by the fields it happens
        // to be built out of. Two of them holding the same number are the same number
        if (value instanceof BigNumber || filterValue instanceof BigNumber) {
            return this.compare(value, filterValue) === 0;
        }
        if (Array.isArray(value) || Array.isArray(filterValue)) {
            if (!Array.isArray(value) || !Array.isArray(filterValue) || value.length !== filterValue.length) {
                return false;
            }
            return value.every((v, i) => this.equals(v, filterValue[i], this.itemMetadata(metadata)));
        }
        if (typeof value === 'object' && typeof filterValue === 'object') {
            return this.deepEquals(value as Record<string, unknown>, filterValue as Record<string, unknown>);
        }
        return value === filterValue;
    }

    /**
     * Compares two values, the way an ordering operator does.
     *
     * Follows sql in that anything compared with null is never true, which is what the not a number
     * result says.
     * @param value - The value to compare.
     * @param filterValue - What it is compared against.
     * @returns A negative number when the value sorts first, a positive one when it sorts last, zero
     * when the two are equal, and not a number when either of them is absent.
     */
    static compare(value: unknown, filterValue: unknown): number {
        if (value == undefined || filterValue == undefined) {
            // mirrors sql, where any comparison with null is never true
            return Number.NaN;
        }
        // a date can be read back from the storage as an iso string, in that case both sides are compared as dates
        if (value instanceof Date || filterValue instanceof Date) {
            const leftTime: number = this.toTime(value);
            const rightTime: number = this.toTime(filterValue);
            if (leftTime === rightTime) {
                return 0;
            }
            return leftTime < rightTime ? -1 : 1;
        }

        const left: AnyNumber | string = this.toComparable(value);
        const right: AnyNumber | string = this.toComparable(filterValue);
        if (typeof left === 'string' || typeof right === 'string') {
            // which text sorts after which is a question about a language, so the application
            // answers it - and answers it for the database as well, through the collation its text
            // columns are created with
            return inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).compareText(String(left), String(right));
        }
        // through the numbers themselves rather than through the operators, which cannot compare
        // the three shapes a number takes against each other - see NumberUtilities.compare
        return NumberUtilities.compare(left, right);
    }

    /**
     * Unwraps a full entity to its id for the relations that are stored as a foreign key.
     * @param filterValue - The value of the filter.
     * @param metadata - The metadata of the filtered property.
     * @returns The id of the entity for to one relations, the unchanged value otherwise.
     */
    static unwrapRelation(filterValue: unknown, metadata: PropertyMetadata | undefined): unknown {
        if (
            (metadata?.type === Relation.MANY_TO_ONE || metadata?.type === Relation.BELONGS_TO_ONE)
            && typeof filterValue === 'object'
            && filterValue !== null
            && !Array.isArray(filterValue)
            && 'id' in filterValue
        ) {
            return filterValue.id;
        }
        return filterValue;
    }

    /**
     * The metadata of the items of an array property.
     * @param metadata - The metadata of the property.
     * @returns The metadata of its items, or undefined when it holds no array.
     */
    static itemMetadata(metadata: PropertyMetadata | undefined): PropertyMetadata | undefined {
        if (metadata?.type !== 'array') {
            return undefined;
        }
        return { ...metadata.items } as PropertyMetadata;
    }

    private static deepEquals(value: Record<string, unknown>, filterValue: Record<string, unknown>): boolean {
        const valueKeys: string[] = ObjectUtilities.keys(value);
        const filterKeys: string[] = ObjectUtilities.keys(filterValue);
        if (valueKeys.length !== filterKeys.length) {
            return false;
        }
        return valueKeys.every(k => this.equals(value[k], filterValue[k], undefined));
    }

    private static toTime(value: unknown): number {
        return value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    }

    private static toComparable(value: unknown): AnyNumber | string {
        if (value instanceof Date) {
            return value.getTime();
        }
        // as itself rather than as a double, so that two values differing past what a double holds
        // stay two values. What compares them is built for all three shapes
        if (typeof value === 'number' || typeof value === 'bigint' || value instanceof BigNumber) {
            return value;
        }
        if (typeof value === 'string') {
            // dates are stored as iso strings, comparing them lexicographically keeps the chronological order
            return value;
        }
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }
        return String(value);
    }
}