import { describe, expect, it } from '@jest/globals';

import { RateLimiter } from './rate-limiter.decorator';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { GlobalRegistry } from '../../global/global-registry';

describe('RateLimiter decorator', () => {
    it('registers the class immediately, tagged with the RATE_LIMITER variant', () => {
        @RateLimiter()
        class ImmediateLimiter {}

        const provider: DiProvider<unknown> | undefined = GlobalRegistry.injectables.find(p => p.useClass === ImmediateLimiter);
        expect(provider).toBeDefined();
        expect(provider?.variants).toContain(DiVariants.RATE_LIMITER);
        expect(GlobalRegistry.lazyInjectables.find(p => p.useClass === ImmediateLimiter)).toBeUndefined();
    });

    it('registers the class lazily when register: "onUse" is passed, still tagged with the RATE_LIMITER variant', () => {
        @RateLimiter({ register: 'onUse' })
        class LazyLimiter {}

        const provider: DiProvider<unknown> | undefined = GlobalRegistry.lazyInjectables.find(p => p.useClass === LazyLimiter);
        expect(provider).toBeDefined();
        expect(provider?.variants).toContain(DiVariants.RATE_LIMITER);
        expect(GlobalRegistry.injectables.find(p => p.useClass === LazyLimiter)).toBeUndefined();
    });

    it('registers the class under a custom token when one is provided', () => {
        const customToken: InjectionToken<unknown> = new InjectionToken('custom-limiter-token');

        @RateLimiter({ token: customToken })
        class TokenedLimiter {}

        const provider: DiProvider<unknown> | undefined = GlobalRegistry.injectables.find(p => p.useClass === TokenedLimiter);
        expect(provider?.token).toBe(customToken);
        expect(provider?.variants).toContain(DiVariants.RATE_LIMITER);
    });
});