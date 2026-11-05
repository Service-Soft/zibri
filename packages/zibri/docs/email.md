# Handling emails
The email service queues mails in your data source and sends them in the background, by priority and within an hourly rate limit. You render a mail from a [tsx template](./templating.md#rendering-an-email) and queue it.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EmailServiceInterface` | interface | Queue emails |
| `QueueEmailData` | class | What `queue` takes: the mail, with its `priority`, `persist` and `sender` optional |
| `ZIBRI_DI_TOKENS.EMAIL_SERVICE` | DI token | Injects `EmailServiceInterface` |
| `EmailService` | class | Default implementation of `EmailServiceInterface`. Replaceable through ZIBRI_DI_TOKENS.EMAIL_SERVICE |
| `EmailConfigInput` | type | Options accepted by the `EMAIL_CONFIG` DI token |
| `EmailConfig` | type | The email configuration with every option of `EmailConfigInput` filled in |
| `ZIBRI_DI_TOKENS.EMAIL_CONFIG` | DI token | Configures the sender, the rate limit and how the queue is drained |
| `ZIBRI_DI_TOKENS.EMAIL_RATE_LIMITER` | DI token | Holds sending to `maxEmailsPerHour`. The default counts in the memory of each instance. Replaceable |
| `EmailTransportInterface` | interface | What delivers a mail |
| `EmailSendResult` | type | What a transport answers for a mail: the recipients the provider refused |
| `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT` | DI token | Injects `EmailTransportInterface` |
| `SmtpEmailTransport` | class | The transport Zibri ships, over SMTP |
| `LoggingEmailTransport` | class | Logs every mail instead of sending it. Defaults to it in development |
| `SmtpEmailTransportOptions` | type | How `SmtpEmailTransport` reaches the SMTP server, see [reaching the SMTP server](#reaching-the-smtp-server) |
| `EmailPriority` | enum | Priority of a queued email (such as `HIGH`, `NORMAL`) |
| `EmailStatus` | enum | Status of a queued email: `QUEUED`, `SENT` or `FAILED` |
| `Email` | entity | A queued email |
| `EmailAttachment` | class | A file attached to a queued email, with its content |
| `EmailCleanupCronJob` | cron job | Deletes the failed emails older than `failedRetentionInMs`. Registered for you |

## Configuring email
Email takes two providers. `ZIBRI_DI_TOKENS.EMAIL_CONFIG` says what the queue does, and is required. `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT` delivers a mail. In [production](./architecture.md#saying-where-the-application-runs) it is required too, since every transport needs a server or a mail service account of your deployment. In development, an application that provides none gets a `LoggingEmailTransport`, which logs each mail with its links instead of sending it, so a password reset can be followed before there is a mail server.

```ts
// src/providers.ts
import { defineProvider, DiProvider, ZIBRI_DI_TOKENS, EmailConfigInput, Ms, SmtpEmailTransport } from 'zibri';

export const providers: DiProvider<unknown>[] = [
    // ...
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
        useFactory: (): EmailConfigInput => {
            return {
                defaultSender: 'noreply@example.com',
                maxEmailsPerHour: 1000,
                failedRetentionInMs: Ms.DAY * 90
            };
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT,
        useFactory: () => new SmtpEmailTransport({
            host: 'smtp.example.com',
            port: 587,
            auth: {
                user: 'mail-user',
                pass: 'mail-password'
            }
        })
    })
    // ...
];
```

`SmtpEmailTransport` refuses an empty `host` and a `port` outside 1 to 65535 when it is built, so an application missing its mail server does not start.

| Option | What it is |
|---|---|
| `defaultSender` | The address a mail queued without a sender goes out as. Required |
| `maxEmailsPerHour` | The hourly budget queued mails are rate limited against. Required |
| `failedRetentionInMs` | How long a `FAILED` mail is kept, counted from when it was queued, or `'forever'`. Required |
| `sendLeaseInMs` | How long one instance may hold a queued mail while sending it. Renewed while the send runs, so it decides how long a mail waits before another instance takes over from one that stopped existing. Defaults to one minute |
| `sendBatchSize` | How many mails one pass of the queue sends at most. Raise it to drain a backlog faster, lower it for a provider that dislikes bursts. At most `maxEmailsPerHour`. Defaults to 10, or `maxEmailsPerHour` when that is lower |
| `maxSendAttempts` | How many times sending a mail may throw before it is `FAILED`. Defaults to 5 |
| `retryDelayInMs` | How long a mail whose send threw waits before it is tried again, doubling with each further attempt. Defaults to one minute |

Every priority gets a place in each pass when `sendBatchSize` is at least 3. A priority takes at most `sendBatchSize` places, less one per priority below it, so a steady flood of `HIGH` still leaves one place for `NORMAL` and one for `LOW`. A smaller batch takes the most urgent mails first.

> [!WARNING]
> The default limiter counts in the memory of each instance, so `maxEmailsPerHour` holds per instance: three replicas send up to three times as much, past what your mail provider allows. Running more than one instance, replace the limiter with one built on `RepositoryRateLimiterStore`, see [sharing limits across instances](./rate-limiting.md#sharing-limits-across-instances):

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { SharedEmailRateLimiter } from './services/shared-email-rate-limiter';

defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_RATE_LIMITER, useClass: SharedEmailRateLimiter })
```

## Reaching the SMTP server
`SmtpEmailTransport` takes these options:

| Option | What it is |
|---|---|
| `host`, `port` | Where the server listens. Required |
| `auth` | The `user` and `pass` the mails are sent as. Required |
| `secure` | Whether the connection is TLS from the first byte. Otherwise it is upgraded with STARTTLS. `true` on port 465 and `false` on every other by default |
| `requireTls` | Whether a server that offers no STARTTLS is refused, so nothing is sent unencrypted. `true` by default |
| `tls` | Further TLS options, such as `ca` for a server whose certificate a private authority signed |
| `pool` | Whether connections are kept open for the next mail. `true` by default |
| `connectionTimeoutInMs` | How long connecting may take. Two minutes by default |
| `greetingTimeoutInMs` | How long the server may take to greet once connected. 30 seconds by default |
| `socketTimeoutInMs` | How long the connection may stay silent. Ten minutes by default |

A relay that speaks no TLS at all, such as one on the same machine, needs `requireTls: false`.

## Sending through something other than SMTP
To send through an HTTP API, such as SES, SendGrid or Postmark, implement `EmailTransportInterface` and register it under `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT`. The queue works the same with every transport.

```ts
// src/email/mail-api.email-transport.ts
import { Email, EmailSendResult, EmailTransportInterface } from 'zibri';

import { mailApi } from './mail-api';

export class MailApiEmailTransport implements EmailTransportInterface {

    readonly name: string = 'MailApiEmailTransport';

    async send(email: Email): Promise<EmailSendResult> {
        const response = await mailApi.messages.create({
            from: email.sender,
            to: email.recipients,
            subject: email.subject,
            html: email.html
        });
        return { rejectedRecipients: response.rejected };
    }
}
```

How `send` ends decides whether a mail is retried or recorded as failed:

| The transport | Means | The row |
|---|---|---|
| Throws | The message never reached the provider, such as a refused connection, a timeout, a 5xx or an expired credential | Stays `QUEUED` and is attempted again at its `nextAttemptAt`, `FAILED` after `maxSendAttempts` attempts |
| Returns `rejectedRecipients` | The provider answered and refused those addresses | `FAILED`, and never attempted again |

> [!WARNING]
> A transport that returns where it should throw loses the mail silently. One that throws where it should return sends the accepted recipients a second copy on the next attempt.

Add `close()` if the transport holds something, such as a connection pool, a keep-alive agent or an SDK client. It is called when the application shuts down.

A mail queued in a [tenant](./tenancy.md#work-outside-a-request) belongs to it, and the transport sends it in that tenant. The transport reads it in `email.tenantId`, for example to send it from that tenant's own address.

A mail sent to a mailing list carries `listUnsubscribeUrl`. Send it as the `List-Unsubscribe: <url>` header, together with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, as `SmtpEmailTransport` does: a mailbox provider then shows its own unsubscribe button, which posts to that url (RFC 8058).

## Queueing an email
An email is a tsx template in `src/templates/emails`, built from the MJML components, see [rendering an email](./templating.md#rendering-an-email):

```tsx
// src/templates/emails/task-assigned.tsx
import { $ts, Mjml, MjBody, MjButton, MjColumn, MjSection, MjText, TsxEmailComponent } from 'zibri';

type TaskAssignedEmailProps = {
    userName: string,
    taskTitle: string,
    taskUrl: string
};

export const TaskAssignedEmail: TsxEmailComponent<TaskAssignedEmailProps> = ({ userName, taskTitle, taskUrl }) => {
    return (
        <Mjml>
            <MjBody>
                <MjSection>
                    <MjColumn>
                        <MjText>{$ts`Hello ${userName}, the task "${taskTitle}" was assigned to you.`}</MjText>
                        <MjButton href={taskUrl}>{$ts`Open the task`}</MjButton>
                    </MjColumn>
                </MjSection>
            </MjBody>
        </Mjml>
    );
};
```

`TsxUtilities.renderEmail` renders it to html, and `queue` adds the mail to the queue:

```ts
// src/services/task-notification.service.ts
import { EmailPriority, EmailServiceInterface, inject, TsxUtilities, ZIBRI_DI_TOKENS } from 'zibri';

import { TaskAssignedEmail } from '../templates/emails/task-assigned';

export async function queueTaskAssignedEmail(): Promise<void> {
    const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
    const html: string = TsxUtilities.renderEmail(TaskAssignedEmail, {
        userName: 'Ada',
        taskTitle: 'Write the release notes',
        taskUrl: 'https://app.example.com/tasks/42'
    });
    await emailService.queue({
        recipients: ['ada@example.com'],
        subject: 'A task was assigned to you',
        priority: EmailPriority.HIGH,
        html
    });
}
```

A mail without a `priority` is queued as `NORMAL`. A [Handlebars template](./templating.md#rendering-a-handlebars-template) renders html for a mail as well.

## Attaching files
An attachment carries the content of its file, base64 encoded, and the name the recipient sees. The extension of `filename` decides the content type.

```ts
// src/services/invoice-email.service.ts
import { readFile } from 'node:fs/promises';

import { EmailServiceInterface, FsPath, inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function queueInvoiceEmail(invoicePath: FsPath): Promise<void> {
    const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
    await emailService.queue({
        recipients: ['customer@example.com'],
        subject: 'Your invoice',
        html: '<p>Your invoice is attached.</p>',
        attachments: [{ filename: 'invoice.pdf', base64Content: (await readFile(invoicePath)).toString('base64') }]
    });
}
```

The content is part of the queued mail, so whichever instance sends it has the file, and you can delete yours once the mail is queued.

## What happens to the row

A queued mail is a row in the `Email` table, and what becomes of it depends on how the send went.

| Outcome | Row |
|---|---|
| Sent, `persist: false` (the default) | Deleted, so the queue drains |
| Sent, `persist: true` | Kept, `status: SENT` |
| A recipient was refused | Kept, `status: FAILED`, with `rejectedRecipients` naming the addresses |
| The send threw before reaching the server, such as the server could not be reached | Kept, `status: QUEUED`, with `attempts` counting it, `nextAttemptAt` saying when it is tried again and `error` holding what it threw |
| The send threw `maxSendAttempts` times | Kept, `status: FAILED` |

Each mail of a pass is sent on its own, so one whose send throws holds back none of the others. It is passed over until its `nextAttemptAt`: `retryDelayInMs` after the first attempt, and twice as long after each further one.

A mail is sent with a `Message-ID` made from its id, the same on every attempt. A send that reached the server and threw before it could be recorded is sent again with that id, which receiving servers drop duplicates by.

`persist` applies to mails that were sent. A failed mail is kept either way, so you can look up a password reset or a 2FA code that never arrived.

Only `QUEUED` mails are picked up, so a `FAILED` row is never attempted again. It is kept for `failedRetentionInMs`, counted from when the mail was queued, and `EmailCleanupCronJob` deletes it once a day after that. With `'forever'`, failed mails are kept until you delete them.

A mail server can accept some recipients of a mail and refuse others, such as one address of a list that does not exist. `rejectedRecipients` names the refused ones.

## Requirements
| Package | Used for |
|---|---|
| `nodemailer` | Sending emails over SMTP, with `SmtpEmailTransport`. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Email` | Every application |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Templating](./templating.md) — writing the tsx email templates
- [Replication](./replication.md) — how the queue is drained exactly once across instances
- [Rate limiting](./rate-limiting.md) — the `EmailRateLimiter` enforcing `maxEmailsPerHour`
