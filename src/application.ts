import cors from 'cors';
import express, { RequestHandler } from 'express';

import { ZibriApplicationOptions } from './application-options.model';
import { AssetServiceInterface } from './assets';
import { AuthServiceInterface, JwtAuthStrategy } from './auth';
import { CronServiceInterface } from './cron';
import { DataSourceServiceInterface } from './data-source';
import { ZIBRI_DI_TOKENS, inject } from './di';
import { register } from './di/register.function';
import { EmailServiceInterface, MailingListServiceInterface } from './email';
import { UnmatchedRouteError } from './error-handling';
import { GlobalRegistry } from './global';
import { HandlebarUtilities } from './handlebars/handlebar.utilities';
import { LoggerInterface } from './logging';
import { MetricsServiceInterface } from './metrics';
import { MultithreadingServiceInterface } from './multithreading';
import { OpenApiServiceInterface } from './open-api';
import { FormDataBodyParser, JsonBodyParser, ParserInterface } from './parsing';
import { ZibriPlugin } from './plugin';
import { Route, RouterInterface } from './routing';
import { OmitStrict } from './types';

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

    private _router!: RouterInterface;
    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The router used by the application.
     */
    get router(): RouterInterface {
        return this._router;
    }
    private logger!: LoggerInterface;
    private metricsService!: MetricsServiceInterface;
    private assetService!: AssetServiceInterface;
    private openApiService!: OpenApiServiceInterface;
    private parser!: ParserInterface;
    private dataSourceService!: DataSourceServiceInterface;
    private authService!: AuthServiceInterface;
    private cronService!: CronServiceInterface;
    private multithreadingService!: MultithreadingServiceInterface;
    private emailService!: EmailServiceInterface;
    private mailingListService?: MailingListServiceInterface;
    /**
     * The options of which the application was build.
     */
    readonly options: FullZibriApplicationOptions;

    constructor(private readonly providedOptions: ZibriApplicationOptions) {
        this.options = this.createFullOptions();
        GlobalRegistry.markAppAsCreated();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    use(handler: RequestHandler): express.Express;
    // eslint-disable-next-line jsdoc/require-jsdoc
    use(...handlers: RequestHandler[]): void;
    // eslint-disable-next-line jsdoc/require-jsdoc
    use(path: Route, ...handlers: RequestHandler[]): void;
    // eslint-disable-next-line jsdoc/require-jsdoc
    use(path: Route, handlers: RequestHandler[]): void;
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    use(...args: any[]): express.Express {
        // eslint-disable-next-line typescript/no-unsafe-argument
        return this.express.use(...args);
    }

    /**
     * Initializes the app.
     * @param H - The global handlebars instance, needed to provide some helpers used in templating.
     */
    async init(H: typeof Handlebars): Promise<void> {
        HandlebarUtilities.init(H);
        GlobalRegistry.setAppData(this.options);

        for (const provider of this.options.providers) {
            register(provider);
        }

        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        await this.logger.attachTo(this);

        this.metricsService = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
        await this.metricsService.attachTo(this);

        if (!this.providedOptions.authStrategies) {
            await this.logger.info('No auth strategies provided, defaults to:');
            for (const strategy of this.options.authStrategies) {
                await this.logger.info(`  - ${strategy.name}`);
            }
        }
        if (!this.providedOptions.bodyParsers) {
            await this.logger.info('No request body parsers provided, defaults to:');
            for (const bodyParser of this.options.bodyParsers) {
                await this.logger.info(`  - ${bodyParser.name}`);
            }
        }

        this.dataSourceService = inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE);
        await this.dataSourceService.init();

        this.authService = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        await this.authService.init(this.options.authStrategies);

        this.parser = inject(ZIBRI_DI_TOKENS.PARSER);
        await this.parser.attachTo(this);

        this._router = inject(ZIBRI_DI_TOKENS.ROUTER);
        await this._router.init(this);

        this.assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        await this.assetService.attachTo(this);

        this.emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        this.emailService.attachTo(this);

        this.mailingListService = inject(ZIBRI_DI_TOKENS.MAILING_LIST_SERVICE);
        this.mailingListService?.attachTo(this);

        this.openApiService = inject(ZIBRI_DI_TOKENS.OPEN_API_SERVICE);
        await this.openApiService.attachTo(this);

        for (const controller of this.options.controllers) {
            inject(controller);
        }

        this.cronService = inject(ZIBRI_DI_TOKENS.CRON_SERVICE);
        await this.cronService.init(this.options.cronJobs);

        this.multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        await this.multithreadingService.init();

        for (const plugin of this.providedOptions.plugins ?? []) {
            const p: ZibriPlugin = inject(plugin);
            await p.validate(this);
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
        await this.router.attachTo(this);
        this.use((req, _, next) => next(new UnmatchedRouteError(req.originalUrl)));
        this.use(inject(ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER));
        this.express.listen(port);
        GlobalRegistry.markAppAsRunning();
        await this.logger.info(`${this.options.name} is running on port ${port}`);
    }

    private createFullOptions(): FullZibriApplicationOptions {
        const res: FullZibriApplicationOptions = {
            dataSources: [],
            authStrategies: [],
            bodyParsers: [],
            providers: [],
            cronJobs: [],
            ...this.providedOptions
        };
        for (const plugin of this.providedOptions.plugins ?? []) {
            const p: ZibriPlugin = inject(plugin);
            // TODO: handle order of plugin initialization so that everything is available for DI inside the plugin constructor.
            res.authStrategies = [...p.authStrategies, ...res.authStrategies];
            res.bodyParsers = [...p.bodyParsers, ...res.bodyParsers];
            res.controllers = [...p.controllers, ...res.controllers];
            res.cronJobs = [...p.cronJobs, ...res.cronJobs];
            res.providers = [...p.providers, ...res.providers];
        }

        if (!res.authStrategies.length) {
            res.authStrategies.push(JwtAuthStrategy);
        }
        if (!res.bodyParsers.length) {
            res.bodyParsers.push(JsonBodyParser, FormDataBodyParser);
        }

        return res;
    }
}