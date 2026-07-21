import { describe, expect, it } from '@jest/globals';

import { MetadataInjectionKeys } from './metadata-injection-keys.enum';
import { ReflectUtilities } from './reflect.utilities';

class Target {
    method(): void {}
}

describe('ReflectUtilities', () => {
    describe('class-level metadata', () => {
        it('sets and gets metadata on a class', () => {
            ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_TOKEN, 'class-value', Target);
            expect(ReflectUtilities.getMetadata(MetadataInjectionKeys.DI_TOKEN, Target)).toBe('class-value');
        });

        it('returns undefined for metadata that was never set', () => {
            class Empty {}
            expect(ReflectUtilities.getMetadata(MetadataInjectionKeys.DI_TOKEN, Empty)).toBeUndefined();
        });
    });

    describe('property-level metadata', () => {
        it('sets and gets metadata on a prototype method, keyed by propertyKey', () => {
            ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_TOKEN, 'method-value', Target, 'method');
            expect(ReflectUtilities.getMetadata(MetadataInjectionKeys.DI_TOKEN, Target, 'method')).toBe('method-value');
        });

        it('keeps class-level and property-level metadata under the same key independent', () => {
            ReflectUtilities.setMetadata(MetadataInjectionKeys.FILE_LOCATION, 'class-scoped', Target);
            ReflectUtilities.setMetadata(MetadataInjectionKeys.FILE_LOCATION, 'method-scoped', Target, 'method');

            expect(ReflectUtilities.getMetadata(MetadataInjectionKeys.FILE_LOCATION, Target)).toBe('class-scoped');
            expect(ReflectUtilities.getMetadata(MetadataInjectionKeys.FILE_LOCATION, Target, 'method')).toBe('method-scoped');
        });
    });

    describe('getOwnMetadata', () => {
        it('returns metadata defined directly on the target, not inherited from a parent class', () => {
            class Parent {}
            class Child extends Parent {}
            ReflectUtilities.setMetadata(MetadataInjectionKeys.TYPE, 'parent-value', Parent);

            // inherited via the prototype chain
            expect(ReflectUtilities.getMetadata(MetadataInjectionKeys.TYPE, Child)).toBe('parent-value');
            // but not "own"
            expect(ReflectUtilities.getOwnMetadata(MetadataInjectionKeys.TYPE, Child)).toBeUndefined();
        });
    });

    describe('getMetadataKeys', () => {
        it('lists metadata keys defined on a class', () => {
            class KeyTarget {}
            ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_TOKEN, 'a', KeyTarget);
            ReflectUtilities.setMetadata(MetadataInjectionKeys.TYPE, 'b', KeyTarget);

            const keys: string[] = ReflectUtilities.getMetadataKeys(KeyTarget);
            expect(keys).toEqual(expect.arrayContaining([MetadataInjectionKeys.DI_TOKEN, MetadataInjectionKeys.TYPE]));
        });

        it('lists metadata keys defined on a prototype method', () => {
            class KeyMethodTarget {
                method(): void {}
            }
            ReflectUtilities.setMetadata(MetadataInjectionKeys.DI_TOKEN, 'a', KeyMethodTarget, 'method');

            const keys: string[] = ReflectUtilities.getMetadataKeys(KeyMethodTarget, 'method');
            expect(keys).toContain(MetadataInjectionKeys.DI_TOKEN);
        });
    });
});