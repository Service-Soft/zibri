import express, { Express } from 'express';

import { ZibriApplicationOptions } from './application-options.model';
import { AssetServiceInterface } from './assets';
import { DataSourceServiceInterface } from './data-source';
import { ZIBRI_DI_TOKENS, inject } from './di';
import { register } from './di/register.function';
import { UnmatchedRouteError } from './error-handling';
import { GlobalRegistry } from './global';
import { LoggerInterface } from './logging';
import { OpenApiServiceInterface } from './open-api';
import { ParserInterface } from './parsing';
import { RouterInterface } from './routing';

/**
 * A zibri application.
 */
export class ZibriApplication {
    readonly express: Express = express();

    private _router!: RouterInterface;
    get router(): RouterInterface {
        return this._router;
    }
    private logger!: LoggerInterface;
    private assetService!: AssetServiceInterface;
    private openApiService!: OpenApiServiceInterface;
    private parser!: ParserInterface;
    private dataSourceService!: DataSourceServiceInterface;

    constructor(private readonly options: ZibriApplicationOptions) {
        GlobalRegistry.markAppAsCreated();
    }

    async init(): Promise<void> {
        GlobalRegistry.setAppData(this.options);
        for (const provider of this.options.providers ?? []) {
            register(provider);
        }
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        this.dataSourceService = inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE);
        await this.dataSourceService.init();

        this.parser = inject(ZIBRI_DI_TOKENS.PARSER);
        this.parser.attachTo(this);

        this._router = inject(ZIBRI_DI_TOKENS.ROUTER);
        this._router.attachTo(this);

        this.assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        this.assetService.attachTo(this);

        this.openApiService = inject(ZIBRI_DI_TOKENS.OPEN_API_SERVICE);
        this.openApiService.attachTo(this);

        this.express.use((req, res, next) => next(new UnmatchedRouteError(req.originalUrl)));
        this.express.use(inject(ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER));

        for (const controller of this.options.controllers) {
            inject(controller);
        }

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
        this.express.listen(port);
        GlobalRegistry.markAppAsRunning();
        this.logger.info(this.options.name, 'is running on port', port);
    }
}