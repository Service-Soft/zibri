import { CronServiceInterface } from '../../cron/cron-service.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model';
import { MultithreadingServiceInterface } from '../../multithreading/services/multithreading-service.interface';
import { noOp, noOpAsync } from '../constants';

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
        token: ZIBRI_DI_TOKENS.JWT_CONFIRM_PASSWORD_RESET_URL,
        useFactory: () => 'http://localhost:4200/confirm-password-reset'
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
    })
];