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
import { LoggerInterface } from './logging';
import { OpenApiServiceInterface } from './open-api';
import { FormDataBodyParser, JsonBodyParser, ParserInterface } from './parsing';
import { Route, RouterInterface } from './routing';

// eslint-disable-next-line jsdoc/require-jsdoc
type FullZibriApplicationOptions = Required<ZibriApplicationOptions>;

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
    private assetService!: AssetServiceInterface;
    private openApiService!: OpenApiServiceInterface;
    private parser!: ParserInterface;
    private dataSourceService!: DataSourceServiceInterface;
    private authService!: AuthServiceInterface;
    private cronService!: CronServiceInterface;
    private emailService!: EmailServiceInterface;
    private mailingListService?: MailingListServiceInterface;
    /**
     * The options of which the application was build.
     */
    readonly options: FullZibriApplicationOptions;

    constructor(private readonly providedOptions: ZibriApplicationOptions) {
        this.options = {
            dataSources: [],
            authStrategies: [JwtAuthStrategy],
            bodyParsers: [JsonBodyParser, FormDataBodyParser],
            providers: [],
            cronJobs: [],
            ...providedOptions
        };
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
     */
    async init(): Promise<void> {
        GlobalRegistry.setAppData(this.options);
        for (const provider of this.options.providers) {
            register(provider);
        }
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        if (!this.providedOptions.authStrategies) {
            this.logger.info('No auth strategies provided, defaults to:');
            for (const strategy of this.options.authStrategies) {
                this.logger.info('  -', strategy.name);
            }
        }
        if (!this.providedOptions.bodyParsers) {
            this.logger.info('No request body parsers provided, defaults to:');
            for (const bodyParser of this.options.bodyParsers) {
                this.logger.info('  -', bodyParser.name);
            }
        }

        this.dataSourceService = inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE);
        await this.dataSourceService.init();

        this.authService = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        this.authService.init(this.options.authStrategies);

        this.parser = inject(ZIBRI_DI_TOKENS.PARSER);
        await this.parser.attachTo(this);

        this._router = inject(ZIBRI_DI_TOKENS.ROUTER);
        this._router.init(this);

        this.assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        this.assetService.attachTo(this);

        this.emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        this.emailService.attachTo(this);

        this.mailingListService = inject(ZIBRI_DI_TOKENS.MAILING_LIST_SERVICE);
        this.mailingListService?.attachTo(this);

        this.openApiService = inject(ZIBRI_DI_TOKENS.OPEN_API_SERVICE);
        this.openApiService.attachTo(this);

        for (const controller of this.options.controllers) {
            inject(controller);
        }

        this.cronService = inject(ZIBRI_DI_TOKENS.CRON_SERVICE);
        await this.cronService.init(this.options.cronJobs);

        GlobalRegistry.markAppAsInitialized();
    }

    /**
     * Starts on the given port.
     * @param port - The port to start on.
     * @throws When the app has already been started.
     */
    start(port: number): void {
        if (GlobalRegistry.isAppRunning()) {
            // We need this check in addition to the one in the registry.
            // Because we would otherwise have a wrong state when we call markAppAsRunning
            // and then this.app.listen fails.
            throw new Error('The application has already been started');
        }
        this.router.attachTo(this);
        this.use((req, _, next) => next(new UnmatchedRouteError(req.originalUrl)));
        this.use(inject(ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER));
        this.express.listen(port);
        GlobalRegistry.markAppAsRunning();
        this.logger.info(this.options.name, 'is running on port', port);
    }
}