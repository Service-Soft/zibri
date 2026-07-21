# Handling emails
Zibri provides an out of the box email service with with templating, mail queue, persistence and priority handling.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `EmailServiceInterface` | interface | Queue emails |
| `ZIBRI_DI_TOKENS.EMAIL_SERVICE` | DI token | Injects `EmailServiceInterface` |
| `EmailConfigInput` | type | Options accepted by the `EMAIL_CONFIG` DI token |
| `ZIBRI_DI_TOKENS.EMAIL_CONFIG` | DI token | Configures the email server connection and rate limit |
| `EmailPriority` | enum | Priority of a queued email (eg. `HIGH`, `NORMAL`) |

## Usage
### Configuring the email server
In order for you to use it, you first have to provide your email server configuration to the providers array:

```ts
// src/providers.ts
import { ZIBRI_DI_TOKENS, EmailConfigInput } from 'zibri';

// ...
{
    token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
    useFactory: (): EmailConfigInput => {
        return {
            defaultSender: 'Test Test',
            host: 'mailserver-host',
            port: 587,
            auth: {
                user: 'mail-user',
                pass: 'mail-password'
            },
            maxEmailsPerHour: 1000
        };
    }
}
// ...
```

### Queueing an email
Then you can use the email service:

```ts
import { EmailServiceInterface, ZIBRI_DI_TOKENS, inject, EmailPriority } from 'zibri';
import renderBaseEmail from '../templates/emails/base-email.hbs';
import renderEmailContent from '../templates/emails/my-email.hbs';

// ...

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
    });
});
```

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
The email server connection, default sender and hourly rate limit are configured via the `ZIBRI_DI_TOKENS.EMAIL_CONFIG` token, as shown in "Configuring the email server" above. Queued emails are rate limited internally against `maxEmailsPerHour`.

## See also
- [Templating](./templating.md) — rendering the `.hbs` email templates
- [Rate limiting](./rate-limiting.md) — the `EmailRateLimiter` enforcing `maxEmailsPerHour`