import { CheckConstraintViolationError } from '../../data-source/check-constraint-violation.error';
import type { XmlPropertyMetadata } from '../../parsing/xml/xml-property-metadata.model';
import type { ControllerRouteConfiguration } from '../../routing/controller-route-configuration.model';
import { Newable } from '../../types/newable.type';
import { MetadataInjectionKeys } from '../../utilities/metadata-injection-keys.enum';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ReflectUtilities } from '../../utilities/reflect.utilities';
import type { PropertyMetadata } from '../decorators/property.decorator';
import type { EntityCheck } from '../models/entity-check.model';

/**
 * Copies what a class defines onto another: the members of its prototype and constructor chains,
 * and the metadata the decorators recorded for them.
 */
export abstract class ClassPropertyUtilities {

    /**
     * Copies the properties of a class onto another, leaving out the given keys.
     *
     * A member the target already has under a name the source defines is replaced, with its metadata
     * and, on a controller, with its route.
     * @param TargetClass - The class to copy the properties onto.
     * @param SourceClass - The class whose properties are copied.
     * @param omitKeys - The keys left out of the copy.
     */
    static copy<T, S>(TargetClass: Newable<T>, SourceClass: Newable<S>, omitKeys: (keyof S)[]): void {
        const protoKeys: (keyof S)[] = ClassPropertyUtilities.resolvePrototypeKeys(SourceClass, omitKeys);
        for (const key of protoKeys) {
            // eslint-disable-next-line typescript/no-unsafe-argument
            const desc: PropertyDescriptor | undefined = ClassPropertyUtilities.findDescriptorInPrototypeChain(SourceClass.prototype, key);
            if (!desc) {
                continue;
            }
            Object.defineProperty(TargetClass.prototype, key, desc);
        }

        const classKeys: (keyof S)[] = ClassPropertyUtilities.resolveStaticKeys(SourceClass, omitKeys);
        for (const key of classKeys) {
            const desc: PropertyDescriptor | undefined = ClassPropertyUtilities.findDescriptorInStaticChain(SourceClass, key);
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

        // how a property it keeps is written in xml comes along with it, as a subclass inherits it
        const keptXmlProperties: [string, XmlPropertyMetadata][] = Object.entries(MetadataUtilities.getXmlProperties(SourceClass))
            .filter(([key]) => !omitKeys.includes(key as keyof S));
        if (keptXmlProperties.length) {
            MetadataUtilities.setXmlProperties(
                TargetClass,
                { ...MetadataUtilities.getXmlProperties(TargetClass), ...Object.fromEntries(keptXmlProperties) }
            );
        }

        // a check comes along only with every property it compares: one comparing a property the copy
        // left out is about a value its bodies never hold
        const keptProperties: string[] = Object.keys(MetadataUtilities.getModelProperties(TargetClass));
        const carriedChecks: EntityCheck[] = MetadataUtilities.resolveModelChecks(SourceClass)
            .filter(check => CheckConstraintViolationError.resolveProperties(check.where).every(p => keptProperties.includes(p)));
        if (carriedChecks.length) {
            MetadataUtilities.setModelChecks(TargetClass, [...MetadataUtilities.resolveModelChecks(TargetClass), ...carriedChecks]);
        }

        const baseRoutes: ControllerRouteConfiguration[] = MetadataUtilities
            .getControllerRoutes(SourceClass)
            .filter(r => allKeys.includes(r.controllerMethod as keyof S));
        // a route the target holds for a method the source defines was the route of the
        // implementation replaced above. Kept, it registered that route a second time, on the
        // method that just took its place
        const existingRoutes: ControllerRouteConfiguration[] = MetadataUtilities
            .getControllerRoutes(TargetClass)
            .filter(r => !allKeys.includes(r.controllerMethod as keyof S));
        MetadataUtilities.setControllerRoutes(
            TargetClass,
            [...existingRoutes, ...baseRoutes]
        );

        for (const prop of allKeys) {
            // what an earlier base of an intersection declared for the member goes with its
            // implementation: kept, an `@Auth.skip` of the first base opened the last base's route
            ReflectUtilities.deleteOwnMetadata(TargetClass, prop as string);
            for (const metaKey of ReflectUtilities.getMetadataKeys(SourceClass, prop as string)) {
                const val: unknown = ReflectUtilities.getMetadata(metaKey as MetadataInjectionKeys, SourceClass, prop as string);
                ReflectUtilities.setMetadata(metaKey as MetadataInjectionKeys, val, TargetClass, prop as string);
            }
        }

        ClassPropertyUtilities.carryControllerChecks(TargetClass, SourceClass, baseRoutes.map(route => route.controllerMethod));
    }

    /**
     * Declares the checks a controller declares on its class on each of its routes the copy takes
     * over, where the route declares nothing of the kind itself.
     *
     * The copy is a class of its own, not one extending the source, so it inherits nothing the source
     * declares on its class. Declared on the route, a check holds for that route alone, which is what
     * it held for before: an intersection's bases may guard their routes differently. A skip on the
     * class is not carried, as a class extending the source does not inherit one either.
     * @param TargetClass - The class the routes were copied onto.
     * @param SourceClass - The class they were copied from.
     * @param methods - The methods of the copied routes.
     */
    private static carryControllerChecks<T, S>(TargetClass: Newable<T>, SourceClass: Newable<S>, methods: string[]): void {
        for (const method of methods) {
            if (MetadataUtilities.getRouteSkipAuth(SourceClass, method) != undefined) {
                continue;
            }
            ClassPropertyUtilities.carryControllerCheck(
                MetadataUtilities.getControllerIsLoggedIn(SourceClass),
                MetadataUtilities.getRouteIsLoggedIn(SourceClass, method) ?? MetadataUtilities.getRouteSkipIsLoggedIn(SourceClass, method),
                check => MetadataUtilities.setRouteIsLoggedIn(TargetClass, check, method)
            );
            ClassPropertyUtilities.carryControllerCheck(
                MetadataUtilities.getControllerIsNotLoggedIn(SourceClass),
                MetadataUtilities.getRouteIsNotLoggedIn(SourceClass, method)
                ?? MetadataUtilities.getRouteSkipIsNotLoggedIn(SourceClass, method),
                check => MetadataUtilities.setRouteIsNotLoggedIn(TargetClass, check, method)
            );
            ClassPropertyUtilities.carryControllerCheck(
                MetadataUtilities.getControllerHasPermission(SourceClass),
                MetadataUtilities.getRouteHasPermission(SourceClass, method)
                ?? MetadataUtilities.getRouteSkipHasPermission(SourceClass, method),
                check => MetadataUtilities.setRouteHasPermission(TargetClass, check, method)
            );
            ClassPropertyUtilities.carryControllerCheck(
                MetadataUtilities.getControllerHasPlatformPermission(SourceClass),
                MetadataUtilities.getRouteHasPlatformPermission(SourceClass, method)
                ?? MetadataUtilities.getRouteSkipHasPlatformPermission(SourceClass, method),
                check => MetadataUtilities.setRouteHasPlatformPermission(TargetClass, check, method)
            );
            ClassPropertyUtilities.carryControllerCheck(
                MetadataUtilities.getControllerRequire2fa(SourceClass),
                MetadataUtilities.getRouteRequire2fa(SourceClass, method) ?? MetadataUtilities.getRouteSkipRequire2fa(SourceClass, method),
                check => MetadataUtilities.setRouteRequire2fa(TargetClass, check, method)
            );
        }
    }

    /**
     * Declares a check of a class on a route, unless the route declares the check or its skip.
     * @param controllerCheck - The check the class declares, if any.
     * @param routeDeclaration - The check or skip of that kind the route declares, if any.
     * @param declare - Declares the check on the copied route.
     */
    private static carryControllerCheck<Check>(
        controllerCheck: Check | undefined,
        routeDeclaration: object | undefined,
        declare: (check: Check) => void
    ): void {
        if (controllerCheck != undefined && routeDeclaration == undefined) {
            declare(controllerCheck);
        }
    }

    /**
     * Resolves the keys the prototype chain of a class defines, the constructor left out.
     * @param Clazz - The class.
     * @param omitKeys - The keys left out.
     * @returns The keys, each once.
     */
    static resolvePrototypeKeys<T>(Clazz: Newable<T>, omitKeys: (keyof T)[]): (keyof T)[] {
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

    /**
     * Resolves the static keys the constructor chain of a class defines, the ones every function has
     * left out.
     * @param Clazz - The class.
     * @param omitKeys - The keys left out.
     * @returns The keys, each once.
     */
    static resolveStaticKeys<T>(Clazz: Newable<T>, omitKeys: (keyof T)[]): (keyof T)[] {
        const keys: Set<keyof T> = new Set<keyof T>();
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

    /**
     * Finds the descriptor of a key on the nearest object of a prototype chain that has it.
     * @param protoRoot - The prototype the chain starts at.
     * @param key - The key.
     * @returns The descriptor, or undefined when no object of the chain has the key.
     */
    private static findDescriptorInPrototypeChain(protoRoot: Object, key: PropertyKey): PropertyDescriptor | undefined {
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

    /**
     * Finds the descriptor of a static key on the nearest constructor of a class chain that has it.
     * @param ctorRoot - The constructor the chain starts at.
     * @param key - The key.
     * @returns The descriptor, or undefined when no constructor of the chain has the key.
     */
    private static findDescriptorInStaticChain(ctorRoot: Function, key: PropertyKey): PropertyDescriptor | undefined {
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
}