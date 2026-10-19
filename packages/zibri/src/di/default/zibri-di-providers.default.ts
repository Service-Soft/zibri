/* eslint-disable jsdoc/require-jsdoc */
import os from 'node:os';

import { inject } from '../inject.function';
import { ZIBRI_DI_TOKENS } from './zibri-di-tokens.default';
import { AssetService } from '../../assets/asset.service';
import { TwoFactorService } from '../../auth/2fa/two-factor.service';
import { AuthRateLimiter } from '../../auth/auth.rate-limiter';
import { AuthService } from '../../auth/auth.service';
import { FidoMetadataService } from '../../auth/authenticators/passkey/fido-metadata.service';
import { PasskeyService } from '../../auth/authenticators/passkey/passkey.service';
import { AuthorizationServerService } from '../../auth/authorization-server/authorization-server.service';
import { DpopService } from '../../auth/dpop/dpop.service';
import { EncryptionKeyCache } from '../../auth/encryption/encryption-key.cache';
import { EncryptionService } from '../../auth/encryption/encryption.service';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { HashService } from '../../auth/hash/hash.service';
import { defaultScryptCost, ScryptHashStrategy } from '../../auth/hash/strategies/scrypt.hash-strategy';
import { Sha256HashStrategy } from '../../auth/hash/strategies/sha256.hash-strategy';
import { RouteAuthConfiguration } from '../../auth/models/route-auth-configuration.model';
import { ScimService } from '../../auth/scim/scim.service';
import { ApiKeyService } from '../../auth/strategies/api-key/api-key.service';
import { AccessTokenRevocation } from '../../auth/strategies/jwt/access-token-revocation.type';
import { JwtAuthOptionsInput } from '../../auth/strategies/jwt/jwt-auth-options.model';
import { JwtService } from '../../auth/strategies/jwt/jwt.service';
import { UserService } from '../../auth/user/user.service';
import { BackupService } from '../../backup/backup.service';
import { CacheService } from '../../caching/cache.service';
import { AlsUtilities } from '../../context/als.utilities';
import { CronService } from '../../cron/cron.service';
import { DataSourceService } from '../../data-source/data-source.service';
import { EmailRateLimiter } from '../../email/email.rate-limiter';
import { EmailService } from '../../email/email.service';
import { errorHandler } from '../../error-handling/error-handler';
import { EventService } from '../../event/event.service';
import { CompressionOptions } from '../../http/compression.middleware';
import { HttpServerLimits } from '../../http/http-server-limits.model';
import { KnownHeader } from '../../http/known-header.enum';
import { HttpClient } from '../../http-client/http-client';
import { HttpClientOptionsInput } from '../../http-client/http-client-options.model';
import { LeaseService } from '../../leases/lease.service';
import { defineDateFormat } from '../../localization/define-date-format.function';
import { LocalizeService } from '../../localization/localize.service';
import { LocalizeOptionsInput } from '../../localization/models/localize-options.model';
import { LogLevel } from '../../logging/log-level.enum';
import { Logger } from '../../logging/logger';
import { LoggerTransport } from '../../logging/transport/logger-transport.model';
import { PrometheusMetricsService } from '../../metrics/metrics.service';
import { MultithreadingService } from '../../multithreading/services/multithreading.service';
import { OpenApiService } from '../../open-api/open-api.service';
import { CspOptionsInput } from '../../parsing/html/csp-options.model';
import { Parser } from '../../parsing/parser';
import { RateLimitingService } from '../../rate-limiting/rate-limiting.service';
import { Router } from '../../routing/router';
import { MembershipService } from '../../tenancy/membership/membership.service';
import { TenantService } from '../../tenancy/tenant.service';
import { InMemoryTraceBuffer } from '../../tracing/in-memory.trace-buffer';
import { OpenTelemetryTracer } from '../../tracing/open-telemetry/open-telemetry.tracer';
import { FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { resolveAppRoot } from '../../utilities/resolve-app-root.function';
import { resolveZibriRoot } from '../../utilities/resolve-zibri-root.function';
import { ValidationService } from '../../validation/validation.service';
import { VersioningService } from '../../versioning/versioning.service';
import { WebsocketOptions, WebsocketOptionsInput } from '../../websocket/models/websocket-options.model';
import { WebsocketService } from '../../websocket/services/websocket.service';
import { DiTokenProviderRecord } from '../models/di-token.model';
import { DiVariants } from '../models/di-variant.model';

const allThreads: number = os.availableParallelism();

const reserveThreadsMain: number = 1;
const reserveThreadsLibUv: number = Number(process.env['UV_THREADPOOL_SIZE'] ?? '4');

const availableThreads: number = allThreads - reserveThreadsLibUv - reserveThreadsMain;

const maxThreads: number = Math.max(1, availableThreads - 1);
const maxPriorityThreads: number = availableThreads <= 1 ? 0 : 1;

export const ZIBRI_DI_PROVIDERS: DiTokenProviderRecord<typeof ZIBRI_DI_TOKENS> = {
    ZIBRI_PACKAGE_ROOT: { useFactory: () => resolveZibriRoot() },
    ROUTER: { useClass: Router },
    LOGGER: { useClass: Logger },
    LOGGER_TRANSPORTS: {
        useFactory: () => [
            LoggerTransport.console(LogLevel.INFO),
            LoggerTransport.db(LogLevel.INFO)
        ]
    },
    LOGGER_BUFFER_CAPACITY: { useFactory: () => 10000 },
    // how long entries are allowed to gather before they are written, so that entries logged near
    // each other share one write. Zero writes each entry on its own, which is what the batching
    // exists to replace - a request that logs one line would be one INSERT again.
    // Long enough that an application logging a line per request writes once for many of them, and
    // short enough that a crash loses at most a second of entries. Anything shorter stops batching
    // the traffic that made batching worth doing: a service handling a few requests a second is
    // quiet on a 100ms window, so each line would still be written on its own.
    LOGGER_FLUSH_INTERVAL_MS: { useFactory: () => Ms.SECOND },
    ACCESS_LOG: { useFactory: () => false },
    LOGGER_CLEANUP_AFTER_MS: {
        useFactory: () => ({
            [LogLevel.DEBUG]: Ms.WEEK * 2,
            [LogLevel.INFO]: Ms.WEEK * 2,
            [LogLevel.WARN]: Ms.WEEK * 2,
            [LogLevel.ERROR]: Ms.WEEK * 2,
            [LogLevel.CRITICAL]: Ms.WEEK * 2
        })
    },
    METRICS_SERVICE: { useClass: PrometheusMetricsService },
    ASSET_SERVICE: { useClass: AssetService },
    BACKUP_SERVICE: { useClass: BackupService },
    GLOBAL_ERROR_HANDLER: { useFactory: () => errorHandler },
    ERROR_PAGE_TEMPLATE: { useFactory: () => undefined },
    OPEN_API_SERVICE: { useClass: OpenApiService },
    // the explorer, its scripts and the spec, public rather than behind `defaultAuth`. A browser
    // reaches the explorer by navigating to it, and a navigation carries no Authorization header, so
    // inheriting a login requirement would leave a bearer token application with an explorer nobody
    // can open rather than one only its callers can. An api whose endpoint map is not for everyone
    // says so here - `{}` puts it behind the application's default, and any other route auth
    // configuration behind exactly what it names.
    OPEN_API_AUTH: { useFactory: (): RouteAuthConfiguration => ({ skip: true }) },
    PARSER: { useClass: Parser },
    VALIDATION_SERVICE: { useClass: ValidationService },
    DATA_SOURCE_SERVICE: { useClass: DataSourceService },
    SCHEMA_LOCK_TIMEOUT_IN_MS: { useFactory: () => Ms.MINUTE },
    SCHEMA_LOCK_HOLD_IN_MS: { useFactory: () => Ms.SECOND * 30 },
    VAL_KEY_TRANSACTION_LOCK_TIMEOUT_IN_MS: { useFactory: () => Ms.SECOND * 10 },
    VAL_KEY_TRANSACTION_LOCK_HOLD_IN_MS: { useFactory: () => Ms.SECOND * 30 },
    // how long open requests get to finish before the rest of the shutdown goes ahead without them.
    // Everything else waits behind this, so it has to leave room inside the orchestrator's own grace
    // period rather than use all of it.
    HTTP_DRAIN_TIMEOUT_IN_MS: { useFactory: () => Ms.SECOND * 10 },
    // narrower than node's own five minutes and one minute, because both of those are shaped for a
    // server on a network somebody trusts. keepAlive is node's default and is here to be raised: only
    // the deployment knows what sits in front of the application.
    // a kilobyte, because below it the encoding header is most of what the client would receive. On
    // rather than off: a client that cannot read an encoding never asks for one, so an application
    // already behind something that compresses only ever finds this doing nothing.
    COMPRESSION_OPTIONS: { useFactory: (): CompressionOptions => ({ enabled: true, thresholdInBytes: 1024 }) },
    // handlerInMs bounds the other side of the same request: the three above are all satisfied the
    // moment it has arrived, and nothing after that stops the handler it reached. Thirty seconds
    // because it is long enough that no ordinary endpoint reaches it and short enough that a client
    // still has an answer before it gives up on its own.
    // A hundred headers is what apache and haproxy accept by default, and far above what a browser
    // or a client behind a few proxies sends; node's own 2000 only bounds what the size limit
    // already does. The size is node's own default.
    HTTP_SERVER_LIMITS: {
        useFactory: (): HttpServerLimits => ({
            requestInMs: Ms.SECOND * 60,
            headersInMs: Ms.SECOND * 15,
            keepAliveInMs: Ms.SECOND * 5,
            handlerInMs: Ms.SECOND * 30,
            maxHeaderCount: 100,
            maxHeaderSizeInBytes: 16 * 1024
        })
    },
    LEASE_SERVICE: { useClass: LeaseService },
    TENANT_SERVICE: { useClass: TenantService },
    MEMBERSHIP_SERVICE: { useClass: MembershipService },
    // how long a shutting down instance waits for work it holds a lease on before taking the lease
    // away. Comfortably inside the shutdown timeout, or the hook is cut off before it can release.
    LEASE_DRAIN_TIMEOUT_IN_MS: { useFactory: () => Ms.SECOND * 10 },
    AUTH_SERVICE: { useClass: AuthService },
    REVALIDATE_USER_ON_AUTH_CHECK: { useFactory: () => true },
    ACCESS_TOKEN_REVOCATION: { useFactory: (): AccessTokenRevocation => 'onExpiry' },
    AUTHORIZATION_SERVER_SERVICE: { useClass: AuthorizationServerService },
    AUTH_RATE_LIMITER: { useClass: AuthRateLimiter, variants: [DiVariants.RATE_LIMITER] },
    AUTH_RATE_LIMIT_OPTIONS: { useFactory: () => ({ maxAttempts: 20, windowInMs: Ms.MINUTE * 10 }) },
    TWO_FACTOR_SERVICE: { useClass: TwoFactorService },
    // the wait after the first wrong code, doubling with each one after it - so a typo costs a
    // second, and a guesser is down to a few dozen codes a year
    TWO_FACTOR_FAILURE_DELAY_IN_MS: { useFactory: () => Ms.SECOND },
    // a second factor only, unless the application or the route says otherwise. A recent login is
    // the weaker proof - it is the factor the session already rests on - so accepting it is a
    // loosening that has to be stated rather than the default
    REQUIRE_2FA_REAUTH: { useFactory: () => false },
    REQUIRE_2FA_REAUTH_WINDOW_IN_MS: { useFactory: () => Ms.MINUTE * 5 },
    OTP_HEADER: { useFactory: () => 'x-authorization-otp' },
    OTP_VALIDATION_WINDOW_IN_MS: { useFactory: () => 30_000 },
    OTP_LENGTH: { useFactory: () => 6 },
    PASSKEY_HEADER: { useFactory: () => 'x-authorization-passkey' },
    EMAIL_CODE_HEADER: { useFactory: () => 'x-authorization-email-code' },
    SMS_CODE_HEADER: { useFactory: () => 'x-authorization-sms-code' },
    SMS_CODE_LIMITS: { useFactory: () => undefined },
    RECOVERY_CODE_HEADER: { useFactory: () => 'x-authorization-recovery-code' },
    API_KEY_HEADER: { useFactory: () => 'x-api-key' },
    API_KEY_SERVICE: { useClass: ApiKeyService },
    API_KEY_OPTIONS: { useFactory: () => ({}) },
    SCIM_SERVICE: { useClass: ScimService },
    TWO_FACTOR_CODE_OPTIONS: { useFactory: () => ({}) },
    USER_SERVICE: { useClass: UserService },
    PASSWORD_RESET_EMAIL_TEMPLATE: { useFactory: () => undefined },
    JWT_AUTH_OPTIONS_INPUT: { useFactory: () => ({}) },
    JWT_SERVICE: { useClass: JwtService },
    DPOP_SERVICE: { useClass: DpopService },
    DPOP_NONCES: { useFactory: () => false },
    JWT_AUTH_OPTIONS: {
        useFactory: () => {
            const input: JwtAuthOptionsInput = inject(ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT);
            return {
                accessTokenKey: undefined,
                previousAccessTokenKeys: [],
                accessTokenExpiresInMs: Ms.HOUR,
                refreshTokenSecret: undefined,
                previousRefreshTokenSecrets: [],
                // a refresh token is a live login for as long as it lasts, so this is how long a
                // stolen one is worth stealing. 30 days is the usual "stay signed in" window; 100
                // was a third of a year.
                refreshTokenExpiresInMs: 30 * Ms.DAY,
                requireDpop: false,
                ...input
            };
        }
    },
    CRON_SERVICE: { useClass: CronService },
    CRON_EXECUTION_LEASE_IN_MS: { useFactory: () => Ms.MINUTE * 5 },
    CRON_REGISTRATION_LEASE_IN_MS: { useFactory: () => Ms.SECOND * 30 },
    EMAIL_SERVICE: { useClass: EmailService },
    SMS_SERVICE: { useFactory: () => undefined },
    EMAIL_RATE_LIMITER: { useClass: EmailRateLimiter, variants: [DiVariants.RATE_LIMITER] },
    EMAIL_CONFIG: { useFactory: () => undefined },
    // no default, the same way EMAIL_CONFIG has none: every transport needs something only the
    // deployment knows - an smtp host and credentials, or an api key - so there is nothing to
    // default to. EmailService names SmtpEmailTransport when it finds none.
    EMAIL_TRANSPORT: { useFactory: () => undefined },
    FILE_UPLOAD_TEMP_FOLDER: { useFactory: () => FsUtilities.getPath(resolveAppRoot(), '.zibri', 'uploads') },
    // where a backup is written on its way to a transport and read on its way back. On this
    // instance's own disk rather than on shared storage: what lives here is one instance's work in
    // progress, and it needs room for the largest archive being written or restored at a time
    BACKUP_TEMP_FOLDER: { useFactory: () => FsUtilities.getPath(resolveAppRoot(), '.zibri', 'backups') },
    // none, so that stopping a running backup and putting back what a running restore applied fits
    // the 30 seconds most orchestrators give a process before they kill it
    BACKUP_SHUTDOWN_WAIT_IN_MS: { useValue: 0 },
    // the route history belongs to the deployment, so it is resolved from the application's root:
    // an installed copy of the framework is the one place it must not land, and that is where
    // resolving it from this file put it for an application that does not bundle.
    VERSIONS_PATH: { useFactory: () => FsUtilities.getPath(resolveAppRoot(), 'versions') },
    // beside the bundle rather than at the application's root, which is where a build copies them
    // to. The two differ on purpose: a version file is written at runtime and read by the next
    // deployment, while a translation is built once and shipped with what reads it.
    TRANSLATIONS_PATH: { useFactory: () => FsUtilities.getPath(__dirname, 'translations') },
    // beside the bundle for the same reason as the translations: a build copies them there and
    // nothing writes to them at runtime. A token rather than a field of the asset service, because an
    // application that does not bundle resolves this file inside the installed framework, and the
    // service derives its public and template folders from it while it is built.
    ASSETS_PATH: { useFactory: () => FsUtilities.getPath(__dirname, 'assets') },
    FORM_DATA_LIMITS: { useFactory: () => ({ maxFiles: 20, maxParts: 1000, maxFields: 500 }) },
    PASSWORD_RESET_TOKEN_EXPIRES_IN_MS: { useFactory: () => 300000 },
    CONFIRM_PASSWORD_RESET_URL: { useFactory: () => undefined },
    FEDERATION_OPTIONS: { useFactory: () => undefined },
    // no default: the site passkeys are bound to and the pages allowed to use them are the
    // deployment's, and a guess would bind every passkey to the wrong one
    PASSKEY_OPTIONS: { useFactory: () => undefined },
    PASSKEY_SERVICE: { useClass: PasskeyService },
    FIDO_METADATA_SERVICE: { useClass: FidoMetadataService },
    MULTITHREADING_OPTIONS: {
        useFactory: () => ({
            maxThreads,
            maxPriorityThreads,
            defaultTimeoutMs: Ms.HOUR,
            defaultTimeoutPriorityMs: Ms.MINUTE * 5,
            jobClaimInMs: Ms.SECOND * 30,
            enableTsWorkerFiles: true
        })
    },
    MULTITHREADING_SERVICE: { useClass: MultithreadingService },
    WEBSOCKET_SERVICE: { useClass: WebsocketService },
    // handlerInMs bounds this server's own code, the way the http one does. Thirty seconds for the
    // same reason: long enough that no ordinary event reaches it, short enough that a client hears
    // something before it gives up
    WEBSOCKET_OPTIONS_INPUT: { useFactory: () => undefined },
    WEBSOCKET_OPTIONS: {
        useFactory: (): WebsocketOptions | undefined => {
            const input: WebsocketOptionsInput | undefined = inject(ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT);
            // no default for how long messages are kept: it is how long a client may be away and still
            // be sent what it missed, which only the application knows. Undefined rather than refused
            // here, because a factory is built in every application while it starts; the websocket
            // service refuses it once it knows the application has websockets
            if (input == undefined) {
                return undefined;
            }
            return {
                timeoutInMs: Ms.SECOND * 5,
                handlerInMs: Ms.SECOND * 30,
                isAllowedToConnect: () => true,
                maxReplayedMessages: 1000,
                ...input
            };
        }
    },
    HTTP_CLIENT: { useClass: HttpClient },
    HTTP_CLIENT_OPTIONS_INPUT: { useFactory: () => ({}) },
    HTTP_CLIENT_OPTIONS: {
        useFactory: () => {
            const input: HttpClientOptionsInput = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT_OPTIONS_INPUT);
            return {
                defaultTimeoutMs: Ms.SECOND * 5,
                defaultMaxResponseSize: '10mb',
                // on by default: an application that never thought about it is the one whose every
                // request would otherwise wait out a timeout against a dependency that is down
                circuitBreaker: { failuresToOpen: 5, openForMs: Ms.SECOND * 30 },
                ...input
            };
        }
    },
    EVENT_SERVICE: { useClass: EventService },
    EVENT_EXECUTION_LEASE_IN_MS: { useFactory: () => Ms.MINUTE },
    EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS: { useFactory: () => Ms.MINUTE },
    // the same as the execution lease on purpose: a failed attempt keeps its grant until that
    // lapses, so a shorter delay here would be a number that never decides anything
    EVENT_RETRY_DELAY_IN_MS: { useFactory: () => Ms.MINUTE },
    // the same number PromiseUtilities chunks by, because it answers the same question: how much of
    // a backlog one instance takes on at once
    EVENT_MAX_CONCURRENT_HOOKS: { useFactory: () => 50 },
    // no default: keeping every failed event and deleting them after a while are both legitimate,
    // so only the application can say which. Undefined rather than refused here, so that the event
    // service's onAppInit names the token in the error rather than DI failing on it
    EVENT_FAILED_RETENTION_IN_MS: { useFactory: () => undefined },
    TRACER: { useClass: OpenTelemetryTracer },
    TRACE_BUFFER: { useFactory: () => new InMemoryTraceBuffer() },
    // nothing, which is what keeps tracing free of anything outside this process until an
    // application says otherwise. A default of "send to localhost" would have every deployment
    // that never configured a collector making a request every few seconds that nothing answers
    TRACE_EXPORTER: { useFactory: () => undefined },
    CSRF_TOKEN_HEADER: { useValue: 'x-csrf-token' },
    COOKIE_AUTH_SESSION_OPTIONS: {
        useValue: {
            name: 'sessionId',
            sameSite: 'lax',
            path: '/'
        }
    },
    COOKIE_AUTH_REFRESH_SESSION_OPTIONS: {
        useValue: {
            name: 'refreshSessionId',
            sameSite: 'lax',
            path: '/'
        }
    },
    COOKIE_SIGN_SECRET: { useValue: undefined },
    COOKIE_AUTH_SESSION_EXPIRES_IN_MS: { useValue: Ms.DAY },
    // the cookie equivalent of the refresh token above, and the same reasoning
    COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS: { useValue: Ms.DAY * 30 },
    HASH_SERVICE: { useClass: HashService },
    // scrypt first, and it is the one an unqualified hash uses. Sha256HashStrategy is here so that a
    // property can ask for it by name - it is deterministic, so the service refuses it as the
    // default whatever order this array is in.
    HASH_STRATEGIES: { useValue: [ScryptHashStrategy, Sha256HashStrategy] },
    // what one password derivation costs. Roughly 128MB and a few hundred ms each, which is the
    // point - and the reason it is a provider: it is the one security parameter whose right value
    // depends on the host rather than on the framework.
    SCRYPT_COST: { useValue: defaultScryptCost },
    ENCRYPTION_SERVICE: { useClass: EncryptionService },
    ENCRYPTION_STRATEGIES: { useValue: [AesGcmEncryptionStrategy] },
    ENCRYPTION_MASTER_OPTIONS: { useValue: undefined },
    ENCRYPTION_KEY_CACHE: { useClass: EncryptionKeyCache, variants: [DiVariants.CACHE] },
    CACHE_SERVICE: { useClass: CacheService },
    CACHE_INVALIDATION_RETENTION_IN_MS: { useFactory: () => Ms.MINUTE },
    VERSIONING_SERVICE: { useClass: VersioningService },
    VERSION_HEADER: { useValue: KnownHeader.X_VERSION },
    VERSION_QUERY_PARAM: { useValue: 'version' },
    LOCALIZE_SERVICE: { useClass: LocalizeService },
    LOCALIZE_OPTIONS_INPUT: { useFactory: () => ({}) },
    LOCALIZE_OPTIONS: {
        useFactory: () => {
            const input: LocalizeOptionsInput = inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT);
            return {
                defaultLocale: 'en-US',
                supportedLocales: {
                    'en-US': {
                        currencyCode: 'USD',
                        defaultDateFormat: defineDateFormat('MM/DD/YYYY'),
                        defaultDateTimeFormat: defineDateFormat('MM/DD/YYYY h:mm A'),
                        defaultTimeFormat: defineDateFormat('h:mm A')
                    }
                },
                localeQueryParam: 'locale',
                defaultTimezone: 'UTC',
                ...input
            };
        }
    },
    RATE_LIMITING_SERVICE: { useClass: RateLimitingService },
    HANDLEBAR_OPTIONS: { useValue: {} },
    DEFAULT_CSP_OPTIONS_INPUT: { useFactory: () => ({}) },
    // no nonce here: the router adds the request's own to script-src as each response is written,
    // which is what keeps a response that outlives its request - a cached page - from handing every
    // later visitor the nonce the first one was given
    DEFAULT_CSP_OPTIONS: {
        useFactory: () => {
            const input: CspOptionsInput = inject(ZIBRI_DI_TOKENS.DEFAULT_CSP_OPTIONS_INPUT);
            return {
                baseUri: ['\'self\''],
                connectSrc: [],
                defaultSrc: ['\'self\''],
                fontSrc: [],
                formAction: ['\'self\''],
                frameAncestors: ['\'self\''],
                imgSrc: [],
                mediaSrc: [],
                objectSrc: ['\'none\''],
                scriptSrc: ['\'self\''],
                scriptSrcAttr: ['\'none\''],
                styleSrc: [],
                ...input
            };
        }
    },
    // dynamic
    CURRENT_REQUEST_CONTEXT: {
        useFactory: () => AlsUtilities.getCurrentRequestContext(),
        scope: 'transient'
    },
    CURRENT_CACHE_CONTEXT: {
        useFactory: () => AlsUtilities.getCurrentCacheContext(),
        scope: 'transient'
    }
};