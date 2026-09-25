import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { type EmailServiceInterface } from '../../../email/email-service.interface';
import { EmailConfig } from '../../../email/models/email-config.model';
import { Email } from '../../../email/models/email.model';
import { EmailSendResult, EmailTransportInterface } from '../../../email/transports/email-transport.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';

/**
 * What every instance of the mail cluster boots with.
 *
 * Every replica registers the same SendQueuedEmailsCronJob, because EmailService.onAppInit pushes it
 * onto the options of whatever application is booting. That is the finding: N replicas draining one
 * shared queue. Like every instance options module this is imported by the parent as well, so
 * nothing at the top level may assume it is running inside an instance.
 */

/**
 * How many mails one call to the queue endpoint enqueues.
 *
 * Below the ten a single pass of sendQueuedEmails takes, so the whole batch is picked up by one tick
 * and a duplicate cannot be explained away as a second pass legitimately draining the rest.
 */
export const queuedMailCount: number = 5;

/**
 * How often SendQueuedEmailsCronJob fires, in milliseconds.
 *
 * Not configurable - the job hardcodes every 5 seconds. Written down here because the second half of
 * this scenario is entirely about a send outlasting it.
 */
export const mailCronIntervalInMs: number = 5000;

/**
 * How long a send pretends to take while it still fits inside one tick.
 *
 * Without any delay the test would depend on timing luck. Replicas tick at the same moment, so
 * before the fix they all read the same QUEUED rows; the delay holds that window open long enough
 * that they provably overlap instead of one happening to finish and delete the rows first.
 */
const fastSendWorkInMs: number = 500;

/**
 * How long a send pretends to take once the parent asks for slow sends.
 *
 * Deliberately longer than the tick interval. A lease is taken per scheduled execution, so it stops
 * two replicas running the *same* slot - it says nothing about the next slot starting while the
 * previous one is still sending. That next slot re-reads rows that are still QUEUED, because the
 * status is only written back once the send returns.
 */
export const slowSendWorkInMs: number = mailCronIntervalInMs + 3000;

/**
 * How long a send currently takes. Per process, so the parent has to ask every instance.
 */
let sendWorkInMs: number = fastSendWorkInMs;

/**
 * Enough capacity that the rate limiter never enters into it.
 *
 * The shared test config sets maxEmailsPerHour to 0, which is a capacity of zero tokens - every send
 * would fail with TooManyRequests and the test would pass for entirely the wrong reason.
 */
const mailConfig: EmailConfig = {
    maxEmailsPerHour: 1000,
    defaultSender: 'noreply@example.com',
    // shorter than a slow send on purpose, so the claim has to be renewed to survive one. A lease
    // that comfortably outlasted the work would let this pass without the renewal ever running.
    sendLeaseInMs: 3000,
    sendBatchSize: 10
};

/**
 * The framework's own EmailService, with a transport that marks instead of transmitting.
 *
 * Nothing about the service is replaced any more - the queueing, the selection by priority, the per
 * mail claim, the rate limiter, the cron job driving all of it and the row bookkeeping afterwards
 * are the framework's. Standing up an smtp server would prove nothing extra: the question is how
 * many replicas send a given mail, not what they transmit.
 */
class MarkingEmailTransport implements EmailTransportInterface {

    readonly name: string = 'MarkingEmailTransport';

    /**
     * Records that this instance sent this mail, slowly enough for two replicas to overlap.
     * @param email - The mail being sent.
     * @returns An answer accepting every recipient.
     */
    async send(email: Email): Promise<EmailSendResult> {
        const markRepository: Repository<ClusterMark> = inject(repositoryTokenFor(ClusterMark));
        // written before the send returns, so a second replica sending the same mail leaves a second
        // row rather than racing the first one's cleanup
        await markRepository.create({
            instanceId: clusterInstanceId(),
            kind: 'mail-sent',
            tag: email.id,
            at: new Date()
        });

        await new Promise<void>(resolve => {
            setTimeout(resolve, sendWorkInMs);
        });

        return { rejectedRecipients: [] };
    }
}

/**
 * Lets the parent pick which instance fills the queue.
 */
@Controller('/cluster-mail')
class ClusterMailController {
    /**
     * Queues the batch. Sending is left to whichever replica the framework decides on.
     */
    @Post('/queue')
    async queue(): Promise<void> {
        const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);

        for (let i: number = 0; i < queuedMailCount; i++) {
            await emailService.queue({
                html: '<p>Hello</p>',
                subject: `cluster mail ${i}`,
                recipients: ['recipient@example.com']
            });
        }
    }

    /**
     * Makes this instance take longer over a send than the gap between two ticks.
     *
     * A real deployment does not have an endpoint for this, it has an smtp server having a bad
     * minute. The parent has to call this on every instance, because each one is its own process.
     */
    @Post('/slow-sends')
    slowSends(): void {
        sendWorkInMs = slowSendWorkInMs;
    }
}

const options: StartTestServerOptions = {
    controllers: [ClusterMailController],
    // spread rather than replaced: providers is the same field startTestServer takes, where what is
    // passed is what is used, so all the defaults have to be kept here
    providers: [
        ...defaultClusterProviders,
        defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_CONFIG, useValue: mailConfig }),
        defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: new MarkingEmailTransport() })
    ]
};

export default options;