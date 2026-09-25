# Handling emails
Zibri provides an out of the box email service with with templating, mail queue, persistence and priority handling.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EmailServiceInterface` | interface | Queue emails |
| `ZIBRI_DI_TOKENS.EMAIL_SERVICE` | DI token | Injects `EmailServiceInterface` |
| `EmailConfigInput` | type | Options accepted by the `EMAIL_CONFIG` DI token |
| `ZIBRI_DI_TOKENS.EMAIL_CONFIG` | DI token | Configures the sender, the rate limit and how the queue is drained |
| `EmailTransportInterface` | interface | What delivers a mail |
| `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT` | DI token | Injects `EmailTransportInterface` |
| `SmtpEmailTransport` | class | The transport Zibri ships, over SMTP |
| `EmailPriority` | enum | Priority of a queued email (eg. `HIGH`, `NORMAL`) |

## Usage
### Configuring email
Email needs two things: what the subsystem should do, and what delivers a mail. Both are providers, and both are required — there is no default transport, because every one of them needs a server or an api key that only your deployment knows.

```ts
// src/providers.ts
import { defineProvider, DiProvider, ZIBRI_DI_TOKENS, EmailConfigInput, SmtpEmailTransport } from 'zibri';

export const providers: DiProvider<unknown>[] = [
    // ...
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
        useFactory: (): EmailConfigInput => {
            return {
                defaultSender: 'Test Test',
                maxEmailsPerHour: 1000
            };
        }
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT,
        useFactory: () => new SmtpEmailTransport({
            host: 'mailserver-host',
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

### Sending through something other than SMTP
Plenty of environments do not allow outbound SMTP at all, and send through an http API instead — SES, SendGrid, Postmark. Implement `EmailTransportInterface` and register it under the same token; everything else about the mail subsystem is unchanged.

```ts
// src/email/my-api.email-transport.ts
import { Email, EmailSendResult, EmailTransportInterface } from 'zibri';

import { myProvider } from './my-provider';

export class MyApiEmailTransport implements EmailTransportInterface {

    readonly name: string = 'MyApiEmailTransport';

    async send(email: Email): Promise<EmailSendResult> {
        const response = await myProvider.messages.create({
            from: email.sender,
            to: email.recipients,
            subject: email.subject,
            html: email.html
        });
        return { rejectedRecipients: response.rejected };
    }
}
```

Two rules decide whether a mail is kept, retried or recorded as failed, so a transport has to get them right:

| The transport | Means | The row |
|---|---|---|
| Throws | The message never reached the provider — a refused connection, a timeout, a 5xx, an expired credential | Stays `QUEUED` and is attempted again once the claim on it expires |
| Returns `rejectedRecipients` | The provider answered and refused those addresses | `FAILED`, and never attempted again |

Answering where you should have thrown loses the mail silently. Throwing where you should have answered sends the accepted recipients a second copy on the next attempt.

Add `close()` if the transport holds something — a connection pool, a keep-alive agent, an sdk client. It is called when the application shuts down.

### Queueing an email
Then you can use the email service:

```ts
import { EmailServiceInterface, ZIBRI_DI_TOKENS, inject, EmailPriority } from 'zibri';
import renderBaseEmail from '../templates/emails/base-email.hbs';
import renderEmailContent from '../templates/emails/my-email.hbs';

export async function queueTestEmail(): Promise<void> {
    const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
    const content: string = renderEmailContent({
        some: 'data'
    });
    await emailService.queue({
        recipients: ['test@test.com'],
        subject: 'test',
        priority: EmailPriority.HIGH, // defaults to NORMAL
        html: renderBaseEmail({
            content,
            base: {
                title: 'Test Email',
                baseUrl: 'http://localhost:3000'
            }
        })
    });
}
```

### What happens to the row

A queued mail is a row in the `Email` table, and what becomes of it depends on how the send went.

| Outcome | Row |
|---|---|
| Sent, `persist: false` (the default) | Deleted — the queue drains |
| Sent, `persist: true` | Kept, `status: SENT` |
| A recipient was refused | Kept, `status: FAILED`, with `rejectedRecipients` naming the addresses |
| The send threw before reaching the server | Kept, `status: QUEUED` — it is tried again |

`persist` decides what happens to a mail that was **sent**. A mail that failed is kept either way: the row is the only record that it was ever owed, and a rejected password reset or 2FA code is exactly the thing you need to be able to look up afterwards.

Only `QUEUED` mails are picked up, so a `FAILED` row is a record rather than a retry — nothing attempts it again. That also means failures accumulate: if you send at volume, clean the table up on whatever schedule your retention calls for.

A mail server routinely accepts some recipients of one message and refuses others, which is the common real bounce — one address in a list that no longer exists. `rejectedRecipients` is which ones, so the row answers *who* rather than only *that something went wrong*.

### About rendering templates
You might be wondering how we can import a ts function from a file ending with `.hbs`.

That's due to our handlebars compiler that automatically creates ts definitions based on your templates. It is actually smart enough to detect any variables that you use in your templates, as well as infer their type. While being extremly helpful, this type safety comes with the downside that any variables you use are restricted in their typing for the compiler to infer their type. They need to be either:
- string
- string[]
- an object with its values being either string, string[] or another object

These are also hot reloaded when you change your templates and eg. introduce or remove a new variable.  

> Caveat:<br>
> If you don't run `npm run start` then the compiler won't be able to generate the .ts files. So if you have any problems with eg. a property of your template not being recognized, check that first.

## Configuration
`ZIBRI_DI_TOKENS.EMAIL_CONFIG` holds what the subsystem does; `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT` holds what delivers a mail. Both are shown in "Configuring email" above.

| Option | Meaning |
|---|---|
| `defaultSender` | The address a mail queued without a sender goes out as |
| `maxEmailsPerHour` | The hourly budget queued mails are rate limited against |
| `sendLeaseInMs` | How long one instance may hold a queued mail while sending it. Renewed while the send runs, so it decides how long a mail waits before another instance takes over from one that stopped existing. Defaults to one minute |
| `sendBatchSize` | How many mails one pass of the queue sends at most. Raise it to drain a backlog faster, lower it for a provider that dislikes bursts. Defaults to 10 |

Priorities cannot starve each other whatever `sendBatchSize` is: each priority may take at most that many slots less one per priority below it, so a permanent flood of `HIGH` still leaves a slot for `NORMAL` and one for `LOW` every pass.

## See also
- [Replication](./replication.md) — how the queue is drained exactly once across instances
- [Templating](./templating.md) — rendering the `.hbs` email templates
- [Rate limiting](./rate-limiting.md) — the `EmailRateLimiter` enforcing `maxEmailsPerHour`