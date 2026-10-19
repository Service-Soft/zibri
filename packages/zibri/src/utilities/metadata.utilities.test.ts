import { describe, expect, it } from '@jest/globals';

import { MetadataUtilities } from './metadata.utilities';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { Property, PropertyMetadata } from '../entity/decorators/property.decorator';
import { PartialClass } from '../entity/partial-class.model';
import { MimeType } from '../http/mime-type.enum';
import { BodyMetadata } from '../routing/decorators/body-metadata.model';
import { Newable } from '../types/newable.type';

/**
 * A project's own decorator, built on one of the framework's.
 * @returns The decorator.
 */
function TenantDataSource(): ClassDecorator {
    return target => DataSource({ allowOrphan: true, register: 'onUse' })(target);
}

describe('MetadataUtilities — the file a class is declared in', () => {
    it('records the file of a class decorated by a framework decorator', () => {
        @Injectable({ register: 'onUse' })
        class Service {}

        expect(MetadataUtilities.getFilePath(Service)).toBe(__filename);
    });

    it('records the file of a class decorated through a project\'s own decorator', () => {
        // read at a fixed depth of the stack, which this decorator's extra frames moved into reflect-metadata
        @TenantDataSource()
        class TenantDb {}

        expect(MetadataUtilities.getFilePath(TenantDb)).toBe(__filename);
    });

    it('records the file of a class declared inside a function', () => {
        const declare: () => Function = () => {
            class Declared {
                @Property.string()
                name!: string;
            }
            return Declared;
        };

        expect(MetadataUtilities.getFilePath(declare())).toBe(__filename);
    });

    it('answers unknown when it was not called from a decorator', () => {
        class Undecorated {}
        MetadataUtilities.setFilePath(Undecorated);

        expect(MetadataUtilities.getFilePath(Undecorated)).toBe('unknown');
    });
});

describe('MetadataUtilities — Reflect-metadata based inheritance (getRouteBody/setRouteBody)', () => {
    it('returns own metadata directly when set on the class itself', () => {
        class Controller {}
        const body: BodyMetadata = { type: 'application/json' } as BodyMetadata;
        MetadataUtilities.setRouteBody(Controller, body, 'method');

        expect(MetadataUtilities.getRouteBody(Controller, 'method')).toEqual(body);
    });

    it('inherits metadata from a parent class when the child has none of its own', () => {
        class Parent {}
        class Child extends Parent {}
        const body: BodyMetadata = { type: 'application/json' } as BodyMetadata;
        MetadataUtilities.setRouteBody(Parent, body, 'method');

        expect(MetadataUtilities.getRouteBody(Child, 'method')).toEqual(body);
    });

    it('walks multiple levels of inheritance to find ancestor metadata', () => {
        class GrandParent {}
        class Parent extends GrandParent {}
        class Child extends Parent {}
        const body: BodyMetadata = { type: 'application/json' } as BodyMetadata;
        MetadataUtilities.setRouteBody(GrandParent, body, 'method');

        expect(MetadataUtilities.getRouteBody(Child, 'method')).toEqual(body);
    });

    it('prefers the child\'s own metadata over an inherited one', () => {
        class Parent {}
        class Child extends Parent {}
        const parentBody: BodyMetadata = { type: 'application/json' } as BodyMetadata;
        const childBody: BodyMetadata = { type: 'multipart/form-data' } as BodyMetadata;
        MetadataUtilities.setRouteBody(Parent, parentBody, 'method');
        MetadataUtilities.setRouteBody(Child, childBody, 'method');

        expect(MetadataUtilities.getRouteBody(Child, 'method')).toEqual(childBody);
    });

    it('returns a clone, so mutating the child\'s resolved metadata does not affect the parent\'s stored value', () => {
        class Parent {}
        class Child extends Parent {}
        const body: BodyMetadata = { type: 'application/json' } as BodyMetadata;
        MetadataUtilities.setRouteBody(Parent, body, 'method');

        const resolved: BodyMetadata = MetadataUtilities.getRouteBody(Child, 'method') as BodyMetadata;
        (resolved as { type: string }).type = 'mutated';

        expect(MetadataUtilities.getRouteBody(Parent, 'method')?.type).toBe('application/json');
    });

    it('keeps metadata scoped per controllerMethod', () => {
        class Controller {}
        const bodyA: BodyMetadata = { type: 'application/json' } as BodyMetadata;
        MetadataUtilities.setRouteBody(Controller, bodyA, 'methodA');

        expect(MetadataUtilities.getRouteBody(Controller, 'methodA')).toEqual(bodyA);
        expect(MetadataUtilities.getRouteBody(Controller, 'methodB')).toBeUndefined();
    });

    it('returns undefined when no metadata is set anywhere in the chain', () => {
        class Controller {}
        expect(MetadataUtilities.getRouteBody(Controller, 'method')).toBeUndefined();
    });

    it('does not inherit sibling class metadata that shares only a common (unrelated) ancestor', () => {
        class Base {}
        class SiblingA extends Base {}
        class SiblingB extends Base {}
        const body: BodyMetadata = { type: 'application/json' } as BodyMetadata;
        MetadataUtilities.setRouteBody(SiblingA, body, 'method');

        expect(MetadataUtilities.getRouteBody(SiblingB, 'method')).toBeUndefined();
    });
});

describe('MetadataUtilities — WeakMap based inheritance (getModelProperties/setModelProperties)', () => {
    it('returns own model properties directly when set on the class itself', () => {
        class Model {}
        const properties: Record<string, PropertyMetadata> = { name: { type: 'string' } as PropertyMetadata };
        MetadataUtilities.setModelProperties(Model, properties);

        expect(MetadataUtilities.getModelProperties(Model)).toEqual(properties);
    });

    it('inherits properties from a parent model when the child sets none of its own', () => {
        class ParentModel {}
        class ChildModel extends ParentModel {}
        const properties: Record<string, PropertyMetadata> = { name: { type: 'string' } as PropertyMetadata };
        MetadataUtilities.setModelProperties(ParentModel, properties);

        expect(MetadataUtilities.getModelProperties(ChildModel)).toEqual(properties);
    });

    it('gives the child its own object, so mutating the child\'s properties does not affect the parent\'s', () => {
        class ParentModel {}
        class ChildModel extends ParentModel {}
        const properties: Record<string, PropertyMetadata> = { name: { type: 'string' } as PropertyMetadata };
        MetadataUtilities.setModelProperties(ParentModel, properties);

        const childProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(ChildModel);
        childProps['extra'] = { type: 'number' } as PropertyMetadata;

        expect(MetadataUtilities.getModelProperties(ParentModel)).toEqual(properties);
        expect(MetadataUtilities.getModelProperties(ParentModel)['extra']).toBeUndefined();
    });

    it('refuses a change to a declaration and to its nested parts, which the models derived from it share', () => {
        class Upload {
            @Property.file({ allowedMimeTypes: [MimeType.PNG] })
            file!: unknown;

            @Property.array({ items: { type: 'string' } })
            tags!: string[];
        }
        const PartialUpload: Newable<Partial<Upload>> = PartialClass(Upload);
        const { file, tags } = MetadataUtilities.getModelProperties(Upload);
        if (file?.type !== 'file' || file.allowedMimeTypes === 'all' || tags?.type !== 'array') {
            throw new Error('The properties are not declared as written above.');
        }

        expect(Reflect.set(file, 'required', false)).toBe(false);
        expect(Reflect.set(file.allowedMimeTypes, 0, MimeType.HTML)).toBe(false);
        expect(Reflect.set(tags.items, 'type', 'number')).toBe(false);
        expect(MetadataUtilities.getModelProperties(PartialUpload)['file']).toMatchObject({ allowedMimeTypes: [MimeType.PNG] });
    });

    it('lets a derived model declare a property again in place of the one it inherited', () => {
        class Upload {
            @Property.array({ items: { type: 'string' } })
            tags!: string[];
        }
        class OptionalUpload extends Upload {
            @Property.array({ items: { type: 'string' }, required: false })
            override tags: string[] = [];
        }

        expect(MetadataUtilities.getModelProperties(OptionalUpload)['tags']?.required).toBe(false);
        expect(MetadataUtilities.getModelProperties(Upload)['tags']?.required).toBe(true);
    });

    it('returns an empty object when nothing has been set anywhere in the chain', () => {
        class Model {}
        expect(MetadataUtilities.getModelProperties(Model)).toEqual({});
    });

    it('lets a child override a specific property while keeping other inherited properties', () => {
        class ParentModel {}
        class ChildModel extends ParentModel {}
        MetadataUtilities.setModelProperties(ParentModel, {
            name: { type: 'string' } as PropertyMetadata,
            age: { type: 'number' } as PropertyMetadata
        });
        MetadataUtilities.setModelProperties(ChildModel, {
            name: { type: 'string' } as PropertyMetadata,
            age: { type: 'number' } as PropertyMetadata,
            extra: { type: 'boolean' } as PropertyMetadata
        });

        expect(MetadataUtilities.getModelProperties(ChildModel)).toEqual({
            name: { type: 'string' },
            age: { type: 'number' },
            extra: { type: 'boolean' }
        });
    });
});