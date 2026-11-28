import { inject } from '../di/inject.function';
import { InjectionToken } from '../di/models/injection-token.model';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { ArrayPropertyItemMetadata } from '../entity/models/array-property-metadata.model';
import { FilePropertyMetadata } from '../entity/models/file-property-metadata.model';
import { Relation } from '../entity/models/relation.enum';
import { InternalError } from '../error-handling/internal-error.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

/**
 * What a file kept in a file store is declared as.
 */
export type StoredFilePropertyMetadata = FilePropertyMetadata & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    store: string | InjectionToken<string>
};

/**
 * A property of an entity holding a file kept in a file store, or an array of them.
 */
export type StoredFileProperty = {
    /**
     * The key of the property.
     */
    key: string,
    /**
     * Whether the property is an array of files.
     */
    isArray: boolean,
    /**
     * What the property is declared as.
     */
    property: PropertyMetadata,
    /**
     * What each file is declared as: the property, or the items of the array.
     */
    file: StoredFilePropertyMetadata
};

/**
 * The properties of entities whose files are kept in a file store, where the column holds the id of the file's
 * `FileRecord`.
 */
export abstract class FilePropertyUtilities {
    // the decorators ran at module load, so what a class declares does not change afterwards
    private static readonly cache: WeakMap<Function, StoredFileProperty[]> = new WeakMap();

    /**
     * Whether a property, or the items of an array, is a file kept in a file store.
     * @param metadata - What the property or the items are declared as.
     * @returns True for a file that names a store.
     */
    static isInStore(metadata: PropertyMetadata | ArrayPropertyItemMetadata): metadata is StoredFilePropertyMetadata {
        return metadata.type === 'file' && metadata.store != undefined;
    }

    /**
     * Resolves the name of the file store a file is kept in: the name the property gives, or the value of the DI
     * token it gives.
     * @param metadata - What the file is declared as.
     * @returns The name of the store.
     */
    static resolveStoreName(metadata: StoredFilePropertyMetadata): string {
        // read when used rather than when the class is declared, which is before the application's providers exist
        return typeof metadata.store === 'string' ? metadata.store : inject(metadata.store);
    }

    /**
     * Resolves the properties of a class that hold a file kept in a file store, or an array of them.
     * @param cls - The class, usually an entity.
     * @returns The properties, in the order they are declared.
     */
    static resolveStoredFileProperties(cls: Newable<unknown>): StoredFileProperty[] {
        const known: StoredFileProperty[] | undefined = this.cache.get(cls);
        if (known != undefined) {
            return known;
        }
        const res: StoredFileProperty[] = [];
        for (const [key, property] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(cls))) {
            if (this.isInStore(property)) {
                res.push({ key, isArray: false, property, file: property });
            }
            else if (property.type === 'array' && this.isInStore(property.items)) {
                res.push({ key, isArray: true, property, file: property.items });
            }
        }
        this.cache.set(cls, res);
        return res;
    }

    /**
     * Resolves the ids of the files a row holds in the given properties.
     * @param row - The row.
     * @param properties - The properties holding files kept in a file store.
     * @returns The ids, each once.
     */
    static resolveFileIds(row: object, properties: StoredFileProperty[]): string[] {
        const ids: Set<string> = new Set();
        for (const property of properties) {
            const held: unknown = Reflect.get(row, property.key);
            for (const id of Array.isArray(held) ? held : [held]) {
                if (typeof id === 'string') {
                    ids.add(id);
                }
            }
        }
        return [...ids];
    }

    /**
     * Validates that an entity keeps files in a file store only in its own properties and in the items of its arrays,
     * where a row and its download route name them.
     * @param entityClass - The entity.
     * @throws An InternalError naming a file kept in a store anywhere else, such as inside an object.
     */
    static validateStoredFilePlacement(entityClass: Newable<unknown>): void {
        for (const [key, property] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(entityClass))) {
            const path: string = `${entityClass.name}.${key}`;
            switch (property.type) {
                case 'array': {
                    // the items of an array are files of the entity, an array inside them is not
                    if (!this.isInStore(property.items)) {
                        this.validateNoStoredFileIn(property.items, path, entityClass.name, new Set());
                    }
                    break;
                }
                case 'object':
                case 'oneOf': {
                    this.validateNoStoredFileIn(property, path, entityClass.name, new Set());
                    break;
                }
                case 'string':
                case 'number':
                case 'boolean':
                case 'date':
                case 'file':
                case 'unknown':
                case Relation.HAS_ONE:
                case Relation.BELONGS_TO_ONE:
                case Relation.ONE_TO_MANY:
                case Relation.MANY_TO_ONE:
                case Relation.MANY_TO_MANY: {
                    // a relation is the rows of another entity, validated as that entity
                    break;
                }
            }
        }
    }

    private static validateNoStoredFileIn(
        metadata: PropertyMetadata | ArrayPropertyItemMetadata,
        path: string,
        entityName: string,
        visited: Set<Function>
    ): void {
        if (this.isInStore(metadata)) {
            throw new InternalError([
                `${path}: A file kept in a file store needs to be a property of the entity or the items of one of its arrays.`,
                `Declare it as a property of ${entityName}.`
            ]);
        }
        switch (metadata.type) {
            case 'array': {
                this.validateNoStoredFileIn(metadata.items, path, entityName, visited);
                return;
            }
            case 'oneOf': {
                for (const [name, shape] of ObjectUtilities.entries(metadata.shapes)) {
                    this.validateNoStoredFileIn(shape, `${path}.${name}`, entityName, visited);
                }
                return;
            }
            case 'object': {
                const cls: Newable<unknown> = metadata.cls();
                // a class holding one of its own kind is walked once
                if (visited.has(cls)) {
                    return;
                }
                visited.add(cls);
                for (const [key, property] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(cls))) {
                    this.validateNoStoredFileIn(property, `${path}.${key}`, entityName, visited);
                }
                return;
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'file':
            case 'unknown':
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY: {
                return;
            }
        }
    }
}