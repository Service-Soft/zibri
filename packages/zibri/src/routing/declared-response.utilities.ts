import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../entity/models/array-property-metadata.model';
import { OneOfShapeMetadata } from '../entity/models/one-of-property-metadata.model';
import { Relation } from '../entity/models/relation.enum';
import { FilePropertyUtilities } from '../file/file-property.utilities';
import { type PendingFileReference } from '../file/file-reference.utilities';
import { FileRouteRegistry } from '../file/file-route.registry';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * What a property of a model, an item of an array or a shape of a oneOf declares about a value.
 */
type DeclaredValueMetadata = PropertyMetadata | ArrayPropertyItemMetadata | OneOfShapeMetadata;

/**
 * A row being written, which the url of each of its files names.
 */
type DeclaredRow = {
    /**
     * The classes the row is written as.
     */
    classes: Newable<unknown>[],
    /**
     * The id of the row.
     */
    rowId: unknown
};

/**
 * Writes a JSON response with what its declaration names, and nothing else.
 */
export abstract class DeclaredResponseUtilities {
    /**
     * The value a response declaring the given classes is written with: the properties the classes
     * declare, all the way down, and none of the others. A nested object that allows additional
     * properties keeps them; a property of unknown type keeps whatever it holds.
     * @param value - What the handler returned, or one item of it.
     * @param classes - The classes the response declares for the value. Several are one of them, so
     * the value keeps what any of them declares.
     * @param files - Where the ids of the files kept in a file store are added, whose references are
     * written in their place once they are read.
     * @returns The value, without what the classes do not declare.
     */
    static resolveDeclaredValue(value: unknown, classes: Newable<unknown>[], files: PendingFileReference[]): unknown {
        const properties: Record<string, PropertyMetadata> = DeclaredResponseUtilities.resolveProperties(classes);
        return DeclaredResponseUtilities.isRecord(value)
            ? DeclaredResponseUtilities.resolveModelValue(value, classes, properties, false, files)
            : value;
    }

    private static resolveModelValue(
        value: Record<string, unknown>,
        classes: Newable<unknown>[],
        properties: Record<string, PropertyMetadata>,
        keepsUndeclared: boolean,
        files: PendingFileReference[]
    ): Record<string, unknown> {
        // a class that declares no property, such as one with an index signature, describes no shape
        // to keep to: it says the value is an object, whatever it holds
        if (ObjectUtilities.keys(properties).length === 0) {
            return value;
        }
        const res: Record<string, unknown> = keepsUndeclared ? { ...value } : {};
        for (const [key, metadata] of ObjectUtilities.entries(properties)) {
            // `in` rather than own keys, so a value that is an instance answers its getters too. An excluded
            // property stays on the server: a row read through a repository holds it as an own property that is
            // not enumerable, which `in` finds all the same, and a value built by hand holds it as any other
            if (DeclaredResponseUtilities.isExcluded(value, key, metadata)) {
                // kept by a class that allows what it does not declare, for an object holding it
                Reflect.deleteProperty(res, key);
            }
            else if (key in value) {
                res[key] = DeclaredResponseUtilities.resolvePropertyValue(value[key], metadata, files);
                DeclaredResponseUtilities.addPendingFiles(res, key, metadata, { classes, rowId: value['id'] }, files);
            }
        }
        return res;
    }

    /**
     * Adds the ids of the files kept in a file store that a property of a row holds, each written over
     * with its reference once read. Only the properties of a row and the items of its arrays hold them,
     * which is where the url of the download names them.
     * @param res - What the row is written as, holding the property already.
     * @param key - The property.
     * @param metadata - What the property is declared as.
     * @param row - The classes the row is written as, and its id.
     * @param files - Where the ids are added.
     */
    private static addPendingFiles(
        res: Record<string, unknown>,
        key: string,
        metadata: PropertyMetadata,
        row: DeclaredRow,
        files: PendingFileReference[]
    ): void {
        const held: unknown = res[key];
        if (FilePropertyUtilities.isInStore(metadata) && typeof held === 'string') {
            files.push({
                fileId: held,
                url: FileRouteRegistry.findUrl(row.classes, row.rowId, key),
                write: reference => {
                    res[key] = reference;
                }
            });
            return;
        }
        if (metadata.type !== 'array' || !FilePropertyUtilities.isInStore(metadata.items) || !Array.isArray(held)) {
            return;
        }
        // the array was copied while it was resolved, so it is this response's own to write into
        const items: unknown[] = held;
        for (const [i, item] of items.entries()) {
            if (typeof item === 'string') {
                files.push({
                    fileId: item,
                    url: FileRouteRegistry.findUrl(row.classes, row.rowId, `${key}.${i}`),
                    write: reference => {
                        items[i] = reference;
                    }
                });
            }
        }
    }

    private static resolvePropertyValue(value: unknown, metadata: DeclaredValueMetadata, files: PendingFileReference[]): unknown {
        switch (metadata.type) {
            case 'object': {
                const cls: Newable<unknown> = metadata.cls();
                return DeclaredResponseUtilities.isRecord(value)
                    ? DeclaredResponseUtilities.resolveModelValue(
                        value,
                        [cls],
                        MetadataUtilities.getModelProperties(cls),
                        metadata.allowAdditionalProperties,
                        files
                    )
                    : value;
            }
            case 'array': {
                return Array.isArray(value)
                    ? value.map(item => DeclaredResponseUtilities.resolvePropertyValue(item, metadata.items, files))
                    : value;
            }
            case 'oneOf': {
                return DeclaredResponseUtilities.resolveOneOfValue(value, metadata.shapes, files);
            }
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY: {
                return Array.isArray(value)
                    ? value.map(item => DeclaredResponseUtilities.resolveDeclaredValue(item, [metadata.target()], files))
                    : DeclaredResponseUtilities.resolveDeclaredValue(value, [metadata.target()], files);
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'file':
            case 'unknown': {
                return value;
            }
        }
    }

    // a value of several shapes names the one it is, `{ shape, value }`, so its value keeps what that
    // shape declares. A shape the property does not declare leaves nothing to keep to but the name
    private static resolveOneOfValue(value: unknown, shapes: Record<string, OneOfShapeMetadata>, files: PendingFileReference[]): unknown {
        if (!DeclaredResponseUtilities.isRecord(value) || typeof value['shape'] !== 'string') {
            return value;
        }
        const shape: OneOfShapeMetadata | undefined = shapes[value['shape']];
        return shape == undefined
            ? { shape: value['shape'] }
            : { shape: value['shape'], value: DeclaredResponseUtilities.resolvePropertyValue(value['value'], shape, files) };
    }

    private static resolveProperties(classes: Newable<unknown>[]): Record<string, PropertyMetadata> {
        const res: Record<string, PropertyMetadata> = {};
        for (const cls of classes) {
            for (const [key, metadata] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(cls))) {
                res[key] ??= metadata;
            }
        }
        return res;
    }

    // an `exclude` that is a function asks about the request, which the repository answered as it read the row
    private static isExcluded(value: Record<string, unknown>, key: string, metadata: PropertyMetadata): boolean {
        return metadata.exclude === true || Object.getOwnPropertyDescriptor(value, key)?.enumerable === false;
    }

    // a date, a bignumber and a buffer are values json writes whole, not objects to walk
    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object'
            && value !== null
            && !Array.isArray(value)
            && !(value instanceof Date)
            && !ArrayBuffer.isView(value)
            && !('toJSON' in value);
    }
}