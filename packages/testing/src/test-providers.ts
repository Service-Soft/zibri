import { createHash } from 'node:crypto';

import { AesGcmEncryptionStrategy,
    CronServiceInterface,
    defineProvider,
    DiProvider,
    EncryptionMasterKey,
    JwtAuthOptionsInput,
    Ms,
    MultithreadingServiceInterface,
    ScryptCost,
    ZIBRI_DI_TOKENS } from 'zibri';

import { defaultPasswordResetEmailTemplate } from './password-reset-email.template';
import { UnconfiguredEmailTransport } from './unconfigured.email-transport';

const noOp: () => void = () => {};

const noOpAsync: () => Promise<void> = async () => {};

/**
 * The master key every test server runs with.
 *
 * The same 32 bytes in every process, which randomBytes was not: it runs once per module load, so
 * each forked replica got its own key under the same id. Replicas share a database, so a value one
 * of them encrypted was then unreadable to the others - and has2fa swallows the failure, which made
 * it look like a wrong code rather than a key nobody could use.
 *
 * Exported because a test that swaps the master strategy has to hand this back in as an old key, or
 * the key rows already in the table stop being readable.
 */
export const testMasterKey: EncryptionMasterKey<Buffer> = {
    id: 'mk1',
    value: createHash('sha256').update('zibri-test-master-key')
        .digest()
};

/**
 * What a test server runs with unless the test says otherwise.
 *
 * Every entry is here because the shipped default is wrong *for a test* rather than wrong: work
 * factors sized for an attacker, a scheduler that fires on its own, a rate limit written for real
 * callers. Nothing here changes what the application does - a test that is about one of these
 * registers its own provider for that token and gets the shipped behavior back.
 */
export const defaultTestProviders: DiProvider<unknown>[] = [
    // node's old defaults rather than what ships, because the shipped cost is ~128MB and a few
    // hundred ms per derivation, and a suite hashes on almost every test.
    defineProvider({
        token: ZIBRI_DI_TOKENS.SCRYPT_COST,
        useFactory: (): ScryptCost => ({ n: 16384, r: 8, p: 1 })
    }),
    // two different secrets, because which secret verifies a token is what tells an access token
    // from a refresh token. The strategy refuses to start when they match.
    defineProvider({
        token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,
        useFactory: (): JwtAuthOptionsInput => ({
            accessTokenKey: 'test-access-token-secret',
            refreshTokenSecret: 'test-refresh-token-secret'
        })
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL,
        useFactory: () => 'http://localhost:4200/confirm-password-reset'
    }),
    // JwtAuthStrategy refuses to construct without one, so an application that never resets a
    // password still needs a template registered before a test server will start.
    defineProvider({
        token: ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE,
        useValue: defaultPasswordResetEmailTemplate
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
        useFactory: () => ({ maxEmailsPerHour: 0, defaultSender: 'Max Mustermann' })
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT,
        useValue: new UnconfiguredEmailTransport()
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
        useValue: {
            currentMasterStrategy: new AesGcmEncryptionStrategy(),
            currentMasterKey: testMasterKey
        }
    }),
    // a scheduler that fires on its own turns every test into a race with the clock. A test about a
    // cron job runs the job.
    defineProvider({
        token: ZIBRI_DI_TOKENS.CRON_SERVICE,
        useFactory: () => {
            const res: CronServiceInterface = {
                cronJobs: [],
                schedule: noOpAsync,
                enable: noOpAsync,
                disable: noOpAsync,
                changeCron: noOpAsync,
                update: noOpAsync,
                // never actually reached, because this stub schedules nothing. True rather than
                // false so that it cannot silently suppress a job if it ever is.
                shouldRunExecution: () => Promise.resolve(true)
            };
            return res;
        }
    }),
    // worker threads outlive the test that started them and take the module registry with them, so
    // the default is to refuse rather than to spawn. A test about a thread job asks for the real one.
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
                },
                startQueuedJobs: noOp
            };
            return res;
        }
    }),
    // the shipped default is ten attempts per ten minutes per caller, and a suite driving the auth
    // endpoints is one caller making dozens of them - every test after the tenth would be answered
    // 429 for reasons that have nothing to do with what it asserts. A test that is about the limit
    // says so with a provider of its own.
    defineProvider({
        token: ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS,
        useFactory: () => ({ maxAttempts: 10000, windowInMs: Ms.MINUTE })
    })
];