/* eslint-disable jsdoc/require-jsdoc */
import path from 'path';

import { ZIBRI_DI_TOKENS } from './zibri-di-tokens.default';
import { AssetService, AssetServiceInterface } from '../../assets';
import { AuthService, AuthServiceInterface, UserService, UserServiceInterface } from '../../auth';
import { CronService, CronServiceInterface } from '../../cron';
import { DataSourceService, DataSourceServiceInterface } from '../../data-source';
import { EmailConfigInput, EmailService, EmailServiceInterface, MailingListService, MailingListServiceInterface } from '../../email';
import { errorHandler, GlobalErrorHandler } from '../../error-handling';
import { BaseLoggerTransportConfig, Logger, LoggerInterface, LoggerTransport, LogLevel } from '../../logging';
import { MetricsServiceInterface, PrometheusMetricsService } from '../../metrics';
import { OpenApiService, OpenApiServiceInterface } from '../../open-api';
import { Parser, ParserInterface } from '../../parsing';
import { Router, RouterInterface } from '../../routing';
import { OmitStrict } from '../../types';
import { Ms } from '../../utilities';
import { formatDate } from '../../utilities/format-date.function';
import { ValidationService, ValidationServiceInterface } from '../../validation';
import { DiProvider } from '../models';

type ZibriDiProvider<T> = OmitStrict<DiProvider<T>, 'token'>;

type ZibriDiProviders = {
    [ZIBRI_DI_TOKENS.ROUTER]: ZibriDiProvider<RouterInterface>,
    [ZIBRI_DI_TOKENS.LOGGER]: ZibriDiProvider<LoggerInterface>,
    [ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS]: ZibriDiProvider<LoggerTransport<BaseLoggerTransportConfig>[]>,
    [ZIBRI_DI_TOKENS.LOGGER_CLEANUP_AFTER_MS]: ZibriDiProvider<Record<LogLevel, number>>,
    [ZIBRI_DI_TOKENS.METRICS_SERVICE]: ZibriDiProvider<MetricsServiceInterface>,
    [ZIBRI_DI_TOKENS.ASSET_SERVICE]: ZibriDiProvider<AssetServiceInterface>,
    [ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER]: ZibriDiProvider<GlobalErrorHandler>,
    [ZIBRI_DI_TOKENS.OPEN_API_SERVICE]: ZibriDiProvider<OpenApiServiceInterface>,
    [ZIBRI_DI_TOKENS.PARSER]: ZibriDiProvider<ParserInterface>,
    [ZIBRI_DI_TOKENS.VALIDATION_SERVICE]: ZibriDiProvider<ValidationServiceInterface>,
    [ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE]: ZibriDiProvider<DataSourceServiceInterface>,
    [ZIBRI_DI_TOKENS.AUTH_SERVICE]: ZibriDiProvider<AuthServiceInterface>,
    [ZIBRI_DI_TOKENS.USER_SERVICE]: ZibriDiProvider<UserServiceInterface>,
    [ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET]: ZibriDiProvider<string | undefined>,
    [ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET]: ZibriDiProvider<string | undefined>,
    [ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_EXPIRES_IN_MS]: ZibriDiProvider<number>,
    [ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_EXPIRES_IN_MS]: ZibriDiProvider<number>,
    [ZIBRI_DI_TOKENS.JWT_PASSWORD_RESET_TOKEN_EXPIRES_IN_MS]: ZibriDiProvider<number>,
    [ZIBRI_DI_TOKENS.JWT_CONFIRM_PASSWORD_RESET_URL]: ZibriDiProvider<string | undefined>,
    [ZIBRI_DI_TOKENS.CRON_SERVICE]: ZibriDiProvider<CronServiceInterface>,
    [ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER]: ZibriDiProvider<string>,
    [ZIBRI_DI_TOKENS.FORMAT_DATE]: ZibriDiProvider<(value: Date, includeTime?: boolean) => string>,
    [ZIBRI_DI_TOKENS.EMAIL_SERVICE]: ZibriDiProvider<EmailServiceInterface>,
    [ZIBRI_DI_TOKENS.EMAIL_CONFIG]: ZibriDiProvider<EmailConfigInput | undefined>,
    [ZIBRI_DI_TOKENS.MAILING_LIST_SERVICE]: ZibriDiProvider<MailingListServiceInterface | undefined>,
    [ZIBRI_DI_TOKENS.MAILING_LIST_SUBSCRIPTION_CONFIRMATION_TOKEN_EXPIRES_IN_MS]: ZibriDiProvider<number>
};

export const ZIBRI_DI_PROVIDERS: Record<
    typeof ZIBRI_DI_TOKENS[keyof typeof ZIBRI_DI_TOKENS],
    ZibriDiProvider<unknown>
> = {
    [ZIBRI_DI_TOKENS.ROUTER]: { useClass: Router },
    [ZIBRI_DI_TOKENS.LOGGER]: { useClass: Logger },
    [ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS]: {
        useFactory: () => [
            LoggerTransport.console(LogLevel.INFO),
            LoggerTransport.db(LogLevel.INFO)
        ]
    },
    [ZIBRI_DI_TOKENS.LOGGER_CLEANUP_AFTER_MS]: {
        useFactory: () => ({
            [LogLevel.DEBUG]: Ms.WEEK * 2,
            [LogLevel.INFO]: Ms.WEEK * 2,
            [LogLevel.WARN]: Ms.WEEK * 2,
            [LogLevel.ERROR]: Ms.WEEK * 2,
            [LogLevel.CRITICAL]: Ms.WEEK * 2
        })
    },
    [ZIBRI_DI_TOKENS.METRICS_SERVICE]: { useClass: PrometheusMetricsService },
    [ZIBRI_DI_TOKENS.ASSET_SERVICE]: { useClass: AssetService },
    [ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER]: { useFactory: () => errorHandler },
    [ZIBRI_DI_TOKENS.OPEN_API_SERVICE]: { useClass: OpenApiService },
    [ZIBRI_DI_TOKENS.PARSER]: { useClass: Parser },
    [ZIBRI_DI_TOKENS.VALIDATION_SERVICE]: { useClass: ValidationService },
    [ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE]: { useClass: DataSourceService },
    [ZIBRI_DI_TOKENS.AUTH_SERVICE]: { useFactory: () => new AuthService() },
    [ZIBRI_DI_TOKENS.USER_SERVICE]: { useFactory: () => new UserService() },
    [ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET]: { useFactory: () => undefined },
    [ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET]: { useFactory: () => undefined },
    [ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_EXPIRES_IN_MS]: { useFactory: () => Ms.HOUR },
    [ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_EXPIRES_IN_MS]: { useFactory: () => 100 * Ms.DAY },
    [ZIBRI_DI_TOKENS.CRON_SERVICE]: { useClass: CronService },
    [ZIBRI_DI_TOKENS.EMAIL_SERVICE]: { useClass: EmailService },
    [ZIBRI_DI_TOKENS.MAILING_LIST_SERVICE]: { useClass: MailingListService },
    [ZIBRI_DI_TOKENS.MAILING_LIST_SUBSCRIPTION_CONFIRMATION_TOKEN_EXPIRES_IN_MS]: { useFactory: () => Ms.DAY },
    [ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER]: { useFactory: () => path.join(__dirname, 'temp') },
    [ZIBRI_DI_TOKENS.FORMAT_DATE]: { useFactory: () => formatDate },
    [ZIBRI_DI_TOKENS.EMAIL_CONFIG]: { useFactory: () => undefined },
    [ZIBRI_DI_TOKENS.JWT_PASSWORD_RESET_TOKEN_EXPIRES_IN_MS]: { useFactory: () => 300000 },
    [ZIBRI_DI_TOKENS.JWT_CONFIRM_PASSWORD_RESET_URL]: { useFactory: () => undefined }
} satisfies ZibriDiProviders;