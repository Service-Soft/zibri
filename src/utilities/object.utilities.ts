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
}