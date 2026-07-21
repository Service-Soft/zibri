import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { h } from 'preact';

import { EmailLoggerTransportConfig, logToEmail } from './log-to-email.function';
import { LogEmailTemplate } from './logger-transport.model';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { EmailPriority } from '../../email/models/email-priority.enum';
import { Email } from '../../email/models/email.model';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';

// eslint-disable-next-line unicorn/no-null
const template: LogEmailTemplate = props => h('div', null, props.log.message);

function createLog(overrides: Partial<Log> = {}): Log {
    return {
        id: UUIDUtilities.generate(),
        createdAt: new Date(),
        cleanupAt: new Date(),
        message: 'the log message',
        level: LogLevel.ERROR,
        context: { origin: 'origin.ts' },
        ...overrides
    };
}

describe('logToEmail', () => {
    let server: StartedTestServer;
    let emailRepository: Repository<Email>;

    beforeAll(async () => {
        server = await startTestServer();
        emailRepository = inject(repositoryTokenFor(Email));
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('queues an email with the default subject based on log level and app name', async () => {
        const log: Log = createLog();
        const config: EmailLoggerTransportConfig = {
            name: 'EmailLoggerTransport',
            register: 'afterStartup',
            level: LogLevel.ERROR,
            recipients: () => ['recipient@example.com'],
            emailTemplate: template
        };

        await logToEmail(log, config);

        const emails: Email[] = await emailRepository.findAll({ where: { recipients: { includes: ['recipient@example.com'] } } });
        expect(emails.length).toBe(1);
        expect(emails[0].subject).toBe('Error in test');
        expect(emails[0].html).toContain('the log message');
        expect(emails[0].priority).toBe(EmailPriority.HIGH);
    });

    it('uses a custom subject function when provided', async () => {
        const log: Log = createLog();
        const config: EmailLoggerTransportConfig = {
            name: 'EmailLoggerTransport',
            register: 'afterStartup',
            level: LogLevel.CRITICAL,
            recipients: () => ['custom-subject@example.com'],
            emailTemplate: template,
            subject: () => 'my custom subject'
        };

        await logToEmail(log, config);

        const emails: Email[] = await emailRepository.findAll({ where: { recipients: { includes: ['custom-subject@example.com'] } } });
        expect(emails.length).toBe(1);
        expect(emails[0].subject).toBe('my custom subject');
    });

    it('passes through priority, cc, bcc, persist and sender overrides', async () => {
        const log: Log = createLog();
        const config: EmailLoggerTransportConfig = {
            name: 'EmailLoggerTransport',
            register: 'afterStartup',
            level: LogLevel.ERROR,
            recipients: () => ['overrides@example.com'],
            emailTemplate: template,
            priority: () => EmailPriority.LOW,
            cc: () => ['cc@example.com'],
            bcc: () => ['bcc@example.com'],
            persist: () => false,
            sender: () => 'custom-sender@example.com'
        };

        await logToEmail(log, config);

        const emails: Email[] = await emailRepository.findAll({ where: { recipients: { includes: ['overrides@example.com'] } } });
        expect(emails.length).toBe(1);
        expect(emails[0].priority).toBe(EmailPriority.LOW);
        expect(emails[0].cc).toEqual(['cc@example.com']);
        expect(emails[0].bcc).toEqual(['bcc@example.com']);
        expect(emails[0].persist).toBe(false);
        expect(emails[0].sender).toBe('custom-sender@example.com');
    });
});