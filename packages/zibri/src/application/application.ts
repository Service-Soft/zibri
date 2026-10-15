import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

import express, { ErrorRequestHandler, RequestHandler } from 'express';

import { HstsOptions, ZibriApplicationOptions, ZibriApplicationSecurityOptions } from './application-options.model';
import { OtpTwoFactorMethod } from '../auth/2fa/methods/otp/otp.two-factor-method';
import { isTwoFactorMethod } from '../auth/2fa/methods/two-factor-method.interface';
import { PasswordAuthenticator } from '../auth/authenticators/password/password.authenticator';
import { isAuthStrategy } from '../auth/strategies/auth-strategy.interface';
import { JwtAuthStrategy } from '../auth/strategies/jwt/jwt.auth-strategy';
import { CronJob } from '../cron/cron-job.model';
import { isDataSource } from '../data-source/data-sources/data-source.interface';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { DiContainer } from '../di/di-container';
import { InvalidClassMarkedWithInjectableError } from '../di/errors/invalid-class-marked-with-injectable.error';
import { ProviderCollisionError } from '../di/errors/provider-collision.error';
import { getAllInstantiatedValues } from '../di/get-all-instantiated-values.function';
import { initDiContainer } from '../di/init-di-container.function';
import { inject } from '../di/inject.function';
import { DiProvider } from '../di/models/di-provider.model';
import { DiToken } from '../di/models/di-token.model';
import { DiVariants } from '../di/models/di-variant.model';
import { register } from '../di/register.function';
import { UnmatchedRouteError } from '../error-handling/errors/unmatched-route.error';
import { InternalError } from '../error-handling/internal-error.model';
import { implementsAfterAppInit } from '../global/after-app-init.interface';
import { AfterAppShutdown, AfterAppShutdownError, implementsAfterAppShutdown } from '../global/after-app-shutdown.interface';
import { implementsAfterAppStart } from '../global/after-app-start.interface';
import { AppState } from '../global/app-state.enum';
import { implementsBeforeAppInit } from '../global/before-app-init.interface';
import { BeforeAppShutdown, BeforeAppShutdownError, implementsBeforeAppShutdown } from '../global/before-app-shutdown.interface';
import { declaresLifecycleHook } from '../global/declares-lifecycle-hook.function';
import { GlobalRegistry } from '../global/global-registry';
import { LifecyclePhase } from '../global/lifecycle-phase.enum';
import { implementsOnAppInit } from '../global/on-app-init.interface';
import { implementsOnAppShutdown, OnAppShutdown, OnAppShutdownError } from '../global/on-app-shutdown.interface';
import { implementsOnAppStart } from '../global/on-app-start.interface';
import { HandlebarUtilities } from '../handlebars/handlebar.utilities';
import { compressionMiddleware } from '../http/compression.middleware';
import { cookieMiddleware } from '../http/cookie.middleware';
import { corsMiddleware, defaultCorsOptions } from '../http/cors.middleware';
import { crossOriginCookieMiddleware } from '../http/cross-origin-cookie.middleware';
import { HttpServerTimeouts } from '../http/http-server-timeouts.model';
import { KnownHeader } from '../http/known-header.enum';
import { MiddlewarePhase } from '../http/middleware-phase.enum';
import { traceContextMiddleware } from '../http/trace-context.middleware';
import { LoggerInterface } from '../logging/logger.interface';
import { FormDataBodyParser } from '../parsing/form-data/form-data.body-parser';
import { FormUrlEncodedBodyParser } from '../parsing/form-url-encoded/form-url-encoded.body-parser';
import { JsonBodyParser } from '../parsing/json/json.body-parser';
import { StreamBodyParser } from '../parsing/stream/stream.body-parser';
import { XmlBodyParser } from '../parsing/xml/xml.body-parser';
import { ZibriPlugin } from '../plugin/plugin.model';
import { Route } from '../routing/controller-route-configuration.model';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { OmitStrict } from '../types/omit-strict.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { Ms } from '../utilities/ms';
import { NumberUtilities } from '../utilities/number.utilities';
import { PromiseUtilities } from '../utilities/promise.utilities';

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
 * A middleware waiting for the pipeline to be assembled.
 */
type RegisteredMiddleware = {
    /**
     * Which position in the pipeline it asked for.
     */
    phase: MiddlewarePhase,
    /**
     * The route it is limited to, when it is limited to one.
     */
    path: Route | undefined,
    /**
     * What to run.
     */
    handler: RequestHandler
};

/**
 * A Zibri application.
 */
export class ZibriApplication {
    /**
     * The internal express app.
     */
    private readonly express: express.Express = express()
        .disable('x-powered-by');

    private readonly signalHandlers: Map<ShutdownSignal, () => void> = new Map();

    /**
     * Every middleware that has been registered, in the order the calls were made.
     *
     * Collected rather than mounted, because express runs middleware in the order it was handed
     * them - which would make the pipeline a consequence of when each thing happened to register.
     * A service registering from `onAppInit` would then sit ahead of one registering from
     * `afterAppInit`, and both ahead of a project's own, for no reason either of them chose.
     */
    private readonly registeredMiddleware: RegisteredMiddleware[] = [];

    /**
     * Whether the pipeline has been assembled, after which registering is too late to mean anything.
     */
    private middlewareMounted: boolean = false;

    /**
     * Whether any shutdown hook failed, which decides the exit code.
     *
     * Hooks swallow their own errors so one failure cannot strand the others, which means nothing
     * else is left to tell the outside world that the teardown did not go cleanly.
     */
    private shutdownFailed: boolean = false;

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
        this.validateNoPluginProviderCollisions();
        this.options = this.createFullOptions();

        // before any middleware reads an address or asks whether the connection was secure. Left at
        // express's default the application behind an ingress sees every request as coming from the
        // proxy over plain http, which makes one rate limit bucket for the whole internet.
        this.express.set('trust proxy', this.options.security.trustProxy);

        // first, and before anything a user can add: a preflight has to be answered whatever else is
        // registered, and a response that is not marked cross origin readable is one the browser
        // throws away no matter what produced it
        this.use(corsMiddleware(this.options.security.cors), MiddlewarePhase.SECURITY);

        // straight after cors and before everything else: every response names the trace that
        // answered it, including the ones produced before a route was matched, and every log line
        // written while handling a request has a trace to belong to
        this.use(traceContextMiddleware(), MiddlewarePhase.SECURITY);

        // before anything that can answer a request, because what it takes over is how a response is
        // written - a handler that has already started writing cannot be encoded after the fact
        this.use(compressionMiddleware(), MiddlewarePhase.SECURITY);

        this.use((req, res, next) => {
            res.setHeader(KnownHeader.X_CONTENT_TYPE_OPTIONS, 'nosniff');
            res.setHeader(KnownHeader.REFERRER_POLICY, 'strict-origin-when-cross-origin');

            const hsts: boolean | HstsOptions = this.options.security.headers[KnownHeader.STRICT_TRANSPORT_SECURITY];
            // req.secure alone, which reads the forwarded protocol itself for as many hops as
            // security.trustProxy allows. Reading the header directly believed it from anyone, so a
            // plain http request claiming https got the header that tells a browser to never use
            // plain http with this host again.
            if (req.secure && hsts !== false) {
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
        }, MiddlewarePhase.SECURITY);

        // for every route rather than inside the cookie strategy, where the csrf token is checked:
        // that check only runs on a route resolving the session, and a cookie acts with the user's
        // authority on any route that reads it. Last in the phase, so its refusal carries the
        // headers above and belongs to the request's trace
        this.use(crossOriginCookieMiddleware(this.options.security.cors), MiddlewarePhase.SECURITY);

        for (const signal of SHUTDOWN_SIGNALS) {
            const handler: () => void = () => void this.shutdown(signal);
            this.signalHandlers.set(signal, handler);
            process.on(signal, handler);
        }

        // the last line of defense for everything that runs outside a request. The global error
        // handler is express middleware, so it only ever sees errors on the request pipeline -
        // a cron tick, an event subscriber or a websocket handshake that rejects reaches nobody,
        // and node's default for an unhandled rejection is to end the process.
        process.on('unhandledRejection', this.rejectionHandler);

        // logged and then handed back to node rather than swallowed: after an uncaught exception
        // the process may hold half-updated state, and carrying on is how that becomes corruption.
        // What this buys is the error reaching the configured log transports before the exit.
        process.on('uncaughtException', this.exceptionHandler);

        GlobalRegistry.markAppAsCreated();
    }

    /**
     * Adds a middleware to the request pipeline.
     * @param handler - What to run.
     * @param phase - Where in the pipeline it runs. Defaults to `BEFORE_ROUTING`, which is after the
     * request has been made readable and before a route is matched.
     */
    use(handler: RequestHandler, phase?: MiddlewarePhase): void;
    /**
     * Adds a middleware that only runs for requests below the given route.
     * @param path - The route it is limited to.
     * @param handler - What to run.
     * @param phase - Where in the pipeline it runs. Defaults to `BEFORE_ROUTING`, which is after the
     * request has been made readable and before a route is matched.
     */
    use(path: Route, handler: RequestHandler, phase?: MiddlewarePhase): void;
    /**
     * Adds a middleware to the request pipeline.
     * @param pathOrHandler - The route to limit it to, or the middleware itself.
     * @param handlerOrPhase - The middleware when a route was given, and otherwise its phase.
     * @param phaseWithPath - Its phase, when a route was given.
     * @throws When the pipeline has already been assembled, which is anything after `start`.
     */
    use(
        pathOrHandler: Route | RequestHandler,
        handlerOrPhase?: RequestHandler | MiddlewarePhase,
        phaseWithPath?: MiddlewarePhase
    ): void {
        // silence is the failure mode worth removing here: express is handed middleware for a server
        // that is already listening, adds it after the handler that answers everything with a 404,
        // and nothing it contains ever runs again
        if (this.middlewareMounted) {
            throw new InternalError([
                'Middleware can only be added before the application starts.',
                'The pipeline is assembled once, in start(), so anything added after it would sit',
                'behind the handler that answers unmatched requests and never run.'
            ]);
        }

        if (typeof pathOrHandler !== 'string') {
            this.registeredMiddleware.push({
                phase: typeof handlerOrPhase === 'number' ? handlerOrPhase : MiddlewarePhase.BEFORE_ROUTING,
                path: undefined,
                handler: pathOrHandler
            });
            return;
        }

        if (typeof handlerOrPhase !== 'function') {
            throw new InternalError(`No middleware was given to run for "${pathOrHandler}".`);
        }

        this.registeredMiddleware.push({
            phase: phaseWithPath ?? MiddlewarePhase.BEFORE_ROUTING,
            path: pathOrHandler,
            handler: handlerOrPhase
        });
    }

    /**
     * Hands the pipeline to express, in one pass, in the order it runs.
     *
     * Sorted by phase and stable within one, so a middleware's position is what it asked for and then
     * when it asked - never which lifecycle hook its service happened to use. The error handler is
     * last and is not part of the sort: an application has exactly one, it is named by a di token
     * rather than registered, and express recognizes it by its four parameters.
     */
    private mountMiddleware(): void {
        const inOrder: RegisteredMiddleware[] = this.registeredMiddleware
            .map((middleware, index) => ({ middleware, index }))
            .sort((a, b) => a.middleware.phase - b.middleware.phase || a.index - b.index)
            .map(entry => entry.middleware);

        for (const { path, handler } of inOrder) {
            if (path == undefined) {
                this.express.use(handler);
                continue;
            }
            this.express.use(path, handler);
        }

        // the one place express hands over its own request and response rather than being handed the
        // framework's, which declares both narrower - a method that is an enum, headers that are
        // known. The router asserts the same boundary for the same reason
        this.express.use(inject(ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER) as ErrorRequestHandler);
        this.middlewareMounted = true;
    }

    /**
     * Initializes the app.
     */
    async init(): Promise<void> {
        initDiContainer();

        GlobalRegistry.setAppData(this.options);

        for (const provider of this.options.providers) {
            register(provider);
        }

        await HandlebarUtilities.init();

        this.logDefaults();

        this.dropUndeclaredOrphanControllers();
        this.registerAdditionalLifecycleServices();

        const tokens: DiToken<unknown>[] = this.providersWorthBuildingBeforeUse()
            .map(provider => provider.token);
        await this.beforeAppInit(tokens);

        const injectables: unknown[] = tokens.map(t => inject(t));
        this.validateInjectables(injectables);

        await this.onAppInit(injectables);

        const secret: string | undefined = inject(ZIBRI_DI_TOKENS.COOKIE_SIGN_SECRET);
        // the secret is a di token, so this is the first moment there is one to read - and the phase
        // is what keeps that from deciding anything. Before phases existed this line ran after
        // `onAppInit`, which put every middleware a service registers there ahead of parsed cookies
        this.use(cookieMiddleware(secret), MiddlewarePhase.PARSING);

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

        // what exists by now rather than everything registered: initialization built what had a
        // reason to be built, and a value nothing has asked for yet has nothing to say about the
        // application starting
        const injectables: unknown[] = getAllInstantiatedValues();
        await this.runLifecyclePhase(LifecyclePhase.ON_APP_START, injectables, implementsOnAppStart, async i => await i.onAppStart(this));

        this.use((req, _, next) => next(new UnmatchedRouteError(req.originalUrl)), MiddlewarePhase.AFTER_ROUTING);
        this.mountMiddleware();
        this.applyServerTimeouts();
        this.server.listen(port);
        await this.awaitListening();
        if (port === 0) {
            const address: string | AddressInfo | null = this.server.address();
            if (address != undefined && typeof address !== 'string') {
                port = address.port;
            }
        }
        GlobalRegistry.markAppAsStarted();
        await this.afterAppStart(injectables);
        this.logger.info(`${this.options.name} is running on port ${port}`);
    }

    /**
     * Bounds how long a client that has stopped making progress may hold a socket.
     *
     * Node's defaults are five minutes for a request and one for its headers, which is a long time to
     * keep a connection for a body that may never arrive - a few hundred of those and the process has
     * no descriptors left for the clients that are actually asking for something.
     * @throws When the headers are given longer than the whole request, which node would apply and
     * then never reach.
     */
    private applyServerTimeouts(): void {
        const timeouts: HttpServerTimeouts = inject(ZIBRI_DI_TOKENS.HTTP_SERVER_TIMEOUTS);
        if (timeouts.headersInMs > timeouts.requestInMs) {
            throw new InternalError(
                `The headers timeout (${timeouts.headersInMs}ms) has to be at most the request timeout (${timeouts.requestInMs}ms).`
            );
        }
        this.server.requestTimeout = timeouts.requestInMs;
        this.server.headersTimeout = timeouts.headersInMs;
        this.server.keepAliveTimeout = timeouts.keepAliveInMs;
    }

    /**
     * Waits until the port is actually bound.
     *
     * `listen` only asks, and a bind that fails announces it on the server rather than by throwing
     * where it was called. Waiting here is what lets the hooks below mean "reachable" rather than
     * "asked to be reachable", and it puts a failed bind in the way of everything that follows
     * instead of leaving it as an error event nobody is listening for. Returning also hands the
     * server over to the handler that outlives the bind.
     */
    private async awaitListening(): Promise<void> {
        // a numeric port binds while `listen` is still on the stack, so this is the ordinary path and
        // the wait below is mostly the failure one. A host name that has to be resolved first is what
        // makes it a wait at all.
        if (!this.server.listening) {
            await new Promise<void>((resolve, reject) => {
                // one object, because each handler has to take the other one back off the server: a
                // one-shot error listener left behind would answer a later failure by settling a promise
                // that is already settled, which is how a real error ends up going nowhere
                // eslint-disable-next-line jsdoc/require-jsdoc
                const handlers: { listening: () => void, error: (error: Error) => void } = {
                    listening: () => {
                        this.server.off('error', handlers.error);
                        resolve();
                    },
                    error: (error: Error) => {
                        this.server.off('listening', handlers.listening);
                        reject(error);
                    }
                };
                this.server.once('listening', handlers.listening);
                this.server.once('error', handlers.error);
            });
        }

        // reached however the port came to be bound, and only once it is. An 'error' with no listener
        // is thrown rather than delivered, and the server keeps emitting them long after the bind - a
        // burst that exhausts the file descriptors fails at accept and arrives here, so the process
        // would end over one connection it merely had to refuse.
        this.server.on('error', this.serverErrorHandler);
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
                // init() may have partially run (eg. a data source already connected in beforeAppInit)
                // before failing, so this can't just no-op: only the values that were actually
                // constructed so far are torn down — getAllInstantiatedValues() (unlike
                // getAllRegisteredTokens()) never force-constructs something the failed init never touched.
                this.logger.info('shutting down...');
                GlobalRegistry.markAppAsShuttingDown();
                for (const [signal, handler] of this.signalHandlers) {
                    process.off(signal, handler);
                }
                this.removeErrorHandlers();

                const injectables: unknown[] = getAllInstantiatedValues();
                await this.beforeAppShutdown(injectables, signal);
                await this.onAppShutdown(injectables, signal);
                await this.afterAppShutdown(injectables, signal);
                this.releaseProcess();

                if (signal != undefined) {
                    process.exit(this.shutdownFailed ? 1 : 0);
                }
                return;
            }
            case AppState.INITIALIZED:
            case AppState.STARTED: {
                this.logger.info('shutting down...');
                GlobalRegistry.markAppAsShuttingDown();
                for (const [signal, handler] of this.signalHandlers) {
                    process.off(signal, handler);
                }
                this.removeErrorHandlers();

                await this.shutdownHttpServer();
                // the same reasoning as the branch above, which only ever applied it to a failed
                // init: resolving every registered token here constructs whatever nothing used, so
                // that a value can be handed a shutdown on the first and only moment it exists
                const injectables: unknown[] = getAllInstantiatedValues();
                await this.beforeAppShutdown(injectables, signal);
                await this.onAppShutdown(injectables, signal);
                await this.afterAppShutdown(injectables, signal);
                this.releaseProcess();

                if (signal != undefined) {
                    process.exit(this.shutdownFailed ? 1 : 0);
                }
                return;
            }
        }
    }

    /**
     * Hands the process back, so that another application can be built in it.
     *
     * The last step of the lifecycle and deliberately the last thing `shutdown` does: every teardown
     * hook has already run against the services in the container, so what is left is to stop holding
     * them. Until this existed the state machine had no transition out of `SHUTTING_DOWN`, which is
     * why a process could run exactly one application - and why the framework's own test harness had
     * to assign to a private static between suites.
     *
     * What the decorators registered is untouched; see `GlobalRegistry.markAppAsOffline`.
     */
    private releaseProcess(): void {
        DiContainer.reset();
        GlobalRegistry.markAppAsOffline();
    }

    /**
     * Puts the classes the application named into the container, so that the sweeps reach them.
     *
     * A class registered on first use is recorded rather than registered, so nothing would resolve
     * it until something asked - which is the whole reason its hooks never ran. Naming it is what
     * turns that into a registration.
     * @throws When a named class is not an injectable at all.
     */
    private registerAdditionalLifecycleServices(): void {
        for (const service of this.options.additionalLifecycleServices) {
            const declared: DiProvider<unknown> | undefined = GlobalRegistry.lazyInjectables
                .find(p => p.useClass === service)
                ?? GlobalRegistry.injectables.find(p => p.useClass === service);
            if (declared == undefined) {
                throw new InternalError([
                    `"${service.name}" is named in additionalLifecycleServices and is not injectable.`,
                    'Only a class decorated with @Injectable can be built, because the decorator is'
                    + ' what records the token to build it under.'
                ]);
            }
            register(declared);
        }
    }

    /**
     * Which registered values are built before anything has asked for one.
     *
     * A decorator registers at module load, so a module imported for one of its exports registers
     * every `@Injectable` it declares - and building every registered token meant an application
     * constructed services it had never heard of, and ran their lifecycle hooks. What separates a
     * service worth building from one worth leaving alone is whether it has something to do before
     * its first use, and a class says that by declaring a hook, which is readable without
     * constructing anything.
     *
     * Everything that is not a plain class is built as it was: a factory's value cannot be read
     * without producing it, and a provider somebody wrote in the options is one somebody asked for.
     * @returns The providers to resolve, in registration order.
     */
    private providersWorthBuildingBeforeUse(): DiProvider<unknown>[] {
        return DiContainer.getInstance().getAllRegisteredProviders()
            .filter(provider => this.isWorthBuildingBeforeUse(provider));
    }

    /**
     * Whether the given provider's value has a reason to exist before something injects it.
     * @param provider - The provider to judge, without building what it provides.
     * @returns True when it is built during initialization rather than on first use.
     */
    private isWorthBuildingBeforeUse(provider: DiProvider<unknown>): boolean {
        const declaredClass: Newable<unknown> | undefined = provider.useClass;
        if (declaredClass == undefined) {
            return true;
        }
        // a provider the application wrote down is one it asked for, whatever it is made of. Reading
        // that as "only the ones that are not classes" is what let a class listed in the options go
        // unbuilt, and with it the check that reports a class shaped like a cache or a rate limiter
        // that nobody decorated - which is about classes somebody put there on purpose.
        if (this.options.providers.some(declaredProvider => declaredProvider.token === provider.token)) {
            return true;
        }
        if (this.options.additionalLifecycleServices.includes(declaredClass)) {
            return true;
        }
        // `unknown` because a construct signature declares no members, so this reads as `any` - and
        // every predicate below takes `unknown`, so nothing needs it to be narrower than it is
        const prototype: unknown = declaredClass.prototype;
        if (declaresLifecycleHook(prototype)) {
            return true;
        }
        // the kinds `validateInjectables` judges by what it was handed: one of these is reported by
        // being built, so not building it takes the report away. `@DataSource` is the one that
        // matters, because it carries no hook of its own and an undeclared one is named here.
        return MetadataUtilities.getDataSourceMetadata(declaredClass) != undefined
            || MetadataUtilities.getControllerData(declaredClass) != undefined
            || prototype instanceof ZibriPlugin
            || prototype instanceof CronJob;
    }

    /**
     * Drops every controller that says it may go unused and that this application did not ask for.
     *
     * A decorator registers at module load, so importing a module registers what it declares whether
     * or not anything wanted it - and this package's barrel exports both shipped plugins. An
     * application that writes `import { ZibriApplication } from 'zibri'` therefore has
     * `MailingListController` in its container, and startup builds every registered token: the
     * lifecycle sweeps do, and so do the three services that check nothing looks like a cache, a
     * rate limiter or a user repository without saying so. Building it asks for
     * `Repository<MailingListSubscriber>` - a table nothing in that application uses, for a feature
     * it does not run - and the application does not start.
     *
     * `allowOrphan` already says such a controller may go unused. This is the half that was missing:
     * one that goes unused is not built either. Dropped from the container rather than skipped at
     * each sweep, so that every one of them sees the same thing.
     *
     * Entities need no equivalent. A bare import registers those of both plugins too, but a
     * repository provider exists only for what a data source declares, so an unused entity costs
     * nothing until something injects a repository for it - which is what the controller was doing.
     */
    private dropUndeclaredOrphanControllers(): void {
        const container: DiContainer = DiContainer.getInstance();
        for (const provider of container.getRegisteredProvidersOfVariant(DiVariants.CONTROLLER)) {
            const controllerClass: Newable<unknown> = provider.token as Newable<unknown>;
            if (this.options.controllers.includes(controllerClass)) {
                continue;
            }
            if (!(MetadataUtilities.getControllerData(controllerClass)?.allowOrphan ?? false)) {
                // not this method's business: a controller that does *not* allow being an orphan and
                // is not declared is an error, and the router says so by name.
                continue;
            }
            container.unregister(provider.token);
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

        const reached: Set<unknown> = new Set();
        for (const token of sortedTokens) {
            // the first pass that touches every token, and the only one that can wait: a
            // `useAsyncFactory` is awaited here, so every later sweep - and every request - finds
            // its value already built and has nothing left to wait for
            const injectable: unknown = await DiContainer.getInstance().injectAsync(token);
            reached.add(injectable);
            if (implementsBeforeAppInit(injectable)) {
                await injectable.beforeAppInit(this);
            }
        }
        await this.runLifecyclePhase(
            LifecyclePhase.BEFORE_APP_INIT,
            [],
            implementsBeforeAppInit,
            async i => await i.beforeAppInit(this),
            reached
        );
    }

    private async onAppInit(injectables: unknown[]): Promise<void> {
        await this.runLifecyclePhase(LifecyclePhase.ON_APP_INIT, injectables, implementsOnAppInit, async i => await i.onAppInit(this));
    }

    private async afterAppInit(injectables: unknown[]): Promise<void> {
        await this.runLifecyclePhase(
            LifecyclePhase.AFTER_APP_INIT,
            injectables,
            implementsAfterAppInit,
            async i => await i.afterAppInit(this)
        );
    }

    private async afterAppStart(injectables: unknown[]): Promise<void> {
        await this.runLifecyclePhase(
            LifecyclePhase.AFTER_APP_START,
            injectables,
            implementsAfterAppStart,
            async i => await i.afterAppStart(this)
        );
    }

    /**
     * Runs one phase's hook on the given values, then on every value first built while it ran, and
     * marks the phase as finished.
     *
     * The list is what the phase can name before it starts, which is not everything that takes part
     * in it: a class registered on first use joins the container only when something reaches for it,
     * and a constructor or a hook of this very phase may be what does. Such a class has not missed
     * the phase yet, so it is run here rather than refused - what the container refuses is a class
     * reached once a phase it declares has finished, which is what marking it finished says.
     * @param phase - The phase being run.
     * @param values - The values it names up front, in the order they run.
     * @param declares - Whether a value declares the phase's hook.
     * @param run - Runs the hook on one value.
     * @param reached - The values the phase has already been run on.
     */
    private async runLifecyclePhase<H>(
        phase: LifecyclePhase,
        values: unknown[],
        declares: (value: unknown) => value is H,
        run: (value: H) => Promise<void>,
        reached: Set<unknown> = new Set()
    ): Promise<void> {
        let pending: unknown[] = values;
        while (pending.length) {
            for (const value of pending) {
                if (reached.has(value)) {
                    continue;
                }
                reached.add(value);
                if (declares(value)) {
                    await run(value);
                }
            }
            // again after every round, because a hook run in it may be what built the next one
            pending = getAllInstantiatedValues().filter(v => !reached.has(v) && declares(v));
        }
        GlobalRegistry.markLifecyclePhaseAsFinished(phase);
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
                // a hook is allowed to fail without stopping the others - they are independent, and
                // one broken teardown should not strand the rest. It does have to change how the
                // process ends though, or an orchestrator reads a clean exit and a rolling deploy
                // carries on as if nothing happened.
                this.shutdownFailed = true;
                this.logger.error(
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
                // a hook is allowed to fail without stopping the others - they are independent, and
                // one broken teardown should not strand the rest. It does have to change how the
                // process ends though, or an orchestrator reads a clean exit and a rolling deploy
                // carries on as if nothing happened.
                this.shutdownFailed = true;
                this.logger.error(
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
                // a hook is allowed to fail without stopping the others - they are independent, and
                // one broken teardown should not strand the rest. It does have to change how the
                // process ends though, or an orchestrator reads a clean exit and a rolling deploy
                // carries on as if nothing happened.
                this.shutdownFailed = true;
                this.logger.error(
                    error instanceof Error
                        ? error
                        : new BeforeAppShutdownError(e.constructor.name, { cause: error })
                );
            }
        }));
    }

    /**
     * Takes the error handlers back off.
     *
     * Without this every application that shuts down inside one process - which is every test file
     * that starts a server - leaves its handlers behind, and they close over an application whose
     * logger is already torn down. The server one is taken off for the same reason rather than for
     * its own: nothing accepts a connection after this point, but a late event would still reach a
     * logger that is on its way out.
     */
    private removeErrorHandlers(): void {
        process.off('unhandledRejection', this.rejectionHandler);
        process.off('uncaughtException', this.exceptionHandler);
        this.server.off('error', this.serverErrorHandler);
    }

    private async shutdownHttpServer(): Promise<void> {
        if (!this.server.listening) {
            return;
        }
        const closed: Promise<void> = new Promise((resolve, reject) => {
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

        try {
            // bounded, because server.close waits for every open connection and this runs before any
            // shutdown hook. A long poll or a streaming response would otherwise hold up everything
            // that comes after it - including handing back the leases that in flight work is holding,
            // which is the difference between the next replica taking over in seconds or waiting out
            // a full lease.
            await PromiseUtilities.withTimeout(() => closed, inject(ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS));
        }
        catch {
            this.logger.warn('requests were still running when the drain timed out, ending them');
            // stops the wait above from being unbounded rather than merely long: close on its own
            // never gives up on an open connection.
            this.server.closeAllConnections();
            await closed;
        }
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
            if (isDataSource(element) && this.isOrphanedDataSource(element)) {
                const dataSourceClass: Function = element.constructor;
                throw new InternalError([
                    `Invalid class marked with @DataSource: ${dataSourceClass.name}`,
                    'The data source has not been included in the application options.',
                    // the class name alone leaves the reader nothing to follow: a data source reaches
                    // the registry by being imported, and the import is usually indirect - a shared
                    // module pulled in for one of its other exports
                    `It was declared in ${MetadataUtilities.getFilePath(dataSourceClass) ?? 'an unknown file'}.`,
                    'Add it to the application options, or mark it @DataSource({ allowOrphan: true })'
                    + ' if defining it is not meant to mean deploying it.'
                ]);
            }
        }
    }

    /**
     * Whether a data source exists without this application, or any other, having a use for it.
     *
     * Compared by class identity rather than by name. Two data sources with the same class name in
     * different modules used to satisfy each other's check, which made the validation pass for the
     * one case it exists to catch - and a factory that builds a class per call produces exactly that,
     * every one of them named after the same declaration.
     * @param dataSource - The instantiated data source to judge.
     * @returns True when nothing claims it and it does not say it expects to be unclaimed.
     */
    private isOrphanedDataSource(dataSource: object): boolean {
        const dataSourceClass: Function = dataSource.constructor;
        if (this.options.dataSources.some(ds => ds === dataSourceClass)) {
            return false;
        }
        return !(MetadataUtilities.getDataSourceMetadata(dataSourceClass)?.allowOrphan ?? false);
    }

    /**
     * Refuses two plugins that provide the same token without the application settling it.
     *
     * Precedence inside a providers array is ordinary configuration - it is read front to back and
     * the last entry for a token wins - so a plugin listing a token twice, or the application
     * overriding one, is a decision somebody wrote down. Across two plugins there is no decision:
     * the winner would be whichever plugin is listed first, which is not something a plugin author
     * can see. The exception is the application naming the token itself, because it is registered
     * after every plugin and so has already said which implementation it wants.
     * @throws A `ProviderCollisionError` when two plugins claim a token and nothing resolves it.
     */
    private validateNoPluginProviderCollisions(): void {
        const plugins: ZibriPlugin[] = this.providedOptions.plugins ?? [];
        if (plugins.length < 2) {
            return;
        }

        const settledByApplication: Set<DiToken<unknown>> = new Set(
            (this.providedOptions.providers ?? []).map(p => p.token)
        );
        const claims: Map<DiToken<unknown>, string> = new Map();

        for (const plugin of plugins) {
            const pluginName: string = plugin.constructor.name;
            for (const provider of plugin.providers) {
                const claimedBy: string | undefined = claims.get(provider.token);
                if (claimedBy != undefined && claimedBy !== pluginName && !settledByApplication.has(provider.token)) {
                    throw new ProviderCollisionError(provider.token, claimedBy, pluginName);
                }
                claims.set(provider.token, pluginName);
            }
        }
    }

    private createFullOptions(): FullZibriApplicationOptions {
        // eslint-disable-next-line stylistic/max-len
        const hsts: DeepPartial<HstsOptions> | boolean | undefined = this.providedOptions.security?.headers?.[KnownHeader.STRICT_TRANSPORT_SECURITY];

        const res: FullZibriApplicationOptions = {
            dataSources: [],
            authStrategies: [],
            authenticators: [],
            twoFactorMethods: [],
            bodyParsers: [],
            providers: [],
            cronJobs: [],
            backupTransports: [],
            ...this.providedOptions,
            // after the spread rather than among the defaults above, because an option that is
            // present and undefined takes the default away again
            additionalLifecycleServices: this.providedOptions.additionalLifecycleServices ?? [],
            twoFactorFailureLimit: this.providedOptions.twoFactorFailureLimit ?? false,
            security: {
                headers: {
                    [KnownHeader.STRICT_TRANSPORT_SECURITY]: typeof hsts === 'boolean'
                        ? hsts
                        : {
                            ...defaultHstsOptions,
                            ...hsts
                        }
                },
                cors: this.providedOptions.security?.cors ?? defaultCorsOptions,
                trustProxy: this.providedOptions.security?.trustProxy ?? false
            }
        };
        for (const plugin of this.providedOptions.plugins ?? []) {
            res.authStrategies = [...plugin.authStrategies, ...res.authStrategies];
            res.authenticators = [...plugin.authenticators, ...res.authenticators];
            res.bodyParsers = [...plugin.bodyParsers, ...res.bodyParsers];
            res.controllers = [...plugin.controllers, ...res.controllers];
            res.cronJobs = [...plugin.cronJobs, ...res.cronJobs];
            res.providers = [...plugin.providers, ...res.providers];
        }

        if (!res.authStrategies.length) {
            res.authStrategies.push(JwtAuthStrategy);
        }
        if (!res.authenticators.length) {
            res.authenticators.push(PasswordAuthenticator);
        }
        if (!res.twoFactorMethods.length) {
            res.twoFactorMethods.push(OtpTwoFactorMethod);
        }
        if (!res.bodyParsers.length) {
            res.bodyParsers.push(JsonBodyParser, XmlBodyParser, FormDataBodyParser, FormUrlEncodedBodyParser, StreamBodyParser);
        }

        return res;
    }

    private logDefaults(): void {
        if (!this.providedOptions.authStrategies) {
            this.logger.info('No auth strategies provided, defaults to:');
            for (const strategy of this.options.authStrategies) {
                this.logger.info(`  - ${strategy.name}`);
            }
        }
        if (!this.providedOptions.authenticators) {
            this.logger.info('No authenticators provided, defaults to:');
            for (const authenticator of this.options.authenticators) {
                this.logger.info(`  - ${authenticator.name}`);
            }
        }
        if (!this.providedOptions.twoFactorMethods) {
            this.logger.info('No two factor methods provided, defaults to:');
            for (const strategy of this.options.twoFactorMethods) {
                this.logger.info(`  - ${strategy.name}`);
            }
        }
        if (!this.providedOptions.bodyParsers) {
            this.logger.info('No body parsers provided, defaults to:');
            for (const bodyParser of this.options.bodyParsers) {
                this.logger.info(`  - ${bodyParser.name}`);
            }
        }
    }

    // logged and survived, for as long as the application runs - decided, not overlooked (06 §C4).
    // The framework's own fire-and-forget work catches its own failures, so what reaches here is a
    // promise application code started and never awaited, and one of those is not worth every
    // request in flight. A failed boot is not decided here: the generated entry point catches
    // start() and exits 1.
    private readonly rejectionHandler: (reason: unknown) => void = (reason: unknown) => {
        this.logger.error(new InternalError('Unhandled promise rejection', { cause: reason }));
    };

    // logged and survived, unlike an uncaught exception. What reaches here is one connection the
    // server could not accept, and the ones already open are unaffected - ending the process over it
    // would turn a moment of pressure into an outage.
    private readonly serverErrorHandler: (error: Error) => void = (error: Error) => {
        this.logger.error(new InternalError('The http server emitted an error', { cause: error }));
    };

    private readonly exceptionHandler: (error: Error) => void = (error: Error) => {
        this.logger.error(new InternalError('Uncaught exception', { cause: error }));
        // removed first, or this same handler catches whatever the rethrow produces and loops
        process.off('uncaughtException', this.exceptionHandler);
        throw error;
    };
}