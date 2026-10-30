import { BaseEntity } from '../entity/base-entity.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../entity/models/array-property-metadata.model';
import { Relation } from '../entity/models/relation.enum';
import { InternalError } from '../error-handling/internal-error.model';
import { isNamedValue } from '../parsing/functions/parse-one-of.function';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

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
     * Gives the data being created an id, unless it already brought one.
     * @param data - The data about to be created.
     * @param cls - The class of the entity being written.
     * @throws When the data brings an id that the id property says it cannot hold.
     */
    static assignId(data: DeepPartial<BaseEntity>, cls: Newable<unknown>): void {
        // generated here rather than by the driver, so that the id exists while the save hooks run:
        // encryption binds a value to the id of its row, and a hook that references the row it is
        // preparing needs it as well. It also makes the id come from the same place whichever data
        // source is behind the repository
        // a declared format is what every read narrows by, so a value outside it would make the row
        // impossible to find through its own id. Refused at the write instead, where the caller that
        // chose the value is still there to be told
        if (
            data.id != undefined
            && UUIDUtilities.declaresUuidFormat(MetadataUtilities.getModelProperties(cls)['id'])
            && !UUIDUtilities.isUuid(data.id)
        ) {
            throw new InternalError(
                `"${cls.name}.id" declares the uuid format, so "${data.id}" cannot be stored as one. `
                + 'A chosen id has to be a uuid too. A key that is no uuid belongs in a property of its own, declared unique.'
            );
        }
        data.id ??= UUIDUtilities.generate();
    }

    /**
     * Writes every uuid the data holds in lower case, the form every data source stores it in -
     * including those of the related rows it names.
     * @param data - The data about to be written, changed in place. A related row that changes is
     * replaced by a copy.
     * @param cls - The class of the entity being written.
     */
    static writeUuidsInLowerCase(data: object, cls: Newable<BaseEntity>): void {
        Object.assign(data, UUIDUtilities.resolveCanonicalChanges(data, cls));
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
     * Resolves what an update that adds amounts writes to a stored row: the data, with each amount
     * added to what the row holds. A property holding no value counts as 0.
     * @param data - The data of the update, as it is written to the row.
     * @param stored - The row as it is stored.
     * @param increments - The amounts to add, by property.
     * @returns The data, with a value for every property an amount was added to.
     */
    static resolveIncremented<D extends object>(data: D, stored: object, increments: Record<string, number> | undefined): D {
        if (increments == undefined) {
            return data;
        }
        const res: D = { ...data };
        for (const [key, amount] of Object.entries(increments)) {
            const value: unknown = Reflect.get(stored, key);
            Reflect.set(res, key, (typeof value === 'number' ? value : 0) + amount);
        }
        return res;
    }

    /**
     * Resolves an update that writes every object it gives as it is given, not merged into the
     * stored one: each property the stored object holds and the given one leaves out is given as
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
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY:
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