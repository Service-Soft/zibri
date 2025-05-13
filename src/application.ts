import express, { Express } from 'express';

import { ZibriApplicationOptions } from './application-options.model';
import { AssetServiceInterface } from './assets';
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

    readonly router: RouterInterface;
    private readonly logger: LoggerInterface;
    private readonly assetService: AssetServiceInterface;
    private readonly openApiService: OpenApiServiceInterface;
    private readonly parser: ParserInterface;

    constructor(private readonly options: ZibriApplicationOptions) {
        GlobalRegistry.setAppData(options);
        for (const controller of this.options.controllers) {
            inject(controller);
        }
        for (const provider of this.options.providers ?? []) {
            register(provider);
        }
        for (const parser of options.bodyParsers ?? []) {
            inject(parser);
        }
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);

        this.parser = inject(ZIBRI_DI_TOKENS.PARSER);
        this.parser.attachTo(this);

        this.router = inject(ZIBRI_DI_TOKENS.ROUTER);
        this.router.attachTo(this);

        this.assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        this.assetService.attachTo(this);

        this.openApiService = inject(ZIBRI_DI_TOKENS.OPEN_API_SERVICE);
        this.openApiService.attachTo(this);

        this.express.use((req, res, next) => next(new UnmatchedRouteError(req.originalUrl)));
        this.express.use(inject(ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER));

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