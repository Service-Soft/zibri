import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { EmailLoggerTransportConfig } from './log-to-email.function';
import { LogEmailTemplate, LoggerTransport } from './logger-transport.model';
import { compileTsxTemplate } from '../../__testing__/compile-tsx-template.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { Email } from '../../email/models/email.model';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md 3.4 - a log storm becoming a mail
 * storm.
 *
 * The transport queued one email per log entry, so a dependency failing at ten thousand errors a
 * minute queued ten thousand mails - each of which the mail cron then drains a handful at a time
 * against an hourly token bucket. The queue is the casualty: the storm is over long before the
 * backlog is, and every ordinary mail behind it waits.
 *
 * Driven against the real mail queue rather than a stub, because what the finding is about is how
 * many rows end up in it.
 */

const template: LogEmailTemplate = compileTsxTemplate<LogEmailTemplate>(
    'export const Email = ({ logs }) => <div>{logs.map(l => <p>{l.message}</p>)}</div>;'
);

function createLog(message: string, level: LogLevel = LogLevel.ERROR): Log {
    return {
        id: UUIDUtilities.generate(),
        createdAt: new Date(),
        cleanupAt: new Date(),
        message,
        level,
        context: { origin: 'origin.ts' }
    };
}

let server: StartedTestServer;
let emailRepository: Repository<Email>;

beforeAll(async () => {
    server = await startTestServer();
    emailRepository = inject(repositoryTokenFor(Email));
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

beforeEach(async () => {
    await emailRepository.deleteAll({});
});

describe('evaluation/04-infrastructure-subsystems 3.4 - a log storm must not become a mail storm', () => {

    it('queues one email for a whole batch rather than one per entry', async () => {
        const transport: LoggerTransport<EmailLoggerTransportConfig> = LoggerTransport.email({
            level: LogLevel.ERROR,
            recipients: () => ['digest@example.com'],
            emailTemplate: template
        });
        const logs: Log[] = Array.from({ length: 500 }, (_, i) => createLog(`failure ${i}`));

        await transport.send(logs, transport.config);

        // five hundred rows is the defect, and it is not merely wasteful: the mail cron drains a
        // handful per tick against an hourly budget, so the queue outlives the incident by hours
        // and every ordinary mail queued behind it waits
        const emails: Email[] = await emailRepository.findAll({});
        expect(emails).toHaveLength(1);
    }, 30000);

    it('holds at most as many entries as it was told to, and says how many it left out', async () => {
        const transport: LoggerTransport<EmailLoggerTransportConfig> = LoggerTransport.email({
            level: LogLevel.ERROR,
            recipients: () => ['capped@example.com'],
            emailTemplate: template,
            maxEntriesPerEmail: 5
        });
        const logs: Log[] = Array.from({ length: 500 }, (_, i) => createLog(`failure ${i}`));

        await transport.send(logs, transport.config);

        // one mail carrying five hundred rendered entries is a different denial of service from
        // five hundred mails, so the digest is bounded too - and the count that did not fit is the
        // difference between a summary and a lie
        const emails: Email[] = await emailRepository.findAll({});
        expect(emails).toHaveLength(1);
        expect(emails[0]?.html).toContain('failure 0');
        expect(emails[0]?.html).not.toContain('failure 400');
        expect(emails[0]?.subject).toContain('500');
    }, 30000);

    it('does not send again inside the interval, and reports what it swallowed', async () => {
        const transport: LoggerTransport<EmailLoggerTransportConfig> = LoggerTransport.email({
            level: LogLevel.ERROR,
            recipients: () => ['throttled@example.com'],
            emailTemplate: template,
            minIntervalMs: 60000
        });

        await transport.send([createLog('first storm')], transport.config);
        await transport.send([createLog('second storm')], transport.config);
        await transport.send([createLog('third storm')], transport.config);

        // one mail per drain is still one mail every few milliseconds under a sustained storm.
        // The interval is what makes the volume bounded by time rather than by how fast the
        // application can fail
        const emails: Email[] = await emailRepository.findAll({});
        expect(emails).toHaveLength(1);
        expect(emails[0]?.html).toContain('first storm');
    }, 30000);

    it('sends again once the interval has passed, and accounts for what was suppressed', async () => {
        const transport: LoggerTransport<EmailLoggerTransportConfig> = LoggerTransport.email({
            level: LogLevel.ERROR,
            recipients: () => ['recovered@example.com'],
            emailTemplate: template,
            minIntervalMs: 500
        });

        await transport.send([createLog('before')], transport.config);
        await transport.send([createLog('suppressed')], transport.config);
        await new Promise<void>(resolve => setTimeout(resolve, 700));
        await transport.send([createLog('after')], transport.config);

        // throttling that silently forgets is worse than not throttling: an operator reading the
        // second mail has to be told that entries went missing between the two, or the gap in the
        // record looks like a gap in the incident
        const emails: Email[] = await emailRepository.findAll({ order: { createdAt: 'ASC' } });
        expect(emails).toHaveLength(2);
        expect(emails[1]?.html).toContain('after');
        expect(emails[1]?.subject).toContain('1 suppressed');
    }, 30000);
});