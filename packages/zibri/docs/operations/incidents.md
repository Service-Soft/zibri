---
keywords: [runbook, incident, on call, outage, disaster recovery, emergency, playbook, rollback, breach, leaked secret, locked out]
---

# Responding to an incident
An incident is something in production that broke and needs dealing with at once: a release that
fails, a database that is down, a secret that got out, an admin who cannot log in. Each section names
what you see and what to do, and links to the page that explains it. The runbook of your own
deployment starts from these, with the names of your secrets, your orchestrator and who to call.

## Finding out what happened
| To find | Read |
|---|---|
| Every line one request wrote, across instances and services | Its trace id, see [finding the lines of one request](./logging.md#finding-the-lines-of-one-request) |
| Who logged in, failed to, was locked or changed a password | The [audit trail](../data/audit.md#reading-the-trail), see [what gets recorded](../auth/auth.md#what-gets-recorded) |
| How busy the instances are, and how long requests take | The [metrics](./metrics.md#what-a-snapshot-contains) |
| Where an error was thrown | Its stack trace, which names the source file and line, see [what a deployment is](./deployment.md#what-a-deployment-is) |

## Going back to the previous release
A release that changed no schema goes back by deploying the build before it. A release that migrated
the database is taken back by its own build.

> [!WARNING]
> A `down()` that drops a column drops its data. Take a [backup](../data/backup.md#creating-and-restoring-backups) before step 2.

1. Stop the instances running the newer build.
2. Run `npm run migrate:down -- <the newest migration the older build carries>` with the newer build.
3. Deploy the older build.

An older build refuses to start on a database a newer one migrated, and says what to run. See
[going back](../data/data-source.md#going-back).

## Restoring data from a backup
Stop every instance but one, restore the backup on that one, and start the others again once it is
done, see [restoring with one instance](../data/backup.md#restoring-with-one-instance). A restore
checks the backup before it applies any of it, see
[what a restore checks first](../data/backup.md#what-a-restore-checks-first), and brings a backup of an
older release in line with the current one.

Restore on an instance whose `.zibri/backups` outlives its container, so a restore killed halfway is
put back at the next start, see [what the application writes](./deployment.md#what-the-application-writes).

## When the database cannot be reached
While a data source cannot be reached:

- `GET /health/live` answers on the process alone, so the orchestrator restarts nothing, see
  [health endpoints](./deployment.md#health-endpoints).
- A request that needs the data source fails with a status of 500 or above, and is logged.
- A [rate limiter](../endpoints/rate-limiting.md#when-the-store-cannot-answer) whose store is in it
  answers `503`, or lets the call through, as its `onStoreFailure` says.
- Work that only one instance may do at a time is taken over by another instance once its
  [lease](../glossary.md#lease) lapses, see
  [work held by an instance that is gone](../background-work/troubleshooting.md#work-held-by-an-instance-that-is-gone).

Once the data source takes connections again, every instance serves again. Nothing needs a restart.
Then look for work that stopped while it was down, see [recovering work that stopped](../background-work/troubleshooting.md).

## When an account was taken over
| To | Call on `ZIBRI_DI_TOKENS.AUTH_SERVICE` |
|---|---|
| Take the user's access away and keep them out | `deactivateUser`, see [deactivating a user](../auth/auth.md#deactivating-a-user) |
| End their logins and revoke their api keys, and let them log in again | `endAccess` |
| Have them choose a new password at their next login | `requirePasswordChange`, see [requiring a new password](../auth/auth.md#requiring-a-new-password) |
| Give them a password, such as through support | `setPassword`, see [setting a password for a user](../auth/auth.md#setting-a-password-for-a-user) |

`resetSecondFactors` of `ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE` removes their [second factors](../glossary.md#second-factor), see
[resetting a user's second factors](../auth/two-factor.md#resetting-a-users-second-factors). The
[audit trail](../data/audit.md#reading-the-trail) holds what was done as them. Write each of these as a
[command](../application/commands.md#writing-a-command), so it runs from the shell when no admin screen
is reachable.

## When a secret got out
> [!WARNING]
> A backup taken under the old [master key](../glossary.md#master-key) is restored with it. Keep it listed for as long as you keep such backups, see [telling when a rotation is done](../data/encryption-and-hashing.md#telling-when-a-rotation-is-done).

| Secret | Lets whoever holds it | What to do |
|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Sign a token for any user | Replace it without keeping the old one among the previous keys: every token it signed is refused, and everybody logs in again. See [replacing a key](../auth/auth.md#replacing-a-key) |
| `MASTER_KEY` | Read every encrypted value, together with a copy of the database | Set a new master key, keep the old one among `oldMasterKeys` until nothing needs it, and rotate the data keys. See [setting the master key](../data/encryption-and-hashing.md#setting-the-master-key) and [rotating a key](../data/encryption-and-hashing.md#rotating-a-key) |
| A copy of the database or a backup | Read what it holds, and the logins stored in it | [Log everybody out](#logging-everybody-out), and rotate the master key and the data keys as above |
| An api key | Act as the user or service it belongs to | Revoke it, see [listing and revoking](../auth/api-keys.md#listing-and-revoking) |
| The password of the database, the mail server or a provider | Reach that service as the application | Replace it at the service and in the environment, and restart the instances, which read the environment as they start. See [configuration](./deployment.md#configuration) |

## Logging everybody out
`end-every-login`, which `zi new` writes, ends every login of every user, in every strategy:

```sh
npm run end-every-login
```

An access token already issued works until it expires, an hour by default, unless access tokens are
revoked immediately. Replacing `JWT_ACCESS_SECRET` without keeping the old one takes those away too.
See [logging everybody out](../application/commands.md#logging-everybody-out) and
[`endEveryLogin`](../auth/auth.md#logging-everybody-out).

## When many logins fail
The login and password reset routes are limited per caller, see
[how often a caller may try](../auth/auth.md#how-often-a-caller-may-try), and an account locks after
too many wrong passwords once `passwordFailureLimit` is set, see
[locking an account](../auth/auth.md#locking-an-account-after-too-many-wrong-passwords).

Every failed login is in the audit trail as `auth.login` with `outcome: failure` and the submitted
address. Many addresses from one caller, or one address from many callers, show which kind of attack
it is. Password resets for addresses nobody holds are recorded as `no-such-subject`, see
[what gets recorded](../auth/auth.md#what-gets-recorded).

## When nobody can administer the application
`reset-admin`, which `zi new` writes, lets the default admin in again: it reactivates them, gives back
the admin role, removes their second factors and sets their password from the environment, for them to
replace at their next login:

```sh
DEFAULT_ADMIN_PASSWORD='<a new password>' npm run reset-admin
```

See [letting the default admin in again](../application/commands.md#letting-the-default-admin-in-again).

## When work stopped
A cron job that stopped, an event or a thread job that failed, a mail that was not sent and a backup
that failed each start again in a way of their own, see [recovering work that stopped](../background-work/troubleshooting.md).

## See also
- [Recovering work that stopped](../background-work/troubleshooting.md) — background work, mails and backups
- [Commands](../application/commands.md) — running code of your application from the shell
- [Deployment](./deployment.md) — health endpoints, configuration and what a deployment writes
- [Backup](../data/backup.md) — taking and restoring backups
- [Authentication and authorization](../auth/auth.md) — logins, passwords and what gets recorded
