import { AssetServiceInterface } from '../../assets/asset-service.interface';
import { TwoFactorServiceInterface } from '../../auth/2fa/two-factor-service.interface';
import { AuthServiceInterface } from '../../auth/auth-service.interface';
import { EncryptionMasterOptions } from '../../auth/encryption/encryption-master-options.model';
import { EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { EncryptionStrategyInterface } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { HashServiceInterface } from '../../auth/hash/hash-service.interface';
import { HashStrategyInterface } from '../../auth/hash/strategies/hash-strategy.interface';
import { CookieAuthSessionOptionsInput } from '../../auth/strategies/cookie/cookie-auth.auth-strategy';
import { PasswordResetEmailTemplate } from '../../auth/strategies/jwt/jwt-auth.controller';
import { UserServiceInterface } from '../../auth/user/user-service.interface';
import { BackupServiceInterface } from '../../backup/backup-service.interface';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { CronServiceInterface } from '../../cron/cron-service.interface';
import { DataSourceServiceInterface } from '../../data-source/data-source-service.interface';
import { EmailServiceInterface } from '../../email/email-service.interface';
import { EmailConfigInput } from '../../email/models/email-config.model';
import { GlobalErrorHandler, ErrorPageTemplate } from '../../error-handling/error-handler.model';
import { EventServiceInterface } from '../../event/event-service.interface';
import { HttpClientInterface } from '../../http-client/http-client.interface';
import { FormatDateFn } from '../../localization/formatting/format-date-fn.model';
import { FormatPercentFn } from '../../localization/formatting/format-percent-fn.model';
import { FormatPriceFn } from '../../localization/formatting/format-price-fn.model';
import { LocalizeOptionsInput, LocalizeOptions } from '../../localization/models/localize-options.model';
import { LogLevel } from '../../logging/log-level.enum';
import { LoggerInterface } from '../../logging/logger.interface';
import { LoggerTransport, BaseLoggerTransportConfig } from '../../logging/transport/logger-transport.model';
import { MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { MultithreadingOptions } from '../../multithreading/models/multithreading-options.model';
import { MultithreadingServiceInterface } from '../../multithreading/services/multithreading-service.interface';
import { OpenApiServiceInterface } from '../../open-api/open-api-service.interface';
import { CspOptions } from '../../parsing/html/csp-options.model';
import { ParserInterface } from '../../parsing/parser.interface';
import { RouterInterface } from '../../routing/router.interface';
import { Newable } from '../../types/newable.type';
import { FsPath } from '../../utilities/fs.utilities';
import { ValidationServiceInterface } from '../../validation/validation-service.interface';
import { WebsocketOptions } from '../../websocket/models/websocket-options.model';
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
    ROUTER: ziToken<RouterInterface>('zi.router'),
    LOGGER: ziToken<LoggerInterface>('zi.logger'),
    LOGGER_TRANSPORTS: ziToken<LoggerTransport<BaseLoggerTransportConfig>[]>('zi.logger_transports'),
    LOGGER_CLEANUP_AFTER_MS: ziToken<Record<LogLevel, number>>('zi.logger_cleanup_after_ms'),
    METRICS_SERVICE: ziToken<MetricsServiceInterface>('zi.metrics_service'),
    ASSET_SERVICE: ziToken<AssetServiceInterface>('zi.asset_service'),
    BACKUP_SERVICE: ziToken<BackupServiceInterface>('zi.backup_service'),
    GLOBAL_ERROR_HANDLER: ziToken<GlobalErrorHandler>('zi.global_error_handler'),
    ERROR_PAGE_TEMPLATE: ziToken<ErrorPageTemplate | undefined>('zi.error_page_template'),
    OPEN_API_SERVICE: ziToken<OpenApiServiceInterface>('zi.open_api_service'),
    AUTH_SERVICE: ziToken<AuthServiceInterface>('zi.auth_service'),
    TWO_FACTOR_SERVICE: ziToken<TwoFactorServiceInterface>('zi.two_factor_service'),
    OTP_HEADER: ziToken<string>('zi.otp_header'),
    OTP_LENGTH: ziToken<number>('zi.otp_length'),
    PARSER: ziToken<ParserInterface>('zi.parser_service'),
    VALIDATION_SERVICE: ziToken<ValidationServiceInterface>('zi.validation_service'),
    DATA_SOURCE_SERVICE: ziToken<DataSourceServiceInterface>('zi.data_source_service'),
    JWT_ACCESS_TOKEN_SECRET: ziToken<string | undefined>('zi.jwt_access_token_secret'),
    JWT_ACCESS_TOKEN_EXPIRES_IN_MS: ziToken<number>('zi.jwt_access_token_expires_in_ms'),
    JWT_REFRESH_TOKEN_SECRET: ziToken<string | undefined>('zi.jwt_refresh_token_secret'),
    JWT_REFRESH_TOKEN_EXPIRES_IN_MS: ziToken<number>('zi.jwt_refresh_token_expires_in_ms'),
    COOKIE_AUTH_SESSION_OPTIONS: ziToken<CookieAuthSessionOptionsInput>('zi.cookie_auth_session_options'),
    COOKIE_AUTH_REFRESH_SESSION_OPTIONS: ziToken<CookieAuthSessionOptionsInput>('zi.cookie_auth_refresh_session_options'),
    COOKIE_AUTH_SESSION_EXPIRES_IN_MS: ziToken<number>('zi.cookie_auth_session_expires_in_ms'),
    COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS: ziToken<number>('zi.cookie_auth_refresh_session_expires_in_ms'),
    PASSWORD_RESET_TOKEN_EXPIRES_IN_MS: ziToken<number>('zi.password_reset_token_expires_in_ms'),
    CONFIRM_PASSWORD_RESET_URL: ziToken<string | undefined>('zi.confirm_password_reset_url'),
    // eslint-disable-next-line typescript/no-explicit-any
    PASSWORD_RESET_EMAIL_TEMPLATE: ziToken<PasswordResetEmailTemplate<any, any> | undefined>('zi.password_reset_email_template'),
    USER_SERVICE: ziToken<UserServiceInterface>('zi.user_service'),
    CRON_SERVICE: ziToken<CronServiceInterface>('zi.cron_service'),
    FILE_UPLOAD_TEMP_FOLDER: ziToken<FsPath>('zi.file_upload_temp_folder'),
    LOCALIZE_OPTIONS_INPUT: ziToken<LocalizeOptionsInput>('zi.localize_options_input'),
    LOCALIZE_OPTIONS: ziToken<LocalizeOptions>('zi.localize_options'),
    FORMAT_DATE: ziToken<FormatDateFn>('zi.format_date'),
    FORMAT_PRICE: ziToken<FormatPriceFn>('zi.format_price'),
    FORMAT_PERCENT: ziToken<FormatPercentFn>('zi.format_percent'),
    EMAIL_SERVICE: ziToken<EmailServiceInterface>('zi.email_service'),
    EMAIL_CONFIG: ziToken<EmailConfigInput | undefined>('zi.email_config'),
    MULTITHREADING_SERVICE: ziToken<MultithreadingServiceInterface>('zi.multithreading_service'),
    MULTITHREADING_OPTIONS: ziToken<MultithreadingOptions>('zi.multithreading_options'),
    // eslint-disable-next-line typescript/no-explicit-any
    WEBSOCKET_SERVICE: ziToken<WebsocketServiceInterface<any>>('zi.websocket_service'),
    WEBSOCKET_OPTIONS: ziToken<WebsocketOptions>('zi.websocket_options'),
    HTTP_CLIENT: ziToken<HttpClientInterface>('zi.http_client'),
    EVENT_SERVICE: ziToken<EventServiceInterface<Record<string, unknown>>>('zi.event_service'),
    CORRELATION_ID_HEADER: ziToken<string>('zi.correlation_id_header'),
    CSRF_TOKEN_HEADER: ziToken<string>('zi.csrf_token_header'),
    DEFAULT_CSP_OPTIONS: ziToken<CspOptions>('zi.default_csp_options'),
    COOKIE_SIGN_SECRET: ziToken<string | undefined>('zi.cookie_sign_secret'),
    HASH_SERVICE: ziToken<HashServiceInterface>('zi.hash_service'),
    HASH_STRATEGIES: ziToken<Newable<HashStrategyInterface<Record<string, unknown>>>[]>('zi.hash_strategies'),
    ENCRYPTION_SERVICE: ziToken<EncryptionServiceInterface>('zi.encryption_service'),
    ENCRYPTION_STRATEGIES: ziToken<
        // eslint-disable-next-line typescript/no-explicit-any
        Newable<EncryptionStrategyInterface<any, any, any>>[]
    >('zi.encryption_strategies'),
    // eslint-disable-next-line typescript/no-explicit-any
    ENCRYPTION_MASTER_OPTIONS: ziToken<EncryptionMasterOptions<any, any, any> | undefined>(
        'zi.encryption_master_options'
    ),
    // dynamic/context based tokens
    CURRENT_REQUEST_CONTEXT: ziToken<HttpRequestContext | WebsocketRequestContext | undefined>('zi.current_request_context')
} as const satisfies TokenRecord;