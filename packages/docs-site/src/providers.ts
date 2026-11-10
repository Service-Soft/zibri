import { randomBytes } from 'node:crypto';

import { AesGcmEncryptionStrategy, defineProvider, DiProvider, LoggerTransport, LoggingEmailTransport, LogLevel, ZIBRI_DI_TOKENS } from 'zibri';

import { DocsAssetService } from './services/docs-asset.service';
import { markdownComponents } from './templates/components/markdown-components';

// what every application provides, for a site that sends no mail and keeps its rows only while it runs: nothing it
// encrypts outlives the process, so a key made at every start is enough
export const providers: DiProvider<unknown>[] = [
    defineProvider({ token: ZIBRI_DI_TOKENS.MDX_COMPONENTS, useValue: markdownComponents }),
    // the JSDoc of the API reference is markdown read while the site runs
    defineProvider({ token: ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS, useValue: { renderAtRuntime: true } }),
    defineProvider({ token: ZIBRI_DI_TOKENS.ASSET_SERVICE, useClass: DocsAssetService }),
    defineProvider({ token: ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS, useFactory: () => [LoggerTransport.console(LogLevel.WARN)] }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
        useFactory: () => ({
            currentMasterStrategy: new AesGcmEncryptionStrategy(),
            currentMasterKey: { id: 'k1', value: randomBytes(32) }
        })
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
        useValue: { maxEmailsPerHour: 0, defaultSender: 'docs@example.com', failedRetentionInMs: 'forever' }
    }),
    defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useFactory: () => new LoggingEmailTransport() }),
    defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS, useValue: 'forever' }),
    defineProvider({ token: ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS, useValue: 'forever' }),
    defineProvider({ token: ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS, useValue: 'forever' }),
    // the data source in memory declares every table of the framework, one holding passwords among them, which no
    // login of the site ever writes
    defineProvider({ token: ZIBRI_DI_TOKENS.PASSWORD_POLICY, useValue: { minLength: 15, outdatedPasswords: 'requireChange' } })
];