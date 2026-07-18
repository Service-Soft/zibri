import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

import express, { RequestHandler } from 'express';

import { HstsOptions, ZibriApplicationOptions, ZibriApplicationSecurityOptions } from './application-options.model';
import { OtpTwoFactorMethod } from './auth/2fa/methods/otp/otp.two-factor-method';
import { isTwoFactorMethod } from './auth/2fa/methods/two-factor-method.interface';
import { isAuthStrategy } from './auth/strategies/auth-strategy.interface';
import { JwtAuthStrategy } from './auth/strategies/jwt/jwt.auth-strategy';
import { CronJob } from './cron/cron-job.model';
import { isDataSource } from './data-source/data-sources/data-source.interface';
import { ZIBRI_DI_TOKENS } from './di/default/zibri-di-tokens.default';
import { InvalidClassMarkedWithInjectableError } from './di/errors/invalid-class-marked-with-injectable.error';
import { getAllRegisteredTokens } from './di/get-all-registered-tokens.function';
import { initDiContainer } from './di/init-di-container.function';
import { inject } from './di/inject.function';
import { DiToken } from './di/models/di-token.model';
import { register } from './di/register.function';
import { GlobalErrorHandler } from './error-handling/error-handler.model';
import { UnmatchedRouteError } from './error-handling/errors/unmatched-route.error';
import { InternalError } from './error-handling/internal-error.model';
import { implementsAfterAppInit } from './global/after-app-init.interface';
import { AfterAppShutdown, AfterAppShutdownError, implementsAfterAppShutdown } from './global/after-app-shutdown.interface';
import { AppState } from './global/app-state.enum';
import { implementsBeforeAppInit } from './global/before-app-init.interface';
import { BeforeAppShutdown, BeforeAppShutdownError, implementsBeforeAppShutdown } from './global/before-app-shutdown.interface';
import { GlobalRegistry } from './global/global-registry';
import { implementsOnAppInit } from './global/on-app-init.interface';
import { implementsOnAppShutdown, OnAppShutdown, OnAppShutdownError } from './global/on-app-shutdown.interface';
import { implementsOnAppStart } from './global/on-app-start.interface';
import { HandlebarUtilities } from './handlebars/handlebar.utilities';
import { cookieMiddleware } from './http/cookie.middleware';
import { corsMiddleWare } from './http/cors.middleware';
import { KnownHeader } from './http/known-header.enum';
import { LoggerInterface } from './logging/logger.interface';
import { FormDataBodyParser } from './parsing/form-data/form-data.body-parser';
import { JsonBodyParser } from './parsing/json/json.body-parser';
import { ZibriPlugin } from './plugin/plugin.model';
import { Route } from './routing/controller-route-configuration.model';
import { DeepPartial } from './types/deep-partial.type';
import { OmitStrict } from './types/omit-strict.type';
import { FsUtilities } from './utilities/fs.utilities';
import { Ms } from './utilities/ms';
import { NumberUtilities } from './utilities/number.utilities';
import { PromiseUtilities } from './utilities/promise.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
type FullZibriApplicationOptions = Required<OmitStrict<ZibriApplicationOptions, 'plugins' | 'security'>> & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    security: ZibriApplicationSecurityOptions
};

// eslint-disable-next-line typescript/typedef
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

const DEFAULT_SHUTDOWN_TIMEOUT_IN_MS: number = Ms.SECOND * 30;

const defaultHstsOptions: HstsOptions = {
    maxAgeSeconds: NumberUtilities.multiply(Ms.YEAR, 2).dividedBy(1000)
        .toNumber(),
    includeSubDomains: true,
    preload: false
};

/**
 * A os signal that triggers the shutdown of a Zibri application.
 */
export type ShutdownSignal = typeof SHUTDOWN_SIGNALS[number];

/**
 * A Zibri application.
 */
export class ZibriApplication {
    /**
     * The internal express app.
     */
    private readonly express: express.Express = express()
        .disable('x-powered-by')
        .use(corsMiddleWare);

    private readonly signalHandlers: Map<ShutdownSignal, () => void> = new Map();

    /**
     * The underlying http server.
     */
    readonly server: Server = createServer(this.express);

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    /**
     * The options of which the application was build.
     */
    readonly options: FullZibriApplicationOptions;

    constructor(private readonly providedOptions: ZibriApplicationOptions) {
        this.options = this.createFullOptions();

        this.use((req, res, next) => {
            res.setHeader(KnownHeader.X_CONTENT_TYPE_OPTIONS, 'nosniff');
            res.setHeader(KnownHeader.REFERRER_POLICY, 'strict-origin-when-cross-origin');

            const hsts: boolean | HstsOptions = this.options.security.headers[KnownHeader.STRICT_TRANSPORT_SECURITY];
            const isSecure: boolean = req.secure || req.headers[KnownHeader.X_FORWARDED_PROTO] === 'https';
            if (isSecure && hsts !== false) {
                const options: HstsOptions = hsts === true
                    ? defaultHstsOptions
                    : hsts;
                res.setHeader(
                    KnownHeader.STRICT_TRANSPORT_SECURITY,
                    [
                        `max-age=${options.maxAgeSeconds}`,
                        ...options.includeSubDomains ? ['includeSubDomains'] : [],
                        ...options.preload ? ['preload'] : []
                    ].join('; ')
                );
            }

            next();
        });

        for (const signal of SHUTDOWN_SIGNALS) {
            const handler: () => void = () => void this.shutdown(signal);
            this.signalHandlers.set(signal, handler);
            process.on(signal, handler);
        }

        GlobalRegistry.markAppAsCreated();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    use(handler: RequestHandler): void;
    // eslint-disable-next-line jsdoc/require-jsdoc
    use(errorHandler: GlobalErrorHandler): void;
    // eslint-disable-next-line jsdoc/require-jsdoc
    use(...handlers: RequestHandler[]): void;
    // eslint-disable-next-line jsdoc/require-jsdoc
    use(path: Route, ...handlers: RequestHandler[]): void;
    // eslint-disable-next-line jsdoc/require-jsdoc
    use(path: Route, handlers: RequestHandler[]): void;
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    use(...args: any[]): void {
        // eslint-disable-next-line typescript/no-unsafe-argument
        this.express.use(...args);
    }

    /**
     * Initializes the app.
     * @param H - The global handlebars instance, needed to provide some helpers used in templating.
     * @param handlebarComponentsDir - Directory where handlebars components reside. Defaults to assetService.assetsPath/templates/components.
     */
    async init(
        H: typeof Handlebars,
        handlebarComponentsDir?: string
    ): Promise<void> {
        initDiContainer();
        handlebarComponentsDir ??= FsUtilities.getPath(inject(ZIBRI_DI_TOKENS.ASSET_SERVICE).assetsPath, 'templates', 'components');

        await HandlebarUtilities.init(H, handlebarComponentsDir);
        GlobalRegistry.setAppData(this.options);

        for (const provider of this.options.providers) {
            register(provider);
        }

        await this.logDefaults();

        const tokens: DiToken<unknown>[] = getAllRegisteredTokens();
        await this.beforeAppInit(tokens);

        const injectables: unknown[] = tokens.map(t => inject(t));
        this.validateInjectables(injectables);

        await this.onAppInit(injectables);

        const secret: string | undefined = inject(ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET);
        this.use(cookieMiddleware(secret));

        await this.afterAppInit(injectables);

        for (const controller of this.options.controllers) {
            inject(controller);
        }

        for (const websocketController of this.options.websocketControllers) {
            inject(websocketController);
        }

        for (const plugin of this.providedOptions.plugins ?? []) {
            await plugin.validate(this);
        }

        GlobalRegistry.markAppAsInitialized();
    }

    /**
     * Starts on the given port.
     * @param port - The port to start on.
     * @throws When the app has already been started.
     */
    async start(port: number): Promise<void> {
        if (GlobalRegistry.isAppStarted()) {
            // We need this check in addition to the one in the registry.
            // Because we would otherwise have a wrong state when we call markAppAsStarted
            // and then this.app.listen fails.
            throw new InternalError('The application has already been started');
        }

        const injectables: unknown[] = getAllRegisteredTokens().map(t => inject(t));
        for (const element of injectables.filter(i => implementsOnAppStart(i))) {
            await element.onAppStart(this);
        }

        this.use((req, _, next) => next(new UnmatchedRouteError(req.originalUrl)));
        this.use(inject(ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER));
        this.server.listen(port);
        if (port === 0) {
            const address: string | AddressInfo | null = this.server.address();
            if (address != undefined && typeof address !== 'string') {
                port = address.port;
            }
        }
        GlobalRegistry.markAppAsStarted();
        await this.logger.info(`${this.options.name} is running on port ${port}`);
    }

    /**
     * Gracefully shuts down the application.
     * @param signal - The signal that shuts down the application. Can be left empty if manually called.
     */
    async shutdown(signal?: ShutdownSignal): Promise<void> {
        switch (GlobalRegistry.getAppData('state')) {
            case AppState.OFFLINE:
            case AppState.SHUTTING_DOWN: {
                // is already offline or shutting down, nothing to do here
                return;
            }
            case AppState.CREATED: {
                // nothing has been initialized yet, can simply quit without handling shutdown hooks
                await this.logger.info('shutting down...');
                GlobalRegistry.markAppAsShuttingDown();
                for (const [signal, handler] of this.signalHandlers) {
                    process.off(signal, handler);
                }
                if (signal != undefined) {
                    process.exit(0);
                }
                return;
            }
            case AppState.INITIALIZED:
            case AppState.STARTED: {
                await this.logger.info('shutting down...');
                GlobalRegistry.markAppAsShuttingDown();
                for (const [signal, handler] of this.signalHandlers) {
                    process.off(signal, handler);
                }

                await this.shutdownHttpServer();
                const injectables: unknown[] = getAllRegisteredTokens().map(t => inject(t));
                await this.beforeAppShutdown(injectables, signal);
                await this.onAppShutdown(injectables, signal);
                await this.afterAppShutdown(injectables, signal);

                if (signal != undefined) {
                    process.exit(0);
                }
                return;
            }
        }
    }

    private async beforeAppInit(tokens: DiToken<unknown>[]): Promise<void> {
        const sortedTokens: DiToken<unknown>[] = tokens.sort((a, b) => {
            if ('key' in a && a.key === ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE.key) {
                return -1;
            }
            if ('key' in b && b.key === ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE.key) {
                return 1;
            }
            return 0;
        });

        for (const token of sortedTokens) {
            const injectable: unknown = inject(token);
            if (implementsBeforeAppInit(injectable)) {
                await injectable.beforeAppInit(this);
            }
        }
    }

    private async onAppInit(injectables: unknown[]): Promise<void> {
        for (const element of injectables.filter(i => implementsOnAppInit(i))) {
            await element.onAppInit(this);
        }
    }

    private async afterAppInit(injectables: unknown[]): Promise<void> {
        for (const element of injectables.filter(i => implementsAfterAppInit(i))) {
            await element.afterAppInit(this);
        }
    }

    private async afterAppShutdown(injectables: unknown[], signal: ShutdownSignal | undefined): Promise<void> {
        const elements: AfterAppShutdown[] = injectables.filter(i => implementsAfterAppShutdown(i));
        await Promise.all(elements.map(async e => {
            try {
                const timeoutInMs: number = e.shutdownTimeoutInMs ?? DEFAULT_SHUTDOWN_TIMEOUT_IN_MS;
                // no abort signal here because stopping the api does that.
                await PromiseUtilities.withTimeout(() => e.afterAppShutdown(this, signal), timeoutInMs);
            }
            catch (error) {
                await this.logger.error(
                    error instanceof Error
                        ? error
                        : new AfterAppShutdownError(e.constructor.name, { cause: error })
                );
            }
        }));
    }

    private async onAppShutdown(injectables: unknown[], signal: ShutdownSignal | undefined): Promise<void> {
        const elements: OnAppShutdown[] = injectables.filter(i => implementsOnAppShutdown(i));
        await Promise.all(elements.map(async e => {
            try {
                const timeoutInMs: number = e.shutdownTimeoutInMs ?? DEFAULT_SHUTDOWN_TIMEOUT_IN_MS;
                // no abort signal here because stopping the api does that.
                await PromiseUtilities.withTimeout(() => e.onAppShutdown(this, signal), timeoutInMs);
            }
            catch (error) {
                await this.logger.error(
                    error instanceof Error
                        ? error
                        : new OnAppShutdownError(e.constructor.name, { cause: error })
                );
            }
        }));
    }

    private async beforeAppShutdown(injectables: unknown[], signal: ShutdownSignal | undefined): Promise<void> {
        const elements: BeforeAppShutdown[] = injectables.filter(i => implementsBeforeAppShutdown(i));
        await Promise.all(elements.map(async e => {
            try {
                const timeoutInMs: number = e.shutdownTimeoutInMs ?? DEFAULT_SHUTDOWN_TIMEOUT_IN_MS;
                // no abort signal here because stopping the api does that.
                await PromiseUtilities.withTimeout(() => e.beforeAppShutdown(this, signal), timeoutInMs);
            }
            catch (error) {
                await this.logger.error(
                    error instanceof Error
                        ? error
                        : new BeforeAppShutdownError(e.constructor.name, { cause: error })
                );
            }
        }));
    }

    private async shutdownHttpServer(): Promise<void> {
        if (!this.server.listening) {
            return;
        }
        return new Promise((resolve, reject) => {
            // eslint-disable-next-line promise/prefer-await-to-callbacks
            this.server.close(err => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }

    private validateInjectables(injectables: unknown[]): void {
        for (const element of injectables) {
            if (element instanceof ZibriPlugin) {
                throw new InvalidClassMarkedWithInjectableError(element.constructor.name, 'plugin');
            }
            if (element instanceof CronJob) {
                throw new InvalidClassMarkedWithInjectableError(element.constructor.name, 'cronJob');
            }
            if (isTwoFactorMethod(element)) {
                throw new InvalidClassMarkedWithInjectableError(element.constructor.name, 'twoFactorMethod');
            }
            if (isAuthStrategy(element)) {
                throw new InvalidClassMarkedWithInjectableError(element.constructor.name, 'authStrategy');
            }
            if (isDataSource(element) && !this.options.dataSources.find(ds => ds.name === element.constructor.name)) {
                throw new InternalError([
                    `Invalid class marked with @DataSource: ${element.constructor.name}`,
                    'The data source has not been included in the application options.'
                ]);
            }
        }
    }

    private createFullOptions(): FullZibriApplicationOptions {
        // eslint-disable-next-line stylistic/max-len
        const hsts: DeepPartial<HstsOptions> | boolean | undefined = this.providedOptions.security?.headers?.[KnownHeader.STRICT_TRANSPORT_SECURITY];

        const res: FullZibriApplicationOptions = {
            dataSources: [],
            authStrategies: [],
            twoFactorMethods: [],
            bodyParsers: [],
            providers: [],
            cronJobs: [],
            ...this.providedOptions,
            security: {
                headers: {
                    [KnownHeader.STRICT_TRANSPORT_SECURITY]: typeof hsts === 'boolean'
                        ? hsts
                        : {
                            ...defaultHstsOptions,
                            ...hsts
                        }
                }
            }
        };
        for (const plugin of this.providedOptions.plugins ?? []) {
            res.authStrategies = [...plugin.authStrategies, ...res.authStrategies];
            res.bodyParsers = [...plugin.bodyParsers, ...res.bodyParsers];
            res.controllers = [...plugin.controllers, ...res.controllers];
            res.cronJobs = [...plugin.cronJobs, ...res.cronJobs];
            res.providers = [...plugin.providers, ...res.providers];
        }

        if (!res.authStrategies.length) {
            res.authStrategies.push(JwtAuthStrategy);
        }
        if (!res.twoFactorMethods.length) {
            res.twoFactorMethods.push(OtpTwoFactorMethod);
        }
        if (!res.bodyParsers.length) {
            res.bodyParsers.push(JsonBodyParser, FormDataBodyParser);
        }

        return res;
    }

    private async logDefaults(): Promise<void> {
        if (!this.providedOptions.authStrategies) {
            await this.logger.info('No auth strategies provided, defaults to:');
            for (const strategy of this.options.authStrategies) {
                await this.logger.info(`  - ${strategy.name}`);
            }
        }
        if (!this.providedOptions.twoFactorMethods) {
            await this.logger.info('No two factor methods provided, defaults to:');
            for (const strategy of this.options.twoFactorMethods) {
                await this.logger.info(`  - ${strategy.name}`);
            }
        }
        if (!this.providedOptions.bodyParsers) {
            await this.logger.info('No body parsers provided, defaults to:');
            for (const bodyParser of this.options.bodyParsers) {
                await this.logger.info(`  - ${bodyParser.name}`);
            }
        }
    }
}