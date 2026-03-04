import { ControllerRouteConfiguration } from '../../routing/controller-route-configuration.model';
import { Newable } from '../../types/newable.type';
import { MetadataInjectionKeys } from '../../utilities/metadata-injection-keys.enum';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ReflectUtilities } from '../../utilities/reflect.utilities';
import type { PropertyMetadata } from '../decorators/property.decorator';

// eslint-disable-next-line jsdoc/require-jsdoc
export function getAllPrototypeKeys<T>(Clazz: Newable<T>, omitKeys: (keyof T)[]): (keyof T)[] {
    const keys: Set<keyof T> = new Set<keyof T>();
    // eslint-disable-next-line typescript/no-unsafe-assignment
    let proto: object | undefined = Clazz.prototype ?? undefined;
    while (proto && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (['constructor', ...omitKeys].includes(name)) {
                continue;
            }
            keys.add(name as keyof T);
        }
        for (const sym of Object.getOwnPropertySymbols(proto)) {
            if (omitKeys.includes(sym as keyof T)) {
                continue;
            }
            keys.add(sym as keyof T);
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        proto = Object.getPrototypeOf(proto);
    }
    return Array.from(keys);
}

// eslint-disable-next-line jsdoc/require-jsdoc
export function getAllClassKeys<T>(Clazz: Newable<T>, omitKeys: (keyof T)[]): (keyof T)[] {
    const keys: Set<keyof T> = new Set<keyof T>();
    // static/constructor keys (walk constructor chain)
    let ctor: Function | null = Clazz;
    while (ctor && ctor !== Function.prototype) {
        for (const name of Object.getOwnPropertyNames(ctor)) {
            if (['prototype', 'length', 'name', ...omitKeys].includes(name)) {
                continue;
            }
            keys.add(name as keyof T);
        }
        for (const sym of Object.getOwnPropertySymbols(ctor)) {
            if (omitKeys.includes(sym as keyof T)) {
                continue;
            }
            keys.add(sym as keyof T);
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        ctor = Object.getPrototypeOf(ctor);
    }

    return Array.from(keys);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getOwnDescriptorFromProtoChain(protoRoot: Object, key: PropertyKey): PropertyDescriptor | undefined {
    let p: object | null = protoRoot;
    while (p && p !== Object.prototype) {
        const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(p, key);
        if (desc) {
            return desc;
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        p = Object.getPrototypeOf(p);
    }
    return undefined;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getOwnDescriptorFromClassChain(ctorRoot: Function, key: PropertyKey): PropertyDescriptor | undefined {
    let c: Function | null = ctorRoot;
    while (c && c !== Function.prototype) {
        const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(c, key);
        if (desc) {
            return desc;
        }
        // eslint-disable-next-line typescript/no-unsafe-assignment
        c = Object.getPrototypeOf(c);
    }
    return undefined;
}

/**
 * Copies the properties of the SourceClass onto the TargetClass, omitting the provided keys.
 * @param TargetClass - The class to copy the properties onto.
 * @param SourceClass - The class which properties should be copied.
 * @param omitKeys - Any keys that should be left out from copying.
 */
export function copyClassProperties<T, S>(
    TargetClass: Newable<T>,
    SourceClass: Newable<S>,
    omitKeys: (keyof S)[]
): void {
    const protoKeys: (keyof S)[] = getAllPrototypeKeys(SourceClass, omitKeys);
    for (const key of protoKeys) {
        // eslint-disable-next-line typescript/no-unsafe-argument
        const desc: PropertyDescriptor | undefined = getOwnDescriptorFromProtoChain(SourceClass.prototype, key);
        if (!desc) {
            continue;
        }
        Object.defineProperty(TargetClass.prototype, key, desc);
    }

    const classKeys: (keyof S)[] = getAllClassKeys(SourceClass, omitKeys);
    for (const key of classKeys) {
        const desc: PropertyDescriptor | undefined = getOwnDescriptorFromClassChain(SourceClass, key);
        if (!desc) {
            continue;
        }
        Object.defineProperty(TargetClass, key, desc);
    }

    const allKeys: (keyof S)[] = [...protoKeys, ...classKeys];

    const filteredBaseModelProperties: Record<string, PropertyMetadata> = { ...MetadataUtilities.getModelProperties(SourceClass) };
    for (const key of omitKeys) {
        // eslint-disable-next-line typescript/no-dynamic-delete
        delete filteredBaseModelProperties[key as string];
    }
    const existingModelProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(TargetClass);
    MetadataUtilities.setModelProperties(
        TargetClass,
        { ...existingModelProperties, ...filteredBaseModelProperties }
    );

    const baseRoutes: ControllerRouteConfiguration[] = MetadataUtilities
        .getControllerRoutes(SourceClass)
        .filter(r => allKeys.includes(r.controllerMethod as keyof S));
    const existingRoutes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(TargetClass);
    MetadataUtilities.setControllerRoutes(
        TargetClass,
        [...existingRoutes, ...baseRoutes]
    );

    for (const prop of allKeys) {
        for (const metaKey of ReflectUtilities.getMetadataKeys(SourceClass, prop as string)) {
            const val: unknown = ReflectUtilities.getMetadata(metaKey as MetadataInjectionKeys, SourceClass, prop as string);
            ReflectUtilities.setMetadata(metaKey as MetadataInjectionKeys, val, TargetClass, prop as string);
        }
    }
}