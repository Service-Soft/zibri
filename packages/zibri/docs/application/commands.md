---
keywords: [cli, command line, shell, script, maintenance, break glass, reset admin, locked out]
---

# Commands
A command runs code of your application from the shell, in place of starting it:
`node dist/bundle.js reset-admin`. The application is initialized for it, with its data sources
connected and its services built, and shut down once the command is done. It does not listen, and
runs no cron job, event or thread job, so a command can run beside the instances that serve.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AppCommand` | type | A command of the application: its `name`, a `description` and what it `run`s. Listed in `commands` of the application options |

## Writing a command
A command is named by its first word, and `run` is handed the arguments after it:

```ts
// src/commands/deactivate-user.command.ts
import { AppCommand, AuthServiceInterface, inject, ZIBRI_DI_TOKENS } from 'zibri';

import { User } from '../models';
import { userRepository } from '../repositories';

export const deactivateUserCommand: AppCommand = {
    name: 'deactivate-user',
    description: 'Takes away the access of a user: deactivate-user <email>',
    run: async ([email]: string[]): Promise<void> => {
        if (email == undefined) {
            throw new Error('Name the email of the user to deactivate.');
        }
        const user: User = await userRepository.findOne({ where: { email } });
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        await authService.deactivateUser(user.id, undefined);
    }
};
```

List it in `commands` of the application options:

```ts
// src/application-options.base.ts
import { deactivateUserCommand } from './commands/deactivate-user.command';
import { resetAdminCommand } from './commands/reset-admin.command';

commands: [resetAdminCommand, deactivateUserCommand]
```

A name is one word that does not start with `-`, and is not `migrate`. Two commands of the same
name, or a name that breaks these rules, stop the application while it is built.

## Running a command
`runCommand` in `src/index.ts` runs the command the process was started with, and `zi new` writes the
call:

```sh
node dist/bundle.js deactivate-user ada@example.com
```

A command that throws ends the process with its error. In an application with commands, a first
argument that names none of them and does not start with `-` starts the application, with a warning
that lists its commands and their descriptions. The
[migration commands](../data/data-source.md#going-back) run the same way.

A command reads the same environment the application starts with, and its database is set up the way a
start sets it up: the migrations its build carries are applied first, and a database a newer build
migrated is refused.

## Letting the default admin in again
`zi new` writes `reset-admin`, for when nobody can administer the application. It finds the
user named by `DEFAULT_ADMIN_EMAIL` and:

1. reactivates them, when they were [deactivated](../auth/auth.md#deactivating-a-user)
2. gives back the platform admin role, when they lost it
3. removes their [second factors](../auth/two-factor.md#resetting-a-users-second-factors)
4. [sets their password](../auth/auth.md#setting-a-password-for-a-user) to `DEFAULT_ADMIN_PASSWORD`,
   which lifts a lock and ends their logins, and has them choose a new one at their next login

Set `DEFAULT_ADMIN_PASSWORD` to a new password for the run, in place of one written down elsewhere:

```sh
DEFAULT_ADMIN_PASSWORD='<a new password>' npm run reset-admin
```

The admin logs in with it once, and chooses a password of their own. Each step leaves an account
that is already fine as it is, so running it again changes nothing more. The default admin is created
by the start of the application, so `reset-admin` fails when there is no such user.

## Logging everybody out
`zi new` writes `end-every-login`, for when the database, a backup or a secret got out. It ends every
login of every user with [`endEveryLogin`](../auth/auth.md#logging-everybody-out), and everybody logs
in again:

```sh
npm run end-every-login
```

An access token already issued works until it expires, an hour by default. Replace
`JWT_ACCESS_SECRET` without keeping the old one to take those away too, see
[replacing a key](../auth/auth.md#replacing-a-key).

An [auth service of your own](../auth/auth.md#logging-everybody-out) that lacks `endEveryLogin` or
`setPassword` makes `end-every-login` or `reset-admin` fail, naming the method.

## See also
- [Responding to an incident](../operations/incidents.md) — what to do when something breaks
- [Data sources](../data/data-source.md#going-back) — the migration commands
- [Authentication and authorization](../auth/auth.md) — what a command can do to users and their logins
