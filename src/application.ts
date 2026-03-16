import { createServer, Server } from 'node:http';

import cors from 'cors';
import express, { RequestHandler } from 'express';

import { ZibriApplicationOptions } from './application-options.model';
import { OtpTwoFactorMethod } from './auth/2fa/methods/otp/otp.two-factor-method';
import { JwtAuthStrategy } from './auth/strategies/jwt/jwt.auth-strategy';
import { DataSourceServiceInterface } from './data-source/data-source-service.interface';
import { ZIBRI_DI_TOKENS } from './di/default/zibri-di-tokens.default';
import { getAllRegisteredTokens } from './di/get-all-registered-tokens.function';
import { inject } from './di/inject.function';
import { register } from './di/register.function';
import { GlobalErrorHandler } from './error-handling/error-handler.model';
import { UnmatchedRouteError } from './error-handling/errors/unmatched-route.error';
import { GlobalRegistry } from './global/global-registry';
import { isOnAppInitInterface } from './global/on-app-init.interface';
import { isOnAppStartInterface } from './global/on-app-start.interface';
import { HandlebarUtilities } from './handlebars/handlebar.utilities';
import { LoggerInterface } from './logging/logger.interface';
import { FormDataBodyParser } from './parsing/form-data/form-data.body-parser';
import { JsonBodyParser } from './parsing/json/json.body-parser';
import { ZibriPlugin } from './plugin/plugin.model';
import { Route } from './routing/controller-route-configuration.model';
import { RouterInterface } from './routing/router.interface';
import { OmitStrict } from './types/omit-strict.type';

// eslint-disable-next-line jsdoc/require-jsdoc
type FullZibriApplicationOptions = Required<OmitStrict<ZibriApplicationOptions, 'plugins'>>;

/**
 * A Zibri application.
 */
export class ZibriApplication {
    /**
     * The internal express app.
     */
    private readonly express: express.Express = express()
        .disable('x-powered-by')
        .use(cors());

    /**
     * The underlying http server.
     */
    readonly server: Server = createServer(this.express);

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The router used by the application.
     */
    get router(): RouterInterface {
        return inject(ZIBRI_DI_TOKENS.ROUTER);
    }
    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }
    private dataSourceService!: DataSourceServiceInterface;
    /**
     * The options of which the application was build.
     */
    readonly options: FullZibriApplicationOptions;

    constructor(private readonly providedOptions: ZibriApplicationOptions) {
        this.options = this.createFullOptions();
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
     */
    async init(H: typeof Handlebars): Promise<void> {
        await HandlebarUtilities.init(H);
        GlobalRegistry.setAppData(this.options);

        for (const provider of this.options.providers) {
            register(provider);
        }

        await this.logDefaults();

        this.dataSourceService = inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE);
        await this.dataSourceService.init();

        for (const token of getAllRegisteredTokens()) {
            const x: unknown = inject(token);
            if (x instanceof ZibriPlugin) {
                throw new Error([
                    `Invalid class marked with @Injectable: ${x.constructor.name}`,
                    'Plugins interfere with the injection system, making them injectable is forbidden.'
                ].join('\n'));
            }
            if (isOnAppInitInterface(x)) {
                await x.onAppInit(this);
            }
        }

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
        if (GlobalRegistry.isAppRunning()) {
            // We need this check in addition to the one in the registry.
            // Because we would otherwise have a wrong state when we call markAppAsRunning
            // and then this.app.listen fails.
            throw new Error('The application has already been started');
        }

        for (const token of getAllRegisteredTokens()) {
            const x: unknown = inject(token);
            if (isOnAppStartInterface(x)) {
                await x.onAppStart(this);
            }
        }
        this.use((req, _, next) => next(new UnmatchedRouteError(req.originalUrl)));
        this.use(inject(ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER));
        this.server.listen(port);
        GlobalRegistry.markAppAsRunning();
        await this.logger.info(`${this.options.name} is running on port ${port}`);
    }

    private createFullOptions(): FullZibriApplicationOptions {
        const res: FullZibriApplicationOptions = {
            dataSources: [],
            authStrategies: [],
            twoFactorMethods: [],
            bodyParsers: [],
            providers: [],
            cronJobs: [],
            ...this.providedOptions
        };
        for (const plugin of this.providedOptions.plugins ?? []) {
            // TODO: handle order of plugin initialization so that everything is available for DI inside the plugin constructor.
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