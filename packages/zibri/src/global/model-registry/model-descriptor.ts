import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model.ts';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function.ts';
import { RelationType } from '../../entity/models/relation-type.enum.ts';
import { isNamedValue } from '../../parsing/functions/parse-one-of.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';

/**
 * What a class that holds nothing nested answers, shared rather than allocated per call.
 */
const NO_NESTED_VALUES: readonly never[] = Object.freeze([]);

/**
 * The descriptors of a value of several named shapes, one per shape that has anything in it.
 *
 * Which of them applies is only known per value, by the shape the value names.
 */
export class OneOfDescriptors<D extends ModelDescriptor<D>> {
    constructor(
        /**
         * The descriptor of each shape, by the name of the shape.
         */
        readonly shapes: ReadonlyMap<string, NestedDescriptor<D>>
    ) {}
}

/**
 * What a property that holds other models is described by: the descriptor of the model it holds, or
 * the descriptors of the shapes it can be.
 */
export type NestedDescriptor<D extends ModelDescriptor<D>> = D | OneOfDescriptors<D>;

/**
 * An object nested in a model, with the descriptor of its class.
 */
export type NestedValue<D extends ModelDescriptor<D>> = {
    /**
     * The object.
     */
    data: object,
    /**
     * The descriptor of its class.
     */
    descriptor: D,
    /**
     * Where the object sits, starting with the key of the property that holds it. The items of an
     * array share the path of the array.
     */
    path: string,
    /**
     * Whether the object is a row of a related entity, rather than a part of the model holding it.
     */
    related: boolean
};

/**
 * What the descriptors of the model registry share: the properties of a class that hold other models,
 * and how to find those models in a value.
 */
export abstract class ModelDescriptor<D extends ModelDescriptor<D>> {
    /**
     * The properties that act on the value directly.
     */
    abstract readonly keys: ReadonlyMap<string, unknown>;

    /**
     * Keys that act on nothing themselves, but hold models that might.
     */
    readonly nestedKeys: Map<string, NestedDescriptor<D>> = new Map();

    /**
     * The nested keys that are relations, whose models are rows of other entities.
     */
    private readonly relationKeys: Set<string> = new Set();

    // eslint-disable-next-line jsdoc-js/require-returns
    /**
     * Whether or not anything in this class or the models it holds is acted on.
     */
    hasAnything(): boolean {
        return this.keys.size > 0 || this.nestedKeys.size > 0;
    }

    /**
     * Finds every object that the nested descriptors apply to in the given value of this class: the
     * value of each nested key, each item of an array, and the value of the shape a value of several
     * shapes names.
     * @param data - A value of the class this descriptor describes.
     * @returns Each object, with the descriptor of its class.
     */
    nestedValues(data: unknown): readonly NestedValue<D>[] {
        // every row a repository hands back passes through here once per hook, and most classes hold
        // nothing nested - so that case costs no allocation
        if (!this.nestedKeys.size || data == undefined || typeof data !== 'object') {
            return NO_NESTED_VALUES;
        }
        const res: NestedValue<D>[] = [];
        for (const [key, nested] of this.nestedKeys) {
            this.collectValues((data as Record<string, unknown>)[key], nested, key, this.relationKeys.has(key), res);
        }
        return res;
    }

    /**
     * How many nested descriptors are registered here, counting each shape of a value of several shapes.
     *
     * What a settle pass of the registry is measured by, so a shape registered on a later pass counts
     * even though the key holding it was registered already.
     * @returns Their number.
     */
    nestedCount(): number {
        let res: number = 0;
        for (const nested of this.nestedKeys.values()) {
            res += this.countOf(nested);
        }
        return res;
    }

    /**
     * Registers the given property as a nested key when the models it holds have anything in them.
     * @param key - The key of the property.
     * @param metadata - The property.
     * @param descriptorOf - Reads the descriptor of a class.
     */
    protected updateNestedKey(key: string, metadata: PropertyMetadata, descriptorOf: (cls: Newable<unknown>) => D): void {
        const nested: NestedDescriptor<D> | undefined = this.build(metadata, descriptorOf);
        if (nested != undefined && this.hasAnythingIn(nested)) {
            this.nestedKeys.set(key, nested);
        }
        if (isRelationMetadata(metadata)) {
            this.relationKeys.add(key);
        }
        else {
            this.relationKeys.delete(key);
        }
    }

    private build(
        metadata: PropertyMetadata | ArrayPropertyItemMetadata,
        descriptorOf: (cls: Newable<unknown>) => D
    ): NestedDescriptor<D> | undefined {
        switch (metadata.type) {
            case RelationType.MANY_TO_ONE:
            case RelationType.HAS_ONE:
            case RelationType.BELONGS_TO_ONE:
            case RelationType.MANY_TO_MANY:
            case RelationType.ONE_TO_MANY: {
                return descriptorOf(metadata.target());
            }
            case 'object': {
                return descriptorOf(metadata.cls());
            }
            case 'array': {
                return this.build(metadata.items, descriptorOf);
            }
            case 'oneOf': {
                const shapes: Map<string, NestedDescriptor<D>> = new Map();
                for (const [name, shape] of ObjectUtilities.entries(metadata.shapes)) {
                    const nested: NestedDescriptor<D> | undefined = this.build(shape, descriptorOf);
                    if (nested != undefined && this.hasAnythingIn(nested)) {
                        shapes.set(name, nested);
                    }
                }
                return new OneOfDescriptors(shapes);
            }
            case 'string':
            case 'number':
            case 'boolean':
            case 'date':
            case 'file':
            case 'unknown': {
                return undefined;
            }
        }
    }

    private hasAnythingIn(nested: NestedDescriptor<D>): boolean {
        return nested instanceof OneOfDescriptors ? nested.shapes.size > 0 : nested.hasAnything();
    }

    private collectValues(value: unknown, nested: NestedDescriptor<D>, path: string, related: boolean, res: NestedValue<D>[]): void {
        if (value == undefined || typeof value !== 'object') {
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                this.collectValues(item, nested, path, related, res);
            }
            return;
        }
        if (!(nested instanceof OneOfDescriptors)) {
            res.push({ data: value, descriptor: nested, path, related });
            return;
        }
        if (!isNamedValue(value)) {
            return;
        }
        const shape: NestedDescriptor<D> | undefined = nested.shapes.get(value.shape);
        if (shape != undefined) {
            this.collectValues(value.value, shape, `${path}.value`, related, res);
        }
    }

    private countOf(nested: NestedDescriptor<D>): number {
        if (!(nested instanceof OneOfDescriptors)) {
            return 1;
        }
        let res: number = 0;
        for (const shape of nested.shapes.values()) {
            res += this.countOf(shape);
        }
        return res;
    }
}