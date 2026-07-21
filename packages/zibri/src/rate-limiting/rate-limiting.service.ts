import { isRateLimiter, RateLimiterInterface } from './limiter/rate-limiter.interface';
import { RateLimitingServiceInterface } from './rate-limiting-service.interface';
import { ZibriApplication } from '../application';
import { RateLimitingCleanupCronJob } from './rate-limiting-cleanup.cron-job';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getAllRegisteredTokens } from '../di/get-all-registered-tokens.function';
import { getDiTokenName } from '../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { DiProvider } from '../di/models/di-provider.model';
import { DiVariants } from '../di/models/di-variant.model';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { BaseRateLimitState } from './stores/rate-limiter-store.interface';

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

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly limiters: RateLimiterInterface<BaseRateLimitState>[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        const providers: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.RATE_LIMITER);
        if (providers.length) {
            await this.logger.info(`configures ${providers.length} ${providers.length > 1 ? 'rate limiters' : 'rate limiter'}:`);
        }

        for (const provider of providers) {
            const limiter: unknown = inject(provider.token);
            if (!isRateLimiter(limiter)) {
                throw new InitRateLimitingServiceError(
                    `Invalid class marked with @RateLimiter: ${getDiTokenName(provider.token)} needs to implement RateLimiterInterface`
                );
            }
            await this.logger.info(`  - ${limiter.config.name}`);
            this.limiters.push(limiter);
        }

        const limiters: RateLimiterInterface<BaseRateLimitState>[] = getAllRegisteredTokens()
            .map(t => inject(t))
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async cleanup(): Promise<void> {
        await Promise.all(this.limiters.map(l => l.cleanup()));
    }
}