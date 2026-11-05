import { describe, expect, it } from '@jest/globals';

import { Property } from './property.decorator';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BigNumber } from '../../utilities/number.utilities';
import { NumberPropertyMetadata } from '../models/number-property-metadata.model';

/**
 * Reads the format off a property, the way everything that stores or validates one does.
 * @param cls - The class the property is on.
 * @param key - The name of the property.
 * @returns The format the property was declared with.
 */
function formatOf(cls: Newable<unknown>, key: string): string | undefined {
    const metadata: NumberPropertyMetadata | undefined = MetadataUtilities.getModelProperties(cls)[key] as
        NumberPropertyMetadata | undefined;
    return metadata?.format;
}

describe('what kind of number a property holds', () => {
    it('is a javascript number when nothing else is said', () => {
        class Reading {
            @Property.number()
            temperature!: number;
        }

        // rather than undefined, which is what "the store decides" looked like. Every value a number
        // property holds is now one of four kinds, and this is the one a javascript number is
        expect(formatOf(Reading, 'temperature')).toBe('number');
    });

    it('takes each of the four kinds', () => {
        class Order {
            @Property.number()
            total!: number;

            @Property.number({ format: 'integer' })
            quantity!: number;

            @Property.number({ format: 'bigint' })
            sequence!: bigint;

            @Property.number({ format: 'bignumber' })
            price!: BigNumber;
        }

        expect(formatOf(Order, 'total')).toBe('number');
        expect(formatOf(Order, 'quantity')).toBe('integer');
        expect(formatOf(Order, 'sequence')).toBe('bigint');
        expect(formatOf(Order, 'price')).toBe('bignumber');
    });

    it('refuses a declared type that contradicts the format', () => {
        // the property would hand back a bigint on every read, and everything reading it was told
        // it was getting a number. Refused where it is written rather than where it is noticed
        expect(() => {
            class Ledger {
                @Property.number({ format: 'bigint' })
                sequence!: number;
            }
            return Ledger;
        }).toThrow('The format "bigint" is held by BigInt, and the property is declared as Number.');
    });

    it('refuses a BigNumber declared as anything else', () => {
        expect(() => {
            class Invoice {
                @Property.number({ format: 'bignumber' })
                total!: number;
            }
            return Invoice;
        }).toThrow('The format "bignumber" is held by BigNumber, and the property is declared as Number.');
    });

    it('refuses a plain number declared as a BigNumber', () => {
        expect(() => {
            class Measurement {
                @Property.number()
                value!: BigNumber;
            }
            return Measurement;
        }).toThrow('The format "number" is held by Number, and the property is declared as BigNumber.');
    });

    it('accepts an optional property, which typescript still names a type for', () => {
        expect(() => {
            class Job {
                @Property.number({ format: 'bigint', required: false })
                startedAt?: bigint;
            }
            return Job;
        }).not.toThrow();
    });

    it('accepts a nullable property, whose type it cannot read', () => {
        // `bigint | null` compiles to Object, so there is nothing here to contradict the format.
        // Silent rather than guessing - the value is checked against the format on the way in
        expect(() => {
            class Run {
                @Property.number({ format: 'bigint', required: false })
                finishedAt?: bigint | null;
            }
            return Run;
        }).not.toThrow();
    });
});