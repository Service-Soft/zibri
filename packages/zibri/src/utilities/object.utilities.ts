/**
 * Utilities for handling objects.
 */
export abstract class ObjectUtilities {
    /**
     * Gets the correctly typed keys for the given object.
     * @param obj - The object to get the keys from.
     * @returns The correctly typed keys as an array.
     */
    static keys<T extends object>(obj: T): Extract<(keyof T), string>[] {
        return Object.keys(obj) as Extract<(keyof T), string>[];
    }

    /**
     * Resolves the values of the given object.
     * @param obj - The object to get the values from.
     * @returns An array of all values of the objects properties.
     */
    static values<T extends object>(obj: T): T[(keyof T)][] {
        return Object.values(obj) as T[(keyof T)][];
    }

    /**
     * Resolves the KeyValue entries of the given object.
     * @param obj - The object to get the entries from.
     * @returns An array of tuples of the key and the value of the objects properties.
     */
    static entries<T extends object>(
        obj: T
    ): [Extract<(keyof T), string>, T[Extract<(keyof T), string>]][] {
        return this.keys(obj).map((key) => [key, obj[key]]);
    }

    /**
     * Copies the arrays and plain objects of a value, all the way down.
     *
     * Only those, because they are what code changing a value in place changes. Anything else - a
     * date, a file, a decimal, an instance of a class - is shared.
     * @param value - The value to copy.
     * @returns A value that can be changed in place without the original noticing.
     */
    static copyDeep<T>(value: T): T {
        if (Array.isArray(value)) {
            return value.map(item => this.copyDeep<unknown>(item)) as T;
        }
        if (typeof value !== 'object' || value === null) {
            return value;
        }
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return value;
        }
        const res: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            res[key] = this.copyDeep<unknown>(item);
        }
        return res as T;
    }
}