import { AssetServiceInterface } from '../../assets';
import { AuthServiceInterface, TwoFactorServiceInterface, UserServiceInterface } from '../../auth';
import { BackupServiceInterface } from '../../backup';
import { CronServiceInterface } from '../../cron';
import { DataSourceServiceInterface } from '../../data-source';
import { EmailConfigInput, EmailServiceInterface, MailingListServiceInterface } from '../../email';
import { GlobalErrorHandler } from '../../error-handling';
import { HttpRequest } from '../../http';
import { HttpClientInterface } from '../../http-client';
import { FormatDateFn, FormatPercentFn, FormatPriceFn, LocalizeOptions, LocalizeOptionsInput } from '../../localization';
import { BaseLoggerTransportConfig, LoggerInterface, LoggerTransport, LogLevel } from '../../logging';
import { MetricsServiceInterface } from '../../metrics';
import { MultithreadingOptions, MultithreadingServiceInterface } from '../../multithreading';
import { OpenApiServiceInterface } from '../../open-api';
import { ParserInterface } from '../../parsing';
import { RouterInterface } from '../../routing';
import { ValidationServiceInterface } from '../../validation';
import { WebsocketOptions, WebsocketServiceInterface } from '../../websocket';
import { InjectionToken, TokenRecord } from '../models';

// eslint-disable-next-line jsdoc/require-jsdoc
function ziToken<T = never>(k: `zi.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}

/**
 * Injection Tokens used and provided by Zibri.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_DI_TOKENS = {
    ROUTER: ziToken<RouterInterface>('zi.router'),
    LOGGER: ziToken<LoggerInterface>('zi.logger'),
    LOGGER_TRANSPORTS: ziToken<LoggerTransport<BaseLoggerTransportConfig>[]>('zi.logger_transports'),
    LOGGER_CLEANUP_AFTER_MS: ziToken<Record<LogLevel, number>>('zi.logger_cleanup_after_ms'),
    METRICS_SERVICE: ziToken<MetricsServiceInterface>('zi.metrics_service'),
    ASSET_SERVICE: ziToken<AssetServiceInterface>('zi.asset_service'),
    BACKUP_SERVICE: ziToken<BackupServiceInterface>('zi.backup_service'),
    GLOBAL_ERROR_HANDLER: ziToken<GlobalErrorHandler>('zi.global_error_handler'),
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
    JWT_PASSWORD_RESET_TOKEN_EXPIRES_IN_MS: ziToken<number>('zi.jwt_password_reset_token_expires_in_ms'),
    JWT_CONFIRM_PASSWORD_RESET_URL: ziToken<string | undefined>('zi.jwt_confirm_password_reset_url'),
    MAILING_LIST_SUBSCRIPTION_CONFIRMATION_TOKEN_EXPIRES_IN_MS: ziToken<number>(
        'zi.mailing_list_subscription_confirmation_token_expires_in_ms'
    ),
    USER_SERVICE: ziToken<UserServiceInterface>('zi.user_service'),
    CRON_SERVICE: ziToken<CronServiceInterface>('zi.cron_service'),
    FILE_UPLOAD_TEMP_FOLDER: ziToken<string>('zi.file_upload_temp_folder'),
    LOCALIZE_OPTIONS_INPUT: ziToken<LocalizeOptionsInput>('zi.localize_options_input'),
    LOCALIZE_OPTIONS: ziToken<LocalizeOptions>('zi.localize_options'),
    FORMAT_DATE: ziToken<FormatDateFn>('zi.format_date'),
    FORMAT_PRICE: ziToken<FormatPriceFn>('zi.format_price'),
    FORMAT_PERCENT: ziToken<FormatPercentFn>('zi.format_percent'),
    EMAIL_SERVICE: ziToken<EmailServiceInterface>('zi.email_service'),
    EMAIL_CONFIG: ziToken<EmailConfigInput | undefined>('zi.email_config'),
    MAILING_LIST_SERVICE: ziToken<MailingListServiceInterface | undefined>('zi.mailing_list_service'),
    CURRENT_REQUEST: ziToken<HttpRequest>('zi.current_request'),
    MULTITHREADING_SERVICE: ziToken<MultithreadingServiceInterface>('zi.multithreading_service'),
    MULTITHREADING_OPTIONS: ziToken<MultithreadingOptions>('zi.multithreading_options'),
    // eslint-disable-next-line typescript/no-explicit-any
    WEBSOCKET_SERVICE: ziToken<WebsocketServiceInterface<any>>('zi.websocket_service'),
    WEBSOCKET_OPTIONS: ziToken<WebsocketOptions>('zi.websocket_options'),
    HTTP_CLIENT: ziToken<HttpClientInterface>('zi.http_client')
} as const satisfies TokenRecord;