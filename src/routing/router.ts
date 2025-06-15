import express, { NextFunction, RequestHandler } from 'express';

import { Route, ControllerRouteConfiguration } from './controller-route-configuration.model';
import { RouterInterface } from './router.interface';
import { AuthServiceInterface, CurrentUserMetadata } from '../auth';
import { ZIBRI_DI_TOKENS, inject } from '../di';
import { MetadataUtilities } from '../utilities';
import { MissingBaseRouteError } from './missing-base-route.error';
import { ZibriApplication } from '../application';
import { GlobalRegistry } from '../global';
import { LoggerInterface } from '../logging';
import { Newable } from '../types';
import { BodyMetadata, HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from './decorators';
import { RouteConfiguration } from './route-configuration.model';
import { HttpRequest, HttpResponse } from '../http';
import { OpenApiResponse } from '../open-api';
import { ParserInterface } from '../parsing';
import { ValidationServiceInterface } from '../validation';

export class Router implements RouterInterface {
    private readonly router: express.Router = express.Router();
    private readonly logger: LoggerInterface;
    private readonly parser: ParserInterface;
    private readonly validationService: ValidationServiceInterface;
    private readonly authService: AuthServiceInterface;

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        this.parser = inject(ZIBRI_DI_TOKENS.PARSER);
        this.validationService = inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE);
        this.authService = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        this.logger.info('registers', GlobalRegistry.controllerClasses.length, 'controllers:');
        for (const controller of GlobalRegistry.controllerClasses) {
            const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controller);
            this.logger.info(`  - ${controller.name} (${routes.length} routes)`);
            this.registerController(controller);
        }
    }

    attachTo(app: ZibriApplication): void {
        app.express.use(this.router);
    }

    register(route: RouteConfiguration): void {
        const handler: RequestHandler = this.routeToRequestHandler(route);
        this.logger.debug('- mounting', route.httpMethod.toUpperCase(), `${route.route}`);
        this.router[route.httpMethod](route.route, handler);
    }

    registerController<T extends Object>(controllerClass: Newable<T>): void {
        const baseRoute: Route | undefined = MetadataUtilities.getControllerBaseRoute(controllerClass);
        if (baseRoute == undefined) {
            throw new MissingBaseRouteError(controllerClass);
        }
        const routes: ControllerRouteConfiguration[] = MetadataUtilities.getControllerRoutes(controllerClass);

        for (const route of routes) {
            const handler: RequestHandler = this.controllerRouteToRequestHandler(controllerClass, route);
            const finalRoute: string = `${baseRoute}${route.route}`;
            this.logger.debug('- mounting', route.httpMethod.toUpperCase(), `${finalRoute}`);
            this.router[route.httpMethod](baseRoute + route.route, handler);
        }
    }

    private routeToRequestHandler(route: RouteConfiguration): RequestHandler {
        const handler: RequestHandler = async (req: HttpRequest, res: HttpResponse, next: NextFunction) => {
            try {
                const result: unknown = await route.handler(req, res);
                if (res.headersSent) {
                    return;
                }
                if (result != undefined) {
                    res.json(result);
                    return;
                }
                res.end();
            }
            catch (error) {
                next(error);
            }
        };
        return handler;
    }

    private controllerRouteToRequestHandler(controllerClass: Newable<Object>, route: ControllerRouteConfiguration): RequestHandler {
        const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(controllerClass, route.controllerMethod);
        if (!responses.length) {
            this.logger.warn(`No responses defined on route ${controllerClass.name}.${route.controllerMethod}`);
        }
        const handler: RequestHandler = async (req: HttpRequest, res: HttpResponse, next: NextFunction) => {
            try {
                await this.authService.checkAccess(controllerClass, route.controllerMethod, req);
                const controller: Object = inject(controllerClass);
                const params: unknown[] = await this.resolveRouteParams(
                    controllerClass,
                    route.controllerMethod,
                    // eslint-disable-next-line typescript/no-unsafe-member-access, typescript/no-explicit-any
                    ((controller as any)[route.controllerMethod] as Function).length,
                    req
                );

                // eslint-disable-next-line typescript/no-unsafe-call, typescript/no-explicit-any, typescript/no-unsafe-member-access
                const result: unknown = await ((controller as any)[route.controllerMethod] as Function)(...params);
                if (res.headersSent) {
                    return;
                }
                if (result != undefined) {
                    res.json(result);
                    return;
                }
                res.end();
            }
            catch (error) {
                next(error);
            }
        };
        return handler;
    }

    private async resolveRouteParams(
        controllerClass: Newable<Object>,
        controllerMethod: string,
        totalParamCount: number,
        req: HttpRequest
    ): Promise<unknown[]> {
        let resolvedParamCount: number = 0;
        const params: unknown[] = new Array(totalParamCount).fill(undefined);

        // 1) Path decorators
        const pathParams: Record<string, PathParamMetadata> = MetadataUtilities.getRoutePathParams(controllerClass, controllerMethod);
        for (const [indexStr, metadata] of Object.entries(pathParams)) {
            const idx: number = Number(indexStr);
            params[idx] = this.parser.parsePathParam(req, metadata);
            this.validationService.validatePathParam(params[idx], metadata);
        }
        resolvedParamCount += Object.keys(pathParams).length;

        // 2) Body decorator
        const requestBody: BodyMetadata | undefined = MetadataUtilities.getRouteBody(controllerClass, controllerMethod);
        if (requestBody) {
            resolvedParamCount++;
            params[requestBody.index] = await this.parser.parseRequestBody(req, requestBody);
            this.validationService.validateRequestBody(params[requestBody.index], requestBody.modelClass);
        }

        // 3) Query decorators
        const queryParams: Record<string, QueryParamMetadata> = MetadataUtilities.getRouteQueryParams(controllerClass, controllerMethod);
        for (const [indexStr, metadata] of Object.entries(queryParams)) {
            const idx: number = Number(indexStr);
            params[idx] = this.parser.parseQueryParam(req, metadata);
            this.validationService.validateQueryParam(params[idx], metadata);
        }
        resolvedParamCount += Object.keys(queryParams).length;

        // 3) Header decorators
        const headerParams: Record<string, HeaderParamMetadata> = MetadataUtilities.getRouteHeaderParams(controllerClass, controllerMethod);
        for (const [indexStr, metadata] of Object.entries(headerParams)) {
            const idx: number = Number(indexStr);
            params[idx] = this.parser.parseHeaderParam(req, metadata);
            this.validationService.validateHeaderParam(params[idx], metadata);
        }
        resolvedParamCount += Object.keys(headerParams).length;

        // 4) CurrentUser decorator
        const currentUser: CurrentUserMetadata | undefined = MetadataUtilities.getRouteCurrentUser(controllerClass, controllerMethod);
        if (currentUser) {
            resolvedParamCount++;
            params[currentUser.index] = await this.authService.getCurrentUser(
                req,
                currentUser.allowedStrategies ?? this.authService.strategies,
                currentUser.required
            );
        }

        if (resolvedParamCount < totalParamCount) {
            throw new Error(
                // eslint-disable-next-line stylistic/max-len
                `Error when calling ${controllerClass.name}.${controllerMethod}: Could only resolve ${resolvedParamCount} out of ${totalParamCount} parameters. Did you forget to decorate one of the parameters?`
            );
        }

        return params;
    }
}