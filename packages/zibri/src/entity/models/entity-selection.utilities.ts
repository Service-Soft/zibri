import { RelationTree } from './entity-relations.model';
import { EntitySelection } from './entity-selection.model';
import { isRelationMetadata } from './is-relation-metadata.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { EncryptionSettings } from '../../global/model-registry/encryption-descriptor';
import { ModelRegistry, ModelRegistryData } from '../../global/model-registry/model.registry';
import { StringValueDescriptor } from '../../global/model-registry/string-value-descriptor.model';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { PropertyMetadata } from '../decorators/property.decorator';

/**
 * A selection in the one shape it is walked in: each property it names, holding `true` for the whole
 * value or the selection of what the value holds.
 */
export type SelectionTree = ReadonlyMap<string, SelectionTree | true>;

/**
 * Utilities for the selection a read narrows its rows to.
 */
export abstract class EntitySelectionUtilities {
    /**
     * Reads a selection, in either of the forms a caller writes it, into the one shape it is walked in.
     * @param selection - The selection as the caller wrote it.
     * @returns The tree, or undefined for a read that selects nothing and so hands back whole rows.
     */
    static resolveTree<T>(selection: EntitySelection<T> | undefined): SelectionTree | undefined {
        return selection == undefined ? undefined : this.treeOf(selection);
    }

    /**
     * Refuses a selection that names what the read cannot hand back, before the read runs.
     *
     * A property the entity does not declare, a reach into a value that holds no properties of its
     * own, and a reach into a relation the read does not include: the last is what `relations` is for,
     * and a selection only ever narrows what that includes.
     * @param tree - The selection.
     * @param entityClass - The entity it selects from.
     * @param relations - The relations the read includes, the entity's default ones among them.
     * @throws When the selection names something the read cannot hand back.
     */
    static validateImpossibleSelect(tree: SelectionTree, entityClass: Newable<unknown>, relations: RelationTree): void {
        this.validateLevel(tree, entityClass, relations, entityClass, []);
    }

    /**
     * Finds the properties a selection names whose value can only be handed back by reading their
     * whole row: an `exclude` decided by a function, or an encryption decided by one, is handed the
     * row - and a row narrowed to the selection is not the row it decides on.
     *
     * Only what is selected counts. A property that is not selected is not handed back, whatever
     * its function would have decided.
     * @param tree - The selection.
     * @param entityClass - The entity it selects from.
     * @returns Each such property, as `Entity.property`. Empty when the selection can be read as it is.
     */
    static findPropertiesNeedingWholeRow(tree: SelectionTree, entityClass: Newable<unknown>): string[] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const registered: ModelRegistryData<unknown> = ModelRegistry.get(entityClass);
        const excluded: ReadonlyMap<string, unknown> = registered.excludeDescriptor.keys;
        const encrypted: ReadonlyMap<string, StringValueDescriptor<EncryptionSettings>> = registered.encryptionDescriptor.keys;
        const res: string[] = [];
        for (const [key, below] of tree) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (isRelationMetadata(metadata)) {
                // a related row is read through its own columns, so it is judged on its own
                if (below !== true) {
                    res.push(...this.findPropertiesNeedingWholeRow(below, metadata.target()));
                }
                continue;
            }
            const encryption: StringValueDescriptor<EncryptionSettings> | undefined = encrypted.get(key);
            if (typeof excluded.get(key) === 'function' || (encryption != undefined && this.decidesByFunction(encryption))) {
                res.push(`${entityClass.name}.${key}`);
            }
        }
        return res;
    }

    /**
     * Narrows a row to what a selection names, its id kept when it is an entity's.
     *
     * A value hidden by `exclude` stays hidden: it is carried over as the hidden property it is.
     * @param value - The row, or a value below it.
     * @param tree - The selection at this level.
     * @param cls - The class the value is an instance of.
     * @returns A narrowed copy.
     */
    static project<T>(value: T, tree: SelectionTree, cls: Newable<unknown>): T {
        if (value == undefined || typeof value !== 'object') {
            return value;
        }
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        const res: Record<string, unknown> = {};
        this.copyProperty(value, res, 'id');
        for (const [key, below] of tree) {
            if (below === true) {
                this.copyProperty(value, res, key);
                continue;
            }
            const metadata: PropertyMetadata | undefined = properties[key];
            const inner: Newable<unknown> | undefined = metadata == undefined ? undefined : this.findClassBelow(metadata);
            const held: unknown = Reflect.get(value, key);
            if (inner == undefined || held == undefined) {
                this.copyProperty(value, res, key);
                continue;
            }
            res[key] = Array.isArray(held)
                ? held.map((item: unknown) => this.project(item, below, inner))
                : this.project(held, below, inner);
        }
        // the narrowed row stands for the row it was taken from
        return Object.setPrototypeOf(res, Object.getPrototypeOf(value) as object | null) as T;
    }

    /**
     * Adds properties to a selection, the whole value of each, unless it names them already.
     * @param tree - The selection.
     * @param keys - The properties to add.
     * @returns The selection naming them too.
     */
    static withKeys(tree: SelectionTree, keys: string[]): SelectionTree {
        const res: Map<string, SelectionTree | true> = new Map(tree);
        for (const key of keys) {
            if (!res.has(key)) {
                res.set(key, true);
            }
        }
        return res;
    }

    private static treeOf(selection: unknown): SelectionTree {
        const res: Map<string, SelectionTree | true> = new Map();
        if (Array.isArray(selection)) {
            for (const key of selection) {
                res.set(String(key), true);
            }
            return res;
        }
        for (const [key, below] of Object.entries(selection as object)) {
            if (below === true) {
                res.set(key, true);
                continue;
            }
            if (below != undefined && typeof below === 'object') {
                res.set(key, this.treeOf(below));
            }
        }
        return res;
    }

    private static validateLevel(
        tree: SelectionTree,
        cls: Newable<unknown>,
        relations: RelationTree | undefined,
        entityClass: Newable<unknown>,
        path: string[]
    ): void {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        for (const [key, below] of tree) {
            const at: string[] = [...path, key];
            const metadata: PropertyMetadata | undefined = properties[key];
            if (metadata == undefined) {
                throw new InternalError(`${entityClass.name}: the selection names "${at.join('.')}", which ${cls.name} does not declare.`);
            }
            if (isRelationMetadata(metadata)) {
                const included: RelationTree | undefined = relations?.get(key);
                if (included == undefined) {
                    throw new InternalError([
                        `${entityClass.name}: the selection names "${at.join('.')}", but the relation "${key}" of ${cls.name}`
                        + ' is not included in the read\'s relations.',
                        `Include it with { relations: ${this.relationsNaming(at)} }, or leave it out of the selection.`
                    ]);
                }
                if (below !== true) {
                    this.validateLevel(below, metadata.target(), included, entityClass, at);
                }
                continue;
            }
            if (below === true) {
                continue;
            }
            const inner: Newable<unknown> | undefined = this.findClassBelow(metadata);
            if (inner == undefined) {
                throw new InternalError(
                    `${entityClass.name}: the selection reaches into "${at.join('.')}",`
                    + ` which holds a ${metadata.type} rather than properties of its own.`
                );
            }
            // an object holds no relations of its own, so nothing below it is included
            this.validateLevel(below, inner, undefined, entityClass, at);
        }
    }

    /**
     * Writes the relations a selection path needs, in the form a caller passes them.
     * @param path - The path, ending in the property reached through the last relation.
     * @returns The relations, eg. `{ address: true }`.
     */
    private static relationsNaming(path: string[]): string {
        const relationsPath: string[] = path.slice(0, -1);
        const innermost: string = path.at(-1) ?? '';
        const named: string[] = relationsPath.length ? relationsPath : [innermost];
        return named.reduceRight((inner: string, key: string) => `{ ${key}: ${inner} }`, 'true');
    }

    /**
     * Finds the class a selection reaches into below a property: what an object property holds, or the
     * item of an array of objects.
     * @param metadata - The property.
     * @returns The class, or undefined when the property holds no properties of its own.
     */
    private static findClassBelow(metadata: PropertyMetadata): Newable<unknown> | undefined {
        if (isRelationMetadata(metadata)) {
            return metadata.target();
        }
        if (metadata.type === 'object') {
            return metadata.cls();
        }
        return metadata.type === 'array' && metadata.items.type === 'object' ? metadata.items.cls() : undefined;
    }

    /**
     * Whether an encrypted property decides how it is encrypted or decrypted by a function, which is
     * handed the row.
     * @param descriptor - Where the encrypted strings sit in the property's value, with their settings.
     * @returns True when any of them does.
     */
    private static decidesByFunction(descriptor: StringValueDescriptor<EncryptionSettings>): boolean {
        switch (descriptor.kind) {
            case 'string': {
                const settings: EncryptionSettings = descriptor.settings;
                return typeof settings === 'function'
                    || (typeof settings === 'object' && typeof Reflect.get(settings, 'decrypt') === 'function');
            }
            case 'items': {
                return this.decidesByFunction(descriptor.items);
            }
            case 'shapes': {
                return [...descriptor.shapes.values()].some(shape => this.decidesByFunction(shape));
            }
        }
    }

    /**
     * Copies one property of a row onto its narrowed copy, a hidden one as hidden.
     * @param from - The row.
     * @param to - The narrowed copy.
     * @param key - The property.
     */
    private static copyProperty(from: object, to: Record<string, unknown>, key: string): void {
        const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(from, key);
        if (descriptor == undefined) {
            return;
        }
        Object.defineProperty(to, key, descriptor);
    }
}