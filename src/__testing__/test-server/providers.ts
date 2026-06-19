import { randomBytes } from 'node:crypto';

import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { PasswordResetEmailTemplate } from '../../auth/strategies/jwt/jwt-auth.controller';
import { CronServiceInterface } from '../../cron/cron-service.interface';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { type Header } from '../../http/header.type';
import { LocalizeService } from '../../localization/localize.service';
import { MultithreadingServiceInterface } from '../../multithreading/services/multithreading-service.interface';
import { type RouterInterface } from '../../routing/router.interface';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { VersioningService } from '../../versioning/versioning.service';
import { noOp, noOpAsync, testFileFolder } from '../constants';

const testVersionsDir: FsPath = FsUtilities.getPath(testFileFolder, 'versions-default');

class TestVersioningService extends VersioningService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.VERSION_HEADER)
        versionHeader: Header,
        @Inject(ZIBRI_DI_TOKENS.VERSION_QUERY_PARAM)
        versionQueryParam: string,
        @Inject(ZIBRI_DI_TOKENS.ROUTER)
        router: RouterInterface
    ) {
        super(versionHeader, versionQueryParam, router);
        // eslint-disable-next-line typescript/no-unsafe-member-access, typescript/no-explicit-any
        (this as any).versionsPath = testVersionsDir;
    }
}

class TestLocalizeService extends LocalizeService {
    override async onAppInit(): Promise<void> {
        // do nothing
    }
}

export const defaultTestServerProviders: DiProvider<unknown>[] = [
    defineProvider({
        token: ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET,
        useFactory: () => 'test'
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET,
        useFactory: () => 'test'
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL,
        useFactory: () => 'http://localhost:4200/confirm-password-reset'
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE,
        // eslint-disable-next-line typescript/no-explicit-any
        useValue: (() => 'string') as unknown as PasswordResetEmailTemplate<any, any>
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
        useFactory: () => {
            return {
                maxEmailsPerHour: 0,
                defaultSender: 'Max Mustermann',
                host: '',
                port: 0,
                auth: {
                    user: '',
                    pass: ''
                }
            };
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
        useValue: {
            currentMasterStrategy: new AesGcmEncryptionStrategy(),
            currentMasterKey: { id: 'mk1', value: randomBytes(32) }
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.CRON_SERVICE,
        useFactory: () => {
            const res: CronServiceInterface = {
                cronJobs: [],
                schedule: noOpAsync,
                enable: noOpAsync,
                disable: noOpAsync,
                changeCron: noOpAsync,
                update: noOpAsync
            };
            return res;
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE,
        useFactory: () => {
            const res: MultithreadingServiceInterface = {
                requeueThreadJob: noOp,
                queueThreadJob: () => '42',
                runThreadJob: () => {
                    throw new Error('mock');
                },
                run: () => {
                    throw new Error('mock');
                },
                rerunThreadJob: () => {
                    throw new Error('mock');
                },
                waitForThreadJob: () => {
                    throw new Error('mock');
                }
            };
            return res;
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.VERSIONING_SERVICE,
        useClass: TestVersioningService
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.LOCALIZE_SERVICE,
        useClass: TestLocalizeService
    })
];