import { DataSourceTime } from './models/data-source-time.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { InternalError } from '../error-handling/internal-error.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';

/**
 * The times of the data source a write gives, by property.
 */
export type DataSourceTimes = Record<string, DataSourceTime>;

/**
 * Reads and resolves the times of the data source that `dataSourceNow` writes into filters and into
 * the rows of a write.
 */
export abstract class DataSourceTimeUtilities {
    /**
     * Takes the times of the data source a write gives off the values it sets.
     *
     * Taken off before anything else runs on the data, the way the amounts an update adds are: a hook
     * reading a date property finds a date or nothing, and the times go back on the row only where it
     * is handed to the store.
     * @param data - The write as the caller gave it.
     * @param entityClass - The entity the write writes.
     * @returns The values it sets, and the times it gives by property.
     * @throws When a time is given for a property that holds no date.
     */
    static split<D extends object>(data: object, entityClass: Newable<unknown>): [D, DataSourceTimes] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const values: Record<string, unknown> = {};
        const times: DataSourceTimes = {};
        for (const [key, value] of Object.entries(data)) {
            if (!this.isDataSourceTime(value)) {
                values[key] = value;
                continue;
            }
            if (properties[key]?.type !== 'date') {
                throw new InternalError(`${entityClass.name}.${key} holds no date, so it cannot be given the time of the data source.`);
            }
            times[key] = value;
        }
        // the caller's own values with the times taken out, which is the data they were written as -
        // the times were only ever allowed next to them
        return [values as D, times];
    }

    /**
     * Puts the times of the data source a write gives back on the row handed to the store.
     * @param row - The row, as the write prepared it.
     * @param times - The times, by property.
     * @returns A copy holding the times, of the same class, or the row itself when there are none.
     */
    static merge<R extends object>(row: R, times: DataSourceTimes): R {
        if (!Object.keys(times).length) {
            return row;
        }
        const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(row);
        for (const [key, time] of Object.entries(times)) {
            descriptors[key] = { value: time, writable: true, enumerable: true, configurable: true };
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const res: R = Object.create(Reflect.getPrototypeOf(row), descriptors);
        return res;
    }

    /**
     * Whether a value is a time of the data source, as `dataSourceNow` makes it.
     * @param value - The value.
     * @returns True for a time of the data source.
     */
    static isDataSourceTime(value: unknown): value is DataSourceTime {
        return typeof value === 'object'
            && value != undefined
            && !Array.isArray(value)
            && Object.keys(value).length === 1
            && typeof Reflect.get(value, 'dataSourceNowPlusInMs') === 'number';
    }

    /**
     * Resolves a time of the data source against the time it stands for.
     * @param time - The time of the data source.
     * @param now - What the clock of the data source says.
     * @returns The date.
     */
    static resolveTime(time: DataSourceTime, now: Date): Date {
        return new Date(now.getTime() + time.dataSourceNowPlusInMs);
    }

    /**
     * Whether a filter names a time of the data source anywhere in it.
     * @param where - The filter.
     * @returns True when it does.
     */
    static isNamedInWhere(where: unknown): boolean {
        if (this.isDataSourceTime(where)) {
            return true;
        }
        return Array.isArray(where)
            ? where.some(item => this.isNamedInWhere(item))
            : this.isPlainObject(where) && Object.values(where).some(value => this.isNamedInWhere(value));
    }

    /**
     * Whether the row of a write gives a time of the data source for one of its properties.
     * @param row - The row.
     * @returns True when it does.
     */
    static isNamedInRow(row: object): boolean {
        return Object.values(row).some(value => this.isDataSourceTime(value));
    }

    /**
     * Resolves every time of the data source a filter names.
     * @param where - The filter.
     * @param now - What the clock of the data source says.
     * @returns The filter comparing with dates only, the same one when it names no time.
     */
    static resolveInWhere<W>(where: W, now: Date): W {
        // rebuilt along the paths holding a time and nowhere else, which keeps the shape of the filter
        // it was given - so the cast states what the walk preserved
        return this.resolveWhereValue(where, now) as W;
    }

    /**
     * Resolves the times of the data source the row of a write gives.
     * @param row - The row.
     * @param now - What the clock of the data source says.
     * @returns A copy with dates in their place, of the same class, or the row itself when it gives no time.
     */
    static resolveInRow<R extends object>(row: R, now: Date): R {
        if (!this.isNamedInRow(row)) {
            return row;
        }
        const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(row);
        for (const descriptor of Object.values(descriptors)) {
            if (this.isDataSourceTime(descriptor.value)) {
                descriptor.value = this.resolveTime(descriptor.value, now);
            }
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const res: R = Object.create(Reflect.getPrototypeOf(row), descriptors);
        return res;
    }

    private static resolveWhereValue(value: unknown, now: Date): unknown {
        if (this.isDataSourceTime(value)) {
            return this.resolveTime(value, now);
        }
        if (Array.isArray(value)) {
            const resolved: unknown[] = value.map(item => this.resolveWhereValue(item, now));
            return resolved.some((item, i) => item !== value[i]) ? resolved : value;
        }
        if (!this.isPlainObject(value)) {
            return value;
        }
        const entries: [string, unknown][] = Object.entries(value);
        const resolved: [string, unknown][] = entries.map(([key, item]) => [key, this.resolveWhereValue(item, now)]);
        return resolved.some(([, item], i) => item !== entries[i]?.[1]) ? Object.fromEntries(resolved) : value;
    }

    /**
     * Whether a value is an object a filter is written as, rather than a value it compares with, such
     * as a date.
     * @param value - The value.
     * @returns True for a plain object.
     */
    private static isPlainObject(value: unknown): value is Record<string, unknown> {
        if (typeof value !== 'object' || value == undefined || Array.isArray(value)) {
            return false;
        }
        const prototype: unknown = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }
}