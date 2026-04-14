/* eslint-disable jsdoc/require-jsdoc */
import os from 'node:os';

import { formatDate } from '../../localization/formatting/format-date.function';
import { formatPercent } from '../../localization/formatting/format-percent.function';
import { formatPrice } from '../../localization/formatting/format-price.function';
import { inject } from '../inject.function';
import { ZIBRI_DI_TOKENS } from './zibri-di-tokens.default';
import { AssetService } from '../../assets/asset.service';
import { TwoFactorService } from '../../auth/2fa/two-factor.service';
import { AuthService } from '../../auth/auth.service';
import { UserService } from '../../auth/user/user.service';
import { BackupService } from '../../backup/backup.service';
import { AlsUtilities } from '../../context/als.utilities';
import { CronService } from '../../cron/cron.service';
import { DataSourceService } from '../../data-source/data-source.service';
import { EmailService } from '../../email/email.service';
import { errorHandler } from '../../error-handling/error-handler';
import { EventService } from '../../event/event.service';
import { HttpClient } from '../../http-client/http-client';
import { LocalizeOptionsInput } from '../../localization/models/localize-options.model';
import { LogLevel } from '../../logging/log-level.enum';
import { Logger } from '../../logging/logger';
import { LoggerTransport } from '../../logging/transport/logger-transport.model';
import { PrometheusMetricsService } from '../../metrics/metrics.service';
import { MultithreadingService } from '../../multithreading/services/multithreading.service';
import { OpenApiService } from '../../open-api/open-api.service';
import { Parser } from '../../parsing/parser';
import { Router } from '../../routing/router';
import { FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { ValidationService } from '../../validation/validation.service';
import { WebsocketService } from '../../websocket/services/websocket.service';
import { DiTokenProviderRecord } from '../models/di-token.model';

const allThreads: number = os.availableParallelism();

const reserveThreadsMain: number = 1;
const reserveThreadsLibUv: number = Number(process.env.UV_THREADPOOL_SIZE ?? '4');

const availableThreads: number = allThreads - reserveThreadsLibUv - reserveThreadsMain;

const maxThreads: number = Math.max(1, availableThreads - 1);
const maxPriorityThreads: number = availableThreads <= 1 ? 0 : 1;

export const ZIBRI_DI_PROVIDERS: DiTokenProviderRecord<typeof ZIBRI_DI_TOKENS> = {
    ROUTER: { useClass: Router },
    LOGGER: { useClass: Logger },
    LOGGER_TRANSPORTS: {
        useFactory: () => [
            LoggerTransport.console(LogLevel.INFO),
            LoggerTransport.db(LogLevel.INFO)
        ]
    },
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
    PARSER: { useClass: Parser },
    VALIDATION_SERVICE: { useClass: ValidationService },
    DATA_SOURCE_SERVICE: { useClass: DataSourceService },
    AUTH_SERVICE: { useClass: AuthService },
    TWO_FACTOR_SERVICE: { useClass: TwoFactorService },
    OTP_HEADER: { useFactory: () => 'x-authorization-otp' },
    OTP_LENGTH: { useFactory: () => 6 },
    USER_SERVICE: { useClass: UserService },
    JWT_ACCESS_TOKEN_SECRET: { useFactory: () => undefined },
    JWT_REFRESH_TOKEN_SECRET: { useFactory: () => undefined },
    JWT_PASSWORD_RESET_EMAIL_TEMPLATE: { useFactory: () => undefined },
    JWT_ACCESS_TOKEN_EXPIRES_IN_MS: { useFactory: () => Ms.HOUR },
    JWT_REFRESH_TOKEN_EXPIRES_IN_MS: { useFactory: () => 100 * Ms.DAY },
    CRON_SERVICE: { useClass: CronService },
    EMAIL_SERVICE: { useClass: EmailService },
    FILE_UPLOAD_TEMP_FOLDER: { useFactory: () => FsUtilities.getPath(__dirname, 'temp') },
    LOCALIZE_OPTIONS_INPUT: { useFactory: () => ({}) },
    LOCALIZE_OPTIONS: {
        useFactory: () => {
            const input: LocalizeOptionsInput = inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT);
            return {
                currency: 'EUR',
                language: 'de',
                ...input
            };
        }
    },
    FORMAT_DATE: { useFactory: () => formatDate },
    FORMAT_PRICE: { useFactory: () => formatPrice },
    FORMAT_PERCENT: { useFactory: () => formatPercent },
    EMAIL_CONFIG: { useFactory: () => undefined },
    JWT_PASSWORD_RESET_TOKEN_EXPIRES_IN_MS: { useFactory: () => 300000 },
    JWT_CONFIRM_PASSWORD_RESET_URL: { useFactory: () => undefined },
    MULTITHREADING_OPTIONS: {
        useFactory: () => ({
            maxThreads,
            maxPriorityThreads,
            defaultTimeoutMs: Ms.HOUR,
            defaultTimeoutPriorityMs: Ms.MINUTE * 5
        })
    },
    MULTITHREADING_SERVICE: { useClass: MultithreadingService },
    WEBSOCKET_SERVICE: { useClass: WebsocketService },
    WEBSOCKET_OPTIONS: { useFactory: () => ({ timeoutInMs: Ms.SECOND * 5, isAllowedToConnect: () => true }) },
    HTTP_CLIENT: { useClass: HttpClient },
    EVENT_SERVICE: { useClass: EventService },
    // dynamic
    CURRENT_REQUEST_CONTEXT: {
        useFactory: () => AlsUtilities.getCurrentRequestContext(),
        cache: false
    }
};