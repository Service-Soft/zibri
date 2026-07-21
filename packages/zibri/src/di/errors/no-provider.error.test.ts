import { describe, expect, it } from '@jest/globals';

import { NoProviderError } from './no-provider.error';
import { Inject } from '../decorators/inject.decorator';
import { InjectionToken } from '../models/injection-token.model';

describe('NoProviderError', () => {
    it('sets its name and extends InternalError-style messaging', () => {
        const token: InjectionToken<string> = new InjectionToken<string>('no-provider-error-name-test');
        const error: NoProviderError = new NoProviderError(token, []);
        expect(error.name).toBe('NoProviderError');
    });

    it('explains missing repository registration for a "Repository<X>" token', () => {
        const token: InjectionToken<unknown> = new InjectionToken<unknown>('Repository<User>');
        const error: NoProviderError = new NoProviderError(token, []);
        expect(error.message).toBe('No provider for repository token "Repository<User>". Did you forget to register the entity "User" in a data source?');
        expect(error.stack).not.toContain('Dependency resolution stack:');
    });

    it('suggests @Inject() for a plain InjectionToken with an empty resolving stack', () => {
        const token: InjectionToken<string> = new InjectionToken<string>('no-provider-error-empty-stack');
        const error: NoProviderError = new NoProviderError(token, []);
        expect(error.message).toBe(
            'No provider for token "no-provider-error-empty-stack". Did you forget to decorate it with @Inject()?'
        );
    });

    it('points at the constructor parameter index that requested the token', () => {
        const token: InjectionToken<string> = new InjectionToken<string>('no-provider-error-param-index');

        class ServiceWithMissingDependency {
            constructor(@Inject(token) readonly dependency: string) {}
        }

        const error: NoProviderError = new NoProviderError(token, [ServiceWithMissingDependency]);
        expect(error.message).toBe(
            'No provider for the token at index 0 of class "ServiceWithMissingDependency". Did you forget to decorate it with @Inject()?'
        );
        expect(error.stack).toContain('Dependency resolution stack:');
        expect(error.stack).toContain('ServiceWithMissingDependency');
    });

    it('reports index -1 when the token cannot be matched to any @Inject() parameter', () => {
        const token: InjectionToken<string> = new InjectionToken<string>('no-provider-error-unmatched-token');

        class ServiceWithoutMatchingInject {}

        const error: NoProviderError = new NoProviderError(token, [ServiceWithoutMatchingInject]);
        expect(error.message).toBe(
            'No provider for the token at index -1 of class "ServiceWithoutMatchingInject". Did you forget to decorate it with @Inject()?'
        );
    });

    it('explains missing @Injectable() for a class token', () => {

        class PlainClass {}

        const error: NoProviderError = new NoProviderError(PlainClass, []);
        expect(error.message).toBe('No provider for class "PlainClass". Did you forget to decorate it with @Injectable()?');
    });
});