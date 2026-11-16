import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { Relation } from '../entity/models/relation.enum';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * The kind of value that stands in for one a row has to give up: one that keeps the value it stands
 * for wherever the type of the property lets it.
 */
export type TenantRowsStandInKind = 'text' | 'number' | 'date' | 'uuid' | 'null';

/**
 * The kinds, the one keeping most of the value first.
 */
const STAND_IN_KINDS: TenantRowsStandInKind[] = ['text', 'number', 'date', 'uuid', 'null'];

/**
 * Values that stand in for a unique value a row a restore keeps holds, when the backup gives that value
 * to another row.
 */
export abstract class TenantRowsStandInUtilities {
    /**
     * The mark a text stand-in carries after the value it stands for: the moment of the restore.
     * @param at - The moment.
     * @returns The mark, such as `20261113T083418123Z`.
     */
    static resolveStamp(at: Date): string {
        return at.toISOString().replaceAll(/[-:.]/g, '');
    }

    /**
     * The kind of stand-in a property takes, if any.
     * @param property - The property.
     * @param isReference - Whether it holds the key of a relation, which only an empty value stands in for.
     * @param stamp - The mark a text stand-in carries.
     * @returns The kind, or undefined when no value can stand in for one it holds.
     */
    static findKind(property: PropertyMetadata, isReference: boolean, stamp: string): TenantRowsStandInKind | undefined {
        const kind: TenantRowsStandInKind | undefined = isReference ? undefined : this.findKindOfValue(property, stamp);
        return kind ?? (property.required === true ? undefined : 'null');
    }

    /**
     * Compares two kinds by how much of the value they keep.
     * @param a - One kind.
     * @param b - The other.
     * @returns Less than 0 when a keeps more.
     */
    static compareKinds(a: TenantRowsStandInKind, b: TenantRowsStandInKind): number {
        return STAND_IN_KINDS.indexOf(a) - STAND_IN_KINDS.indexOf(b);
    }

    /**
     * One value that can stand in for another: `<value>_<stamp>` for a text, the next value after it for
     * a number or a date, a new uuid, or nothing.
     * @param kind - The kind.
     * @param original - The value it stands in for.
     * @param attempt - How many were tried before, each of them held: 0 for the first.
     * @param stamp - The mark a text stand-in carries.
     * @param maxLength - The length a text can be at most, if any.
     * @returns The value, or undefined when a text one does not fit.
     */
    static resolveCandidate(
        kind: TenantRowsStandInKind,
        original: unknown,
        attempt: number,
        stamp: string,
        maxLength: number | undefined
    ): unknown {
        switch (kind) {
            case 'text': {
                const suffix: string = attempt === 0 ? `_${stamp}` : `_${stamp}_${attempt + 1}`;
                if (maxLength != undefined && suffix.length >= maxLength) {
                    return undefined;
                }
                const kept: string = typeof original === 'string' ? original : '';
                return `${maxLength == undefined ? kept : kept.slice(0, maxLength - suffix.length)}${suffix}`;
            }
            case 'number': {
                return Number(original) + attempt + 1;
            }
            case 'date': {
                const time: number = original instanceof Date ? original.getTime() : new Date(String(original)).getTime();
                return new Date(time + attempt + 1);
            }
            case 'uuid': {
                return UUIDUtilities.generate();
            }
            case 'null': {
                return null;
            }
        }
    }

    /**
     * A value as one string, equal for values the store compares equal in a unique.
     * @param value - The value, as stored.
     * @returns The string, or undefined for no value, which never takes one up.
     */
    static encode(value: unknown): string | undefined {
        if (value == undefined) {
            return undefined;
        }
        if (value instanceof Date) {
            return `d${value.toISOString()}`;
        }
        return Buffer.isBuffer(value) ? `b${value.toString('base64')}` : `j${JSON.stringify(value)}`;
    }

    private static findKindOfValue(property: PropertyMetadata, stamp: string): TenantRowsStandInKind | undefined {
        switch (property.type) {
            case 'string': {
                // an encrypted value read back with anything added fails to decrypt, and one of an enum
                // or a uuid column takes nothing added
                if (property.enum != undefined || (property.encryption !== false && property.encryption != undefined)) {
                    return undefined;
                }
                if (property.format === 'uuid') {
                    return 'uuid';
                }
                return property.maxLength == undefined || property.maxLength > stamp.length + 1 ? 'text' : undefined;
            }
            case 'number': {
                return property.enum == undefined ? 'number' : undefined;
            }
            case 'date': {
                return 'date';
            }
            case 'boolean':
            case 'object':
            case 'array':
            case 'oneOf':
            case 'file':
            case 'unknown':
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY: {
                return undefined;
            }
        }
    }
}