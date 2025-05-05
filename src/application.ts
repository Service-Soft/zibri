import express, { Express, RequestHandler } from 'express';

import { CATALYX_DI_TOKENS, DiContainer } from './di';
import { Router, RouterInterface } from './routing';

/**
 * A catalyx application.
 */
export class CatalyxApplication<RouterType extends RouterInterface = Router> {
    private readonly app: Express = express();

    readonly di: DiContainer = DiContainer.getInstance();

    readonly router: RouterType;

    constructor(
    ) {
        this.router = this.di.inject(CATALYX_DI_TOKENS.ROUTER);
    }

    /**
     * Starts on the given port.
     * @param port - The port to start on.
     */
    start(port: number): void {
        this.app.listen(port);
    }

    /**
     * Registers the given handler to be used by the application.
     * @param handler - The handler that should be used by the application.
     */
    registerHandler(handler: RequestHandler): void {
        this.app.use(handler);
    }
}