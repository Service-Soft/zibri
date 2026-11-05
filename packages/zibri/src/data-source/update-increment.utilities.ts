import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { isRelationMetadata } from '../entity/models/is-relation-metadata.function';
import { InternalError } from '../error-handling/internal-error.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { Increment, IncrementAmounts } from './models/update-all-data.model';

/**
 * Utilities for the amounts an update adds to what rows store.
 */
export abstract class UpdateIncrementUtilities {
    /**
     * Takes the amounts an update adds off the values it sets.
     *
     * `{ increment }` is an amount only for a number property. For a property holding objects or
     * values of any shape it is a value like any other.
     * @param data - The update as the caller gave it.
     * @param entityClass - The entity the update writes.
     * @returns The values it sets, and the amounts it adds by property.
     * @throws When an amount is given for a property that holds no number, or one with a fraction for
     * a property holding whole numbers.
     */
    static resolveValuesAndIncrements<D extends object>(data: object, entityClass: Newable<unknown>): [D, IncrementAmounts] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const values: Record<string, unknown> = {};
        const increments: IncrementAmounts = {};
        for (const [key, value] of Object.entries(data)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (!this.isIncrement(value) || metadata == undefined || this.holdsObjects(metadata)) {
                values[key] = value;
                continue;
            }
            if (metadata.type !== 'number' || metadata.format === 'bignumber') {
                throw new InternalError(`${entityClass.name}.${key} holds no number, so nothing can be added to it.`);
            }
            const amount: number = value.increment;
            if (!Number.isFinite(amount) || (metadata.format === 'integer' && !Number.isInteger(amount))) {
                throw new InternalError(`${entityClass.name}.${key} holds whole numbers, so it cannot be increased by ${amount}.`);
            }
            increments[key] = amount;
        }
        // the caller's own values with the amounts taken out, which is the update data they were
        // written as - the amounts were only ever allowed next to them
        return [values as D, increments];
    }

    /**
     * Whether a value given for a property is an amount to add rather than a value to set.
     * @param value - The value given.
     * @returns True for `{ increment }` and nothing else.
     */
    private static isIncrement(value: unknown): value is Increment {
        return typeof value === 'object'
            && value != undefined
            && !Array.isArray(value)
            && Object.keys(value).length === 1
            && typeof Reflect.get(value, 'increment') === 'number';
    }

    /**
     * Whether a property holds something an object could be a value of.
     * @param metadata - The property.
     * @returns True for objects, values of any shape and relations.
     */
    private static holdsObjects(metadata: PropertyMetadata): boolean {
        return metadata.type === 'object' || metadata.type === 'unknown' || isRelationMetadata(metadata);
    }
}