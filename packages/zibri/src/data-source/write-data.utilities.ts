import { PropertyMetadata } from '../entity/decorators/property.decorator.ts';
import { ArrayPropertyItemMetadata } from '../entity/models/array-property-metadata.model.ts';
import { RelationType } from '../entity/models/relation-type.enum.ts';
import { isNamedValue } from '../parsing/functions/parse-one-of.function.ts';
import { Newable } from '../types/newable.type.ts';
import { MetadataUtilities } from '../utilities/metadata.utilities.ts';

/**
 * The data a write works on, as it is taken from its caller and as it lands on a stored row.
 */
export abstract class WriteDataUtilities {

    /**
     * Copies the data of a write, with every object and array its properties hold.
     *
     * A write changes the data it works on - an id generated, defaults filled in, values encrypted
     * and hashed, all the way into the models the data holds - and the caller still holds what they
     * passed, and may write it again.
     *
     * The data itself is copied the way a spread copies it, its own enumerable properties into a plain
     * object. What its properties hold is copied whole: a nested model keeps its class and every
     * property it has, an excluded one held behind a getter included, since a nested model is written
     * as a whole and leaving a property out would drop it. A related row is not copied, since a write
     * either names it by its id or hands it to the repository of its own entity, which copies it there.
     * @param data - The data the caller passed.
     * @param cls - The class of the entity being written.
     * @returns A copy the write can change without the caller's data changing with it.
     */
    static copy<D extends object>(data: D, cls: Newable<unknown>): D {
        const res: D = { ...data };
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        for (const [key, value] of Object.entries(res)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (metadata != undefined) {
                Reflect.set(res, key, this.copyValue(value, metadata));
            }
        }
        return res;
    }

    /**
     * Resolves what an update writes to a stored row: the data, with every object it gives merged
     * into the object the row holds, as deep as the objects go.
     *
     * An object in an update names the properties it changes and leaves the others as they are,
     * the way the update itself does. Everything else is written as given: an array, a value of
     * several shapes, and null. An object written where the row holds none is written as given too.
     * @param data - The data of the update.
     * @param stored - The row as it is stored.
     * @param cls - The class of the entity being written.
     * @returns The data, with each object it gives merged into the stored one.
     */
    static resolveMerged<D extends object>(data: D, stored: object, cls: Newable<unknown>): D {
        const res: D = { ...data };
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        for (const [key, value] of Object.entries(res)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            const merged: Newable<unknown> | undefined = metadata == undefined ? undefined : this.findMergedClass(value, metadata);
            if (merged != undefined) {
                // eslint-disable-next-line typescript/no-unsafe-argument
                Reflect.set(res, key, this.mergeModel(Reflect.get(stored, key), value, merged));
            }
        }
        return res;
    }

    /**
     * Resolves an update that writes every object it gives as it is given, rather than merged into
     * the stored one: each property the stored object holds and the given one leaves out is given as
     * null, as deep as the objects go.
     * @param data - The data of the update.
     * @param stored - The row as it is stored.
     * @param cls - The class of the entity being written.
     * @returns The data, with each object it gives naming every property the stored one holds.
     */
    static resolveReplacing<D extends object>(data: D, stored: object, cls: Newable<unknown>): D {
        const res: D = { ...data };
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        for (const [key, value] of Object.entries(res)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            const merged: Newable<unknown> | undefined = metadata == undefined ? undefined : this.findMergedClass(value, metadata);
            if (merged != undefined) {
                // eslint-disable-next-line typescript/no-unsafe-argument
                Reflect.set(res, key, this.replaceModel(Reflect.get(stored, key), value, merged));
            }
        }
        return res;
    }

    /**
     * Finds the class an update merges the given value into the stored one by.
     * @param value - The value an update gives a property.
     * @param metadata - The property.
     * @returns The class of the object property, or undefined when the value is written as given.
     */
    static findMergedClass(value: unknown, metadata: PropertyMetadata): Newable<unknown> | undefined {
        if (metadata.type !== 'object' || value == undefined || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }
        return metadata.cls();
    }

    /**
     * Merges an object an update gives into the stored one.
     * @param stored - The stored object.
     * @param given - The object the update gives.
     * @param cls - Their declared class.
     * @returns The stored object with every property the given one holds written over it.
     */
    private static mergeModel(stored: unknown, given: object, cls: Newable<unknown>): object {
        if (stored == undefined || typeof stored !== 'object' || Array.isArray(stored)) {
            return given;
        }
        const res: Record<string, unknown> = { ...stored };
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        for (const [key, value] of Object.entries(given)) {
            // left out, the way a property an update leaves out is
            if (value === undefined) {
                continue;
            }
            const metadata: PropertyMetadata | undefined = properties[key];
            const merged: Newable<unknown> | undefined = metadata == undefined ? undefined : this.findMergedClass(value, metadata);
            // eslint-disable-next-line typescript/no-unsafe-argument
            res[key] = merged == undefined ? value : this.mergeModel(res[key], value, merged);
        }
        return res;
    }

    /**
     * Gives null for every property the stored object holds and the given one leaves out.
     * @param stored - The stored object.
     * @param given - The object the update gives.
     * @param cls - Their declared class.
     * @returns The given object, naming every property the stored one holds.
     */
    private static replaceModel(stored: unknown, given: object, cls: Newable<unknown>): object {
        if (stored == undefined || typeof stored !== 'object' || Array.isArray(stored)) {
            return given;
        }
        const res: Record<string, unknown> = { ...given };
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        for (const [key, value] of Object.entries(stored)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (metadata == undefined || value === undefined) {
                continue;
            }
            const replacing: unknown = res[key];
            if (replacing === undefined) {
                // eslint-disable-next-line unicorn/no-null
                res[key] = null;
            }
            else if (metadata.type === 'object' && typeof replacing === 'object' && replacing != undefined && !Array.isArray(replacing)) {
                res[key] = this.replaceModel(value, replacing, metadata.cls());
            }
        }
        return res;
    }

    /**
     * Copies what a property holds, as deep as its metadata says it holds objects and arrays.
     * @param value - The value of the property.
     * @param metadata - The property, or the items of an array property.
     * @returns The copy, or the value itself when it holds nothing a write changes in place.
     */
    private static copyValue(value: unknown, metadata: PropertyMetadata | ArrayPropertyItemMetadata): unknown {
        if (value == undefined || typeof value !== 'object') {
            return value;
        }
        switch (metadata.type) {
            case 'object': {
                return this.copyModel(value, metadata.cls());
            }
            case 'array': {
                return Array.isArray(value) ? value.map(item => this.copyValue(item, metadata.items)) : value;
            }
            case 'oneOf': {
                if (!isNamedValue(value)) {
                    return value;
                }
                const shape: ArrayPropertyItemMetadata | undefined = metadata.shapes[value.shape];
                return shape == undefined ? value : { shape: value.shape, value: this.copyValue(value.value, shape) };
            }
            case 'string':
            case 'number':
            case 'boolean':
            case RelationType.HAS_ONE:
            case RelationType.BELONGS_TO_ONE:
            case RelationType.ONE_TO_MANY:
            case RelationType.MANY_TO_ONE:
            case RelationType.MANY_TO_MANY:
            case 'unknown':
            case 'date':
            case 'file': {
                // a related row, or a value that is not changed in place: a date, a file, a number held
                // as an object
                return value;
            }
        }
    }

    /**
     * Copies a nested model with its class and every property it has, getters included.
     * @param model - The nested model.
     * @param cls - Its declared class.
     * @returns The copy.
     */
    private static copyModel(model: object, cls: Newable<unknown>): object {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(model);
        for (const [key, descriptor] of Object.entries(descriptors)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (metadata != undefined && 'value' in descriptor) {
                descriptor.value = this.copyValue(descriptor.value, metadata);
            }
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-argument
        const res: object = Object.create(Object.getPrototypeOf(model), descriptors);
        return res;
    }
}