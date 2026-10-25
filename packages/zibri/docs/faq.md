# FAQ
The decisions behind Zibri that span many pages. Each answer is short and links to the page that
covers the topic.

## Why do some options have no default?
Some options have two answers, and each is right for some applications. A default would make "you
forgot to choose" look the same as "you chose this". So these options are required, and the compiler
or the startup error asks for them once, in the one place they can be answered:

| Option | Two answers |
|---|---|
| [`defaultAuth`](./auth.md#what-an-undecorated-route-requires) | A route without `@Auth` is public, or needs a login |
| [`twoFactorAtLogin`](./two-factor.md#asking-for-a-second-factor-at-login) | Whether a login asks for a second factor |
| [`textOrder`](./localization.md#which-order-text-is-in) | Which order text is sorted in, when the supported locales disagree |
| [`backupScope`](./backup.md#backing-up-a-data-source) | What a backup of a Postgres data source covers |
| [`EVENT_FAILED_RETENTION_IN_MS`](./events.md#when-an-event-cannot-be-handled), [`THREAD_JOB_RETENTION_IN_MS`](./multithreading.md#what-happens-to-a-finished-job), `AUDIT_RETENTION_IN_MS` | Keeping rows forever, or deleting them after a while |

`defaultAuth` has exactly two values. Every other check, such as a permission or a second factor,
needs a login first, so it implies `'requireLogin'`.

## Why does every application set up email, events and thread jobs?
They are building blocks that features and plugins rely on being there, such as a password reset
sending a mail. So every application provides what they need, such as an email transport, and its
data source declares their entities. An application that does without one replaces its service, see
[running without email, events or thread jobs](./configuration.md#running-without-email-events-or-thread-jobs).

## Why does every entity have a tenant?
Every application has tenants, even one with a single customer, so isolation never depends on a
setting someone has to turn on. Each entity says where its rows belong: in one tenant, or shared by
all. A forgotten tenant does not compile, and a row without one never ends up where every tenant
sees it. Crossing tenants is always explicit, with `runAs` for one tenant or `acrossTenants` on a
single call. See [declaring the tenant of an entity](./tenancy.md#declaring-the-tenant-of-an-entity).

## See also
- [Getting started](./getting-started.md) — the first application
- [Architecture](./architecture.md) — how the parts fit together
