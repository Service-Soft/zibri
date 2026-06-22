/* eslint-disable jsdoc/require-jsdoc */
import os from 'node:os';

import { inject } from '../inject.function';
import { ZIBRI_DI_TOKENS } from './zibri-di-tokens.default';
import { AssetService } from '../../assets/asset.service';
import { TwoFactorService } from '../../auth/2fa/two-factor.service';
import { AuthService } from '../../auth/auth.service';
import { EncryptionService } from '../../auth/encryption/encryption.service';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { HashService } from '../../auth/hash/hash.service';
import { ScryptHashStrategy } from '../../auth/hash/strategies/scrypt.hash-strategy';
import { UserService } from '../../auth/user/user.service';
import { BackupService } from '../../backup/backup.service';
import { CacheService } from '../../caching/cache.service';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { ZIBRI_REQUEST_CONTEXT_TOKENS } from '../../context/request/request-context-token.model';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { CronService } from '../../cron/cron.service';
import { DataSourceService } from '../../data-source/data-source.service';
import { EmailService } from '../../email/email.service';
import { errorHandler } from '../../error-handling/error-handler';
import { EventService } from '../../event/event.service';
import { KnownHeader } from '../../http/known-header.enum';
import { HttpClient } from '../../http-client/http-client';
import { defineDateFormat } from '../../localization/define-date-format.function';
import { LocalizeService } from '../../localization/localize.service';
import { LocalizeOptionsInput } from '../../localization/models/localize-options.model';
import { LogLevel } from '../../logging/log-level.enum';
import { Logger } from '../../logging/logger';
import { LoggerTransport } from '../../logging/transport/logger-transport.model';
import { PrometheusMetricsService } from '../../metrics/metrics.service';
import { MultithreadingService } from '../../multithreading/services/multithreading.service';
import { OpenApiService } from '../../open-api/open-api.service';
import { CspSource } from '../../parsing/html/csp-options.model';
import { Parser } from '../../parsing/parser';
import { Router } from '../../routing/router';
import { FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { ValidationService } from '../../validation/validation.service';
import { VersioningService } from '../../versioning/versioning.service';
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
    PASSWORD_RESET_EMAIL_TEMPLATE: { useFactory: () => undefined },
    JWT_ACCESS_TOKEN_EXPIRES_IN_MS: { useFactory: () => Ms.HOUR },
    JWT_REFRESH_TOKEN_EXPIRES_IN_MS: { useFactory: () => 100 * Ms.DAY },
    CRON_SERVICE: { useClass: CronService },
    EMAIL_SERVICE: { useClass: EmailService },
    FILE_UPLOAD_TEMP_FOLDER: { useFactory: () => FsUtilities.getPath(__dirname, 'temp') },
    EMAIL_CONFIG: { useFactory: () => undefined },
    PASSWORD_RESET_TOKEN_EXPIRES_IN_MS: { useFactory: () => 300000 },
    CONFIRM_PASSWORD_RESET_URL: { useFactory: () => undefined },
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
    CORRELATION_ID_HEADER: { useValue: 'x-correlation-id' },
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
    COOKIE_AUTH_REFRESH_SESSION_EXPIRES_IN_MS: { useValue: Ms.DAY * 100 },
    HASH_SERVICE: { useClass: HashService },
    HASH_STRATEGIES: { useValue: [ScryptHashStrategy] },
    ENCRYPTION_SERVICE: { useClass: EncryptionService },
    ENCRYPTION_STRATEGIES: { useValue: [AesGcmEncryptionStrategy] },
    ENCRYPTION_MASTER_OPTIONS: { useValue: undefined },
    CACHE_SERVICE: { useClass: CacheService },
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
                ...input
            };
        }
    },
    // dynamic
    CURRENT_REQUEST_CONTEXT: {
        useFactory: () => AlsUtilities.getCurrentRequestContext(),
        cache: false
    },
    DEFAULT_CSP_OPTIONS: {
        useFactory: () => {
            const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
            const nonce: string | undefined = context?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.NONCE);
            const nonceSrc: CspSource | undefined = nonce ? `'nonce-${nonce}'` : undefined;
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
                scriptSrc: [
                    '\'self\'',
                    ...nonceSrc ? [nonceSrc] : []
                ],
                scriptSrcAttr: ['\'none\''],
                styleSrc: []
            };
        },
        cache: false
    },
    CURRENT_CACHE_CONTEXT: {
        useFactory: () => AlsUtilities.getCurrentCacheContext(),
        cache: false
    }
};