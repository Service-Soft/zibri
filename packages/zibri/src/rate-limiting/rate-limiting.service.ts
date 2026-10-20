import { isRateLimiter, RateLimiterInterface } from './limiter/rate-limiter.interface.ts';
import { RateLimitingCleanupCronJob } from './rate-limiting-cleanup.cron-job.ts';
import { RateLimitingServiceInterface } from './rate-limiting-service.interface.ts';
import { ZibriApplication } from '../application/application.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { Injectable } from '../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { getAllInstantiatedValues } from '../di/get-all-instantiated-values.function.ts';
import { getDiTokenName } from '../di/get-di-token-name.function.ts';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function.ts';
import { inject } from '../di/inject.function.ts';
import { BaseRateLimitState } from './stores/rate-limiter-store.interface.ts';
import { DiProvider } from '../di/models/di-provider.model.ts';
import { DiVariants } from '../di/models/di-variant.model.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { OnAppInit } from '../global/on-app-init.interface.ts';
import { type LoggerInterface } from '../logging/logger.interface.ts';

/**
 * An error to throw during rate limiting service initialization.
 */
class InitRateLimitingServiceError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing rate limiting service.', ...messageArray]);
        this.name = 'InitRateLimitingServiceError';
    }
}

/**
 * Default rate limiting service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class RateLimitingService implements RateLimitingServiceInterface, OnAppInit {

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly limiters: RateLimiterInterface<BaseRateLimitState>[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const providers: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.RATE_LIMITER);
        if (providers.length) {
            this.logger.info(`configures ${providers.length} ${providers.length > 1 ? 'rate limiters' : 'rate limiter'}:`);
        }

        for (const provider of providers) {
            const limiter: unknown = inject(provider.token);
            if (!isRateLimiter(limiter)) {
                throw new InitRateLimitingServiceError(
                    `Invalid class marked with @RateLimiter: ${getDiTokenName(provider.token)} needs to implement RateLimiterInterface`
                );
            }
            this.logger.info(`  - ${limiter.config.name}`);
            // added already when the feature that builds it started first, see addLimiter
            if (!this.limiters.includes(limiter)) {
                this.limiters.push(limiter);
            }
        }

        // among what the application has actually built, rather than everything registered - see
        // `CacheService.onAppInit` for why the second question is the expensive one
        const limiters: RateLimiterInterface<BaseRateLimitState>[] = getAllInstantiatedValues()
            .filter(i => isRateLimiter(i));
        for (const limiter of limiters) {
            if (!this.limiters.find(l => l.config.name === limiter.config.name)) {
                throw new InitRateLimitingServiceError(
                    `The class "${limiter.constructor.name}" seems to be a rate limiter but has not been decorated with @RateLimiter()`
                );
            }
        }

        const duplicateLimiterNames: RateLimiterInterface<BaseRateLimitState>[] = this.limiters.filter(
            l => this.limiters.filter(internalL => internalL.config.name === l.config.name).length > 1
        );
        if (duplicateLimiterNames.length) {
            throw new InitRateLimitingServiceError(
                [
                    'There are duplicate rate limiter names:',
                    ...[...new Set(duplicateLimiterNames.map(l => l.config.name))].map(name => `- ${name}`)
                ]
            );
        }

        if (!app.options.cronJobs.includes(RateLimitingCleanupCronJob)) {
            app.options.cronJobs.push(RateLimitingCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc, typescript/no-explicit-any
    addLimiter(limiter: RateLimiterInterface<any>): void {
        // a limiter whose state only some applications have a table for is built by the feature that
        // needs it, while the application starts - before or after the sweep above, so both add it.
        // The two arguments below are the any of the parameter, see RateLimitingServiceInterface
        // eslint-disable-next-line typescript/no-unsafe-argument
        if (this.limiters.includes(limiter)) {
            return;
        }
        if (this.limiters.some(l => l.config.name === limiter.config.name)) {
            throw new InitRateLimitingServiceError(['There are duplicate rate limiter names:', `- ${limiter.config.name}`]);
        }
        // eslint-disable-next-line typescript/no-unsafe-argument
        this.limiters.push(limiter);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async cleanup(): Promise<void> {
        await Promise.all(this.limiters.map(async l => await l.cleanup()));
    }
}