import { OrderConfig } from 'zibri-contract';

import { Property, PropertyMetadata } from '../../entity/decorators/property.decorator';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { Relation } from '../../entity/models/relation.enum';
import { InternalError } from '../../error-handling/internal-error.model';
import { OneOfDescriptors } from '../../global/model-registry/model-descriptor';
import { ModelRegistry } from '../../global/model-registry/model.registry';
import { isOrderable, OrderDescriptor } from '../../global/model-registry/order-descriptor';
import { AnyEnum } from '../../types/any-enum.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * The directions a list can be ordered in.
 */
const ORDER_DIRECTIONS: AnyEnum<string> = { ASC: 'ASC', DESC: 'DESC' };

/**
 * The relations that hold one row, which an order can reach through.
 */
const TO_ONE_RELATIONS: readonly string[] = [Relation.MANY_TO_ONE, Relation.BELONGS_TO_ONE, Relation.HAS_ONE];

/**
 * A level of an order config as it is at runtime: `true` or the config of the properties inside, by property.
 */
type OrderConfigLevel = Record<string, unknown>;

/**
 * Utilities for the order a CrudController lists the rows of an entity in.
 */
export abstract class CrudControllerOrderUtilities {
    /**
     * Resolves the class the order of a request is validated with: `'ASC'` or `'DESC'` for each property the list may
     * be ordered by, nested like the entity. Without a config these are the strings, numbers, booleans and dates of
     * the entity and of the objects inside it that hold their value as it is; a config names them, and the ones of the
     * relations to one row as well.
     * @param entityClass - The entity.
     * @param config - The properties the list may be ordered by, or undefined for the ones without a config.
     * @returns The class, or undefined when the list can't be ordered by anything.
     * @throws {InternalError} When the config names something a list can't be ordered by: a property the entity lacks,
     * an array, a relation to many rows, or an excluded, encrypted or hashed property or a password.
     */
    static resolveOrderClass<T extends object>(entityClass: Newable<T>, config: OrderConfig<T> | undefined): Newable<object> | undefined {
        return config == undefined
            ? CrudControllerOrderUtilities.resolveDefaultClass(entityClass)
            : CrudControllerOrderUtilities.resolveConfigClass(config, entityClass, entityClass.name);
    }

    private static resolveDefaultClass(cls: Newable<object>): Newable<object> | undefined {
        const descriptor: OrderDescriptor = ModelRegistry.get(cls).orderDescriptor;
        return descriptor.hasAnything() ? CrudControllerOrderUtilities.resolveDescriptorClass(cls, descriptor, new Map()) : undefined;
    }

    /**
     * Resolves the order class of what a descriptor says a list can be ordered by. An object that holds one of its own
     * kind, or of a kind it is inside, gets the class already resolved for it, so the class is as deep as the data.
     * @param cls - The class of the descriptor.
     * @param descriptor - The descriptor.
     * @param resolved - The classes resolved so far, by their descriptor.
     * @returns The order class.
     */
    private static resolveDescriptorClass(
        cls: Newable<object>,
        descriptor: OrderDescriptor,
        resolved: Map<OrderDescriptor, Newable<object>>
    ): Newable<object> {
        const known: Newable<object> | undefined = resolved.get(descriptor);
        if (known != undefined) {
            return known;
        }
        // eslint-disable-next-line jsdoc/require-jsdoc
        class Order {}
        Object.defineProperty(Order, 'name', { value: `${cls.name}Order` });
        resolved.set(descriptor, Order);
        for (const key of descriptor.keys.keys()) {
            Property.string({ enum: ORDER_DIRECTIONS, required: false })(Order.prototype, key);
        }
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        for (const [key, nested] of descriptor.nestedKeys) {
            const metadata: PropertyMetadata | undefined = properties[key];
            // the descriptor follows objects alone, each by the descriptor of its class
            if (metadata?.type !== 'object' || nested instanceof OneOfDescriptors) {
                continue;
            }
            const nestedClass: Newable<object> = CrudControllerOrderUtilities.resolveDescriptorClass(
                metadata.cls() as Newable<object>,
                nested,
                resolved
            );
            Property.object({ cls: () => nestedClass, required: false })(Order.prototype, key);
        }
        return Order;
    }

    private static resolveConfigClass(config: OrderConfigLevel, cls: Newable<object>, path: string): Newable<object> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        class Order {}
        Object.defineProperty(Order, 'name', { value: `${cls.name}Order` });
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        for (const [key, entry] of Object.entries(config)) {
            const name: string = `A list of ${path} can't be ordered by "${key}"`;
            const metadata: PropertyMetadata | undefined = properties[key];
            if (metadata == undefined) {
                throw new InternalError(`${name}, which ${cls.name} doesn't have.`);
            }
            if (entry === true) {
                if (!isOrderable(metadata)) {
                    throw new InternalError(
                        `${name}: only by a string, number, boolean or date that holds its value as it is,`
                        + ' not by an excluded, encrypted or hashed property or a password.'
                    );
                }
                Property.string({ enum: ORDER_DIRECTIONS, required: false })(Order.prototype, key);
                continue;
            }
            const nestedClass: Newable<object> | undefined = CrudControllerOrderUtilities.findNestedClass(metadata);
            if (typeof entry !== 'object' || entry == undefined || nestedClass == undefined) {
                throw new InternalError(
                    `${name}: only by the properties of an object or of a relation to one row, not of an array or a relation to many.`
                );
            }
            const nested: Newable<object> = CrudControllerOrderUtilities.resolveConfigClass({ ...entry }, nestedClass, `${path}.${key}`);
            Property.object({ cls: () => nested, required: false })(Order.prototype, key);
        }
        return Order;
    }

    private static findNestedClass(metadata: PropertyMetadata): Newable<object> | undefined {
        if (isRelationMetadata(metadata)) {
            return TO_ONE_RELATIONS.includes(metadata.type) ? metadata.target() : undefined;
        }
        return metadata.type === 'object' && metadata.exclude === false ? metadata.cls() as Newable<object> : undefined;
    }
}