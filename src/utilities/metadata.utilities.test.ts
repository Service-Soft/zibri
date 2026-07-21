import { describe, expect, it } from '@jest/globals';

import { MetadataUtilities } from './metadata.utilities';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { BodyMetadata } from '../routing/decorators/body.decorator';

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