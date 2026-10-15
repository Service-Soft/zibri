import { AssetServiceInterface } from '../../assets/asset-service.interface';
import { SmsCodeLimits } from '../../auth/2fa/methods/code/sms-code-limits.model';
import { TwoFactorCodeOptions } from '../../auth/2fa/methods/code/two-factor-code-options.model';
import { OtpValidationWindowInMs } from '../../auth/2fa/methods/otp/otp.utilities';
import { TwoFactorServiceInterface } from '../../auth/2fa/two-factor-service.interface';
import { AuthServiceInterface } from '../../auth/auth-service.interface';
import { AuthRateLimitOptions } from '../../auth/auth.rate-limiter';
import { FederationOptions } from '../../auth/authenticators/federated/federation-options.model';
import { FidoMetadataServiceInterface } from '../../auth/authenticators/passkey/fido-metadata-service.interface';
import { PasskeyOptions } from '../../auth/authenticators/passkey/passkey-options.model';
import { PasskeyServiceInterface } from '../../auth/authenticators/passkey/passkey-service.interface';
import { PasswordResetEmailTemplate } from '../../auth/authenticators/password/password-reset-email-template.model';
import { AuthorizationServerServiceInterface } from '../../auth/authorization-server/authorization-server-service.interface';
import { DpopServiceInterface } from '../../auth/dpop/dpop-service.interface';
import { EncryptionKey } from '../../auth/encryption/encryption-key.model';
import { EncryptionMasterOptions } from '../../auth/encryption/encryption-master-options.model';
import { EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { EncryptionStrategyInterface } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { HashServiceInterface } from '../../auth/hash/hash-service.interface';
import { HashStrategyInterface } from '../../auth/hash/strategies/hash-strategy.interface';
import { ScryptCost } from '../../auth/hash/strategies/scrypt.hash-strategy';
import { Require2faReauth } from '../../auth/models/require-2fa-reauth.model';
import { RouteAuthConfiguration } from '../../auth/models/route-auth-configuration.model';
import { ScimServiceInterface } from '../../auth/scim/scim-service.interface';
import { ApiKeyServiceInterface } from '../../auth/strategies/api-key/api-key-service.interface';
import { CookieAuthSessionOptionsInput } from '../../auth/strategies/cookie/cookie-auth.auth-strategy';
import { AccessTokenRevocation } from '../../auth/strategies/jwt/access-token-revocation.type';
import { JwtAuthOptions, JwtAuthOptionsInput } from '../../auth/strategies/jwt/jwt-auth-options.model';
import { JwtServiceInterface } from '../../auth/strategies/jwt/jwt-service.interface';
import { UserServiceInterface } from '../../auth/user/user-service.interface';
import { BackupServiceInterface } from '../../backup/backup-service.interface';
import { WriteThroughReadThroughCache } from '../../caching/cache/read-through/write-through-read-through.cache';
import { CacheServiceInterface } from '../../caching/cache-service.interface';
import { CacheContext } from '../../context/cache/cache.context';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { CronServiceInterface } from '../../cron/cron-service.interface';
import { DataSourceServiceInterface } from '../../data-source/data-source-service.interface';
import { EmailServiceInterface } from '../../email/email-service.interface';
import { EmailConfigInput } from '../../email/models/email-config.model';
import { EmailTransportInterface } from '../../email/transports/email-transport.interface';
import { GlobalErrorHandler, ErrorPageTemplate } from '../../error-handling/error-handler.model';
import { EventServiceInterface } from '../../event/event-service.interface';
import { HandlebarOptions } from '../../handlebars/handlebar.utilities';
import { CompressionOptions } from '../../http/compression.middleware';
import { HttpServerTimeouts } from '../../http/http-server-timeouts.model';
import { HttpClientOptions, HttpClientOptionsInput } from '../../http-client/http-client-options.model';
import { HttpClientInterface } from '../../http-client/http-client.interface';
import { LeaseServiceInterface } from '../../leases/lease-service.interface';
import { LocalizeServiceInterface } from '../../localization/localize-service.interface';
import { LocalizeOptionsInput, LocalizeOptions } from '../../localization/models/localize-options.model';
import { LogLevel } from '../../logging/log-level.enum';
import { LoggerInterface } from '../../logging/logger.interface';
import { LoggerTransport, BaseLoggerTransportConfig } from '../../logging/transport/logger-transport.model';
import { MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { MultithreadingOptions } from '../../multithreading/models/multithreading-options.model';
import { MultithreadingServiceInterface } from '../../multithreading/services/multithreading-service.interface';
import { OpenApiServiceInterface } from '../../open-api/open-api-service.interface';
import { FormDataLimits } from '../../parsing/form-data/form-data-limits.model';
import { CspOptions, CspOptionsInput } from '../../parsing/html/csp-options.model';
import { ParserInterface } from '../../parsing/parser.interface';
import { RateLimiterInterface } from '../../rate-limiting/limiter/rate-limiter.interface';
import { RateLimitingServiceInterface } from '../../rate-limiting/rate-limiting-service.interface';
import { RouterInterface } from '../../routing/router.interface';
import { SmsServiceInterface } from '../../sms/sms-service.interface';
import { MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface';
import { TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { OpenTelemetrySpanExporter } from '../../tracing/open-telemetry/open-telemetry-api.model';
import { TraceBufferInterface } from '../../tracing/trace-buffer.interface';
import { TracerInterface } from '../../tracing/tracer.interface';
import { Newable } from '../../types/newable.type';
import { FsPath } from '../../utilities/fs.utilities';
import { ValidationServiceInterface } from '../../validation/validation-service.interface';
import { VersioningServiceInterface } from '../../versioning/versioning-service.interface';
import { WebsocketOptions, WebsocketOptionsInput } from '../../websocket/models/websocket-options.model';
import { WebsocketServiceInterface } from '../../websocket/services/websocket-service.interface';
import { TokenRecord } from '../models/di-token.model';
import { InjectionToken } from '../models/injection-token.model';

// eslint-disable-next-line jsdoc/require-jsdoc
function ziToken<T = never>(k: `zi.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}

/**
 * Injection Tokens used and provided by Zibri.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_DI_TOKENS = {
    // static/singleton tokens
    ZIBRI_PACKAGE_ROOT: ziToken<FsPath>('zi.zibri_package_root'),
    ROUTER: ziToken<RouterInterface>('zi.router'),
    LOGGER: ziToken<LoggerInterface>('zi.logger'),
    LOGGER_TRANSPORTS: ziToken<LoggerTransport<BaseLoggerTransportConfig>[]>('zi.logger_transports'),
    LOGGER_BUFFER_CAPACITY: ziToken<number>('zi.logger_buffer_capacity'),
    LOGGER_FLUSH_INTERVAL_MS: ziToken<number>('zi.logger_flush_interval_ms'),
    LOGGER_CLEANUP_AFTER_MS: ziToken<Record<LogLevel, number>>('zi.logger_cleanup_after_ms'),
    /**
     * Whether one line is written for every request that finishes.
     *
     * Off by default, and most applications should leave it off. The questions it usually gets turned
     * on for - a 404 storm, a spike of 400s, a route that got slower - are about counts and
     * distributions, and the metrics service already answers those from `http_requests_total` and
     * `http_request_duration_ms` at a cost that does not grow with traffic.
     *
     * What this buys instead is the individual requests rather than the shape of them: which client
     * asked for what, in what order, with which agent. That is a debugging and forensics question,
     * and it is worth its cost only while it is being asked - the default transports include the
     * database one, which keeps everything from `info` upwards, so turning this on makes the log
     * table the busiest table in the application.
     */
    ACCESS_LOG: ziToken<boolean>('zi.access_log'),
    METRICS_SERVICE: ziToken<MetricsServiceInterface>('zi.metrics_service'),
    ASSET_SERVICE: ziToken<AssetServiceInterface>('zi.asset_service'),
    BACKUP_SERVICE: ziToken<BackupServiceInterface>('zi.backup_service'),
    GLOBAL_ERROR_HANDLER: ziToken<GlobalErrorHandler>('zi.global_error_handler'),
    ERROR_PAGE_TEMPLATE: ziToken<ErrorPageTemplate | undefined>('zi.error_page_template'),
    OPEN_API_SERVICE: ziToken<OpenApiServiceInterface>('zi.open_api_service'),
    OPEN_API_AUTH: ziToken<RouteAuthConfiguration>('zi.open_api_auth'),
    AUTH_SERVICE: ziToken<AuthServiceInterface>('zi.auth_service'),
    REVALIDATE_USER_ON_AUTH_CHECK: ziToken<boolean>('zi.revalidate_user_on_auth_check'),
    /**
     * When an access token stops working once what it was issued for has ended: when it expires, or
     * immediately, which reads on every check of a token whether its login or its client still exists.
     */
    ACCESS_TOKEN_REVOCATION: ziToken<AccessTokenRevocation>('zi.access_token_revocation'),
    AUTHORIZATION_SERVER_SERVICE: ziToken<AuthorizationServerServiceInterface>('zi.authorization_server_service'),
    // eslint-disable-next-line typescript/no-explicit-any
    AUTH_RATE_LIMITER: ziToken<RateLimiterInterface<any>>('zi.auth_rate_limiter'),
    AUTH_RATE_LIMIT_OPTIONS: ziToken<AuthRateLimitOptions>('zi.auth_rate_limit_options'),
    TWO_FACTOR_SERVICE: ziToken<TwoFactorServiceInterface>('zi.two_factor_service'),
    TWO_FACTOR_FAILURE_DELAY_IN_MS: ziToken<number>('zi.two_factor_failure_delay_in_ms'),
    REQUIRE_2FA_REAUTH: ziToken<Require2faReauth>('zi.require_2fa_reauth'),
    REQUIRE_2FA_REAUTH_WINDOW_IN_MS: ziToken<number>('zi.require_2fa_reauth_window_in_ms'),
    OTP_HEADER: ziToken<string>('zi.otp_header'),
    OTP_VALIDATION_WINDOW_IN_MS: ziToken<OtpValidationWindowInMs>('zi.otp_validation_window_in_ms'),
    OTP_LENGTH: ziToken<number>('zi.otp_length'),
    PASSKEY_HEADER: ziToken<string>('zi.passkey_header'),
    EMAIL_CODE_HEADER: ziToken<string>('zi.email_code_header'),
    SMS_CODE_HEADER: ziToken<string>('zi.sms_code_header'),
    // undefined for an application that provides none, which is the one not sending codes by text message
    SMS_CODE_LIMITS: ziToken<SmsCodeLimits | undefined>('zi.sms_code_limits'),
    RECOVERY_CODE_HEADER: ziToken<string>('zi.recovery_code_header'),
    API_KEY_HEADER: ziToken<string>('zi.api_key_header'),
    API_KEY_SERVICE: ziToken<ApiKeyServiceInterface>('zi.api_key_service'),
    SCIM_SERVICE: ziToken<ScimServiceInterface>('zi.scim_service'),
    TWO_FACTOR_CODE_OPTIONS: ziToken<TwoFactorCodeOptions>('zi.two_factor_code_options'),
    PARSER: ziToken<ParserInterface>('zi.parser_service'),
    VALIDATION_SERVICE: ziToken<ValidationServiceInterface>('zi.validation_service'),
    DATA_SOURCE_SERVICE: ziToken<DataSourceServiceInterface>('zi.data_source_service'),
    SCHEMA_LOCK_TIMEOUT_IN_MS: ziToken<number>('zi.schema_lock_timeout_in_ms'),
    SCHEMA_LOCK_HOLD_IN_MS: ziToken<number>('zi.schema_lock_hold_in_ms'),
    VAL_KEY_TRANSACTION_LOCK_TIMEOUT_IN_MS: ziToken<number>('zi.val_key_transaction_lock_timeout_in_ms'),
    VAL_KEY_TRANSACTION_LOCK_HOLD_IN_MS: ziToken<number>('zi.val_key_transaction_lock_hold_in_ms'),
    HTTP_DRAIN_TIMEOUT_IN_MS: ziToken<number>('zi.http_drain_timeout_in_ms'),
    HTTP_SERVER_TIMEOUTS: ziToken<HttpServerTimeouts>('zi.http_server_timeouts'),
    COMPRESSION_OPTIONS: ziToken<CompressionOptions>('zi.compression_options'),
    LEASE_SERVICE: ziToken<LeaseServiceInterface>('zi.lease_service'),
    TENANT_SERVICE: ziToken<TenantServiceInterface>('zi.tenant_service'),
    MEMBERSHIP_SERVICE: ziToken<MembershipServiceInterface>('zi.membership_service'),
    LEASE_DRAIN_TIMEOUT_IN_MS: ziToken<number>('zi.lease_drain_timeout_in_ms'),
    JWT_AUTH_OPTIONS_INPUT: ziToken<JwtAuthOptionsInput>('zi.jwt_auth_options_input'),
    JWT_AUTH_OPTIONS: ziToken<JwtAuthOptions>('zi.jwt_auth_options'),
    JWT_SERVICE: ziToken<JwtServiceInterface>('zi.jwt_service'),
    DPOP_SERVICE: ziToken<DpopServiceInterface>('zi.dpop_service'),
    /**
     * Whether the DPoP proofs of clients carry a nonce the application issued. Defaults to false.
     */
    DPOP_NONCES: ziToken<boolean>('zi.dpop_nonces'),
    COOKIE_AUTH_SESSION_OPTIONS: ziToken<CookieAuthSessionOptionsInput>('zi.cookie_auth_session_options'),
    COOKIE_AUTH_REFRESH_SESSION_OPTIONS: ziToken<CookieAuthSessionOptionsInput>('zi.cookie_auth_refresh_session_options'),
    COOKIE_AUTH_SESSION_EXPIRES_IN_MS: ziToken<number>('zi.cookie_auth_session_expires_in_ms'),
    COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS: ziToken<number>('zi.cookie_auth_refresh_session_expires_in_ms'),
    PASSWORD_RESET_TOKEN_EXPIRES_IN_MS: ziToken<number>('zi.password_reset_token_expires_in_ms'),
    CONFIRM_PASSWORD_RESET_URL: ziToken<string | undefined>('zi.confirm_password_reset_url'),
    // eslint-disable-next-line typescript/no-explicit-any
    PASSWORD_RESET_EMAIL_TEMPLATE: ziToken<PasswordResetEmailTemplate<any, any> | undefined>('zi.password_reset_email_template'),
    FEDERATION_OPTIONS: ziToken<FederationOptions | undefined>('zi.federation_options'),
    PASSKEY_OPTIONS: ziToken<PasskeyOptions | undefined>('zi.passkey_options'),
    PASSKEY_SERVICE: ziToken<PasskeyServiceInterface>('zi.passkey_service'),
    FIDO_METADATA_SERVICE: ziToken<FidoMetadataServiceInterface>('zi.fido_metadata_service'),
    USER_SERVICE: ziToken<UserServiceInterface>('zi.user_service'),
    CRON_SERVICE: ziToken<CronServiceInterface>('zi.cron_service'),
    CRON_EXECUTION_LEASE_IN_MS: ziToken<number>('zi.cron_execution_lease_in_ms'),
    CRON_REGISTRATION_LEASE_IN_MS: ziToken<number>('zi.cron_registration_lease_in_ms'),
    FILE_UPLOAD_TEMP_FOLDER: ziToken<FsPath>('zi.file_upload_temp_folder'),
    BACKUP_TEMP_FOLDER: ziToken<FsPath>('zi.backup_temp_folder'),
    VERSIONS_PATH: ziToken<FsPath>('zi.versions_path'),
    TRANSLATIONS_PATH: ziToken<FsPath>('zi.translations_path'),
    ASSETS_PATH: ziToken<FsPath>('zi.assets_path'),
    FORM_DATA_LIMITS: ziToken<FormDataLimits>('zi.form_data_limits'),
    EMAIL_SERVICE: ziToken<EmailServiceInterface>('zi.email_service'),
    SMS_SERVICE: ziToken<SmsServiceInterface | undefined>('zi.sms_service'),
    EMAIL_CONFIG: ziToken<EmailConfigInput | undefined>('zi.email_config'),
    EMAIL_TRANSPORT: ziToken<EmailTransportInterface | undefined>('zi.email_transport'),
    // eslint-disable-next-line typescript/no-explicit-any
    EMAIL_RATE_LIMITER: ziToken<RateLimiterInterface<any>>('zi.email_rate_limiter'),
    MULTITHREADING_SERVICE: ziToken<MultithreadingServiceInterface>('zi.multithreading_service'),
    MULTITHREADING_OPTIONS: ziToken<MultithreadingOptions>('zi.multithreading_options'),
    // eslint-disable-next-line typescript/no-explicit-any
    WEBSOCKET_SERVICE: ziToken<WebsocketServiceInterface<any>>('zi.websocket_service'),
    // both undefined for an application that provides no input, which is the one without websockets
    WEBSOCKET_OPTIONS_INPUT: ziToken<WebsocketOptionsInput | undefined>('zi.websocket_options_input'),
    WEBSOCKET_OPTIONS: ziToken<WebsocketOptions | undefined>('zi.websocket_options'),
    HTTP_CLIENT: ziToken<HttpClientInterface>('zi.http_client'),
    HTTP_CLIENT_OPTIONS_INPUT: ziToken<HttpClientOptionsInput>('zi.http_client_options_input'),
    HTTP_CLIENT_OPTIONS: ziToken<HttpClientOptions>('zi.http_client_options'),
    EVENT_SERVICE: ziToken<EventServiceInterface>('zi.event_service'),
    EVENT_EXECUTION_LEASE_IN_MS: ziToken<number>('zi.event_execution_lease_in_ms'),
    EVENT_SUBSCRIBER_REGISTRATION_TTL_IN_MS: ziToken<number>('zi.event_subscriber_registration_ttl_in_ms'),
    EVENT_RETRY_DELAY_IN_MS: ziToken<number>('zi.event_retry_delay_in_ms'),
    EVENT_MAX_CONCURRENT_HOOKS: ziToken<number>('zi.event_max_concurrent_hooks'),
    /**
     * What turns the work the application does into spans somebody can look at.
     *
     * `OpenTelemetryTracer` by default, which records through the OpenTelemetry SDK and sets that
     * SDK up itself - so there is nothing to configure to have spans, and `TRACE_EXPORTER` is the
     * only thing to say to have them leave the process.
     *
     * `@opentelemetry/api` and `@opentelemetry/sdk-trace-node` are optional peers rather than
     * dependencies, so that an application registering a tracer of its own does not have to carry
     * packages it never calls. The default needs them and says so by name when one is missing.
     *
     * The trace *context* does not depend on any of this: a request arriving with a `traceparent`
     * continues that trace, a request arriving without one starts a new trace, and either way the
     * log lines of that request name it and the calls it makes carry it on. What a tracer adds is
     * the spans inside the trace.
     */
    TRACER: ziToken<TracerInterface>('zi.tracer'),
    /**
     * Where the spans the application recorded are kept so that it can answer for them itself.
     *
     * An `InMemoryTraceBuffer` of a thousand spans by default. Register one of another size to keep
     * more or less: what it holds is bounded by a count, so its cost does not grow with how long the
     * process has been running or with how much traffic it has taken.
     *
     * What it holds is a window rather than a history - at a few spans per request, a thousand of
     * them is a few hundred requests - so it answers what is happening now. Anything that has to
     * survive being asked about tomorrow leaves through `TRACE_EXPORTER`.
     */
    TRACE_BUFFER: ziToken<TraceBufferInterface>('zi.trace_buffer'),
    /**
     * Where finished spans are sent, if anywhere.
     *
     * Nothing by default, and that is what makes tracing cost nothing outside this process: spans
     * are kept in `TRACE_BUFFER` and go no further. `otlpTraceExporter()` sends them to a collector
     * over the protocol every tracing backend reads, and anything the SDK can export through works
     * here as well.
     *
     * Spans reach it in batches rather than one at a time, because a span is finished on the path of
     * every request the application answers.
     */
    TRACE_EXPORTER: ziToken<OpenTelemetrySpanExporter | undefined>('zi.trace_exporter'),
    CSRF_TOKEN_HEADER: ziToken<string>('zi.csrf_token_header'),
    COOKIE_SIGN_SECRET: ziToken<string | undefined>('zi.cookie_sign_secret'),
    HASH_SERVICE: ziToken<HashServiceInterface>('zi.hash_service'),
    HASH_STRATEGIES: ziToken<Newable<HashStrategyInterface<Record<string, unknown>>>[]>('zi.hash_strategies'),
    SCRYPT_COST: ziToken<ScryptCost>('zi.scrypt_cost'),
    ENCRYPTION_SERVICE: ziToken<EncryptionServiceInterface>('zi.encryption_service'),
    ENCRYPTION_STRATEGIES: ziToken<
        // eslint-disable-next-line typescript/no-explicit-any
        Newable<EncryptionStrategyInterface<any, any, any>>[]
    >('zi.encryption_strategies'),
    // eslint-disable-next-line typescript/no-explicit-any
    ENCRYPTION_MASTER_OPTIONS: ziToken<EncryptionMasterOptions<any, any, any> | undefined>(
        'zi.encryption_master_options'
    ),
    ENCRYPTION_KEY_CACHE: ziToken<WriteThroughReadThroughCache<string, EncryptionKey, 'EncryptionKeyCache'>>('zi.encryption_key_cache'),
    CACHE_SERVICE: ziToken<CacheServiceInterface>('zi.cache_service'),
    CACHE_INVALIDATION_RETENTION_IN_MS: ziToken<number>('zi.cache_invalidation_retention_in_ms'),
    VERSIONING_SERVICE: ziToken<VersioningServiceInterface>('zi.versioning_service'),
    VERSION_HEADER: ziToken<string>('zi.version_header'),
    VERSION_QUERY_PARAM: ziToken<string>('zi.version_query_param'),
    LOCALIZE_SERVICE: ziToken<LocalizeServiceInterface>('zi.localize_service'),
    LOCALIZE_OPTIONS_INPUT: ziToken<LocalizeOptionsInput>('zi.localize_options_input'),
    LOCALIZE_OPTIONS: ziToken<LocalizeOptions>('zi.localize_options'),
    RATE_LIMITING_SERVICE: ziToken<RateLimitingServiceInterface>('zi.rate_limiting_service'),
    HANDLEBAR_OPTIONS: ziToken<HandlebarOptions>('zi.handlebar_options'),
    DEFAULT_CSP_OPTIONS_INPUT: ziToken<CspOptionsInput>('zi.default_csp_options_input'),
    DEFAULT_CSP_OPTIONS: ziToken<CspOptions>('zi.default_csp_options'),
    // dynamic/context based tokens
    CURRENT_REQUEST_CONTEXT: ziToken<HttpRequestContext | WebsocketRequestContext | undefined>('zi.current_request_context'),
    CURRENT_CACHE_CONTEXT: ziToken<CacheContext[] | undefined>('zi.current_cache_context')
} as const satisfies TokenRecord;