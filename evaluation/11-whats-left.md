# What's left

An index of what is still open, and nothing else. A finding leaves this file the moment it is
completely done; what was decided, how it closed and what it found on the way belong to its chapter.
If something here is not in a chapter, the chapter is what is wrong.

**265 findings: 240 closed, 2 partly closed, 23 open** (counted 2026-10-15). Counted are every
finding with a heading of its own in chapters 01–06 and 10, whose heading is its status; every entry
of the MINOR lists in 01 and 02; and 03 §E1's password length,
a residue whose owner had closed without it. Chapter 07 is not counted, because nearly every row
of it points at one of those findings, and it has none open. Withdrawn and decided-against findings
count as closed.

---

## Deferred on purpose

Open, and each with a reason in its chapter for not being done yet.

| | |
|---|---|
| [03 §H20](./03-auth-and-security.md) | a tenant bringing its own sign-in, filed while building multi-tenancy |

## Waiting on a decision

Open, with the options in their chapter.

| | |
|---|---|
| [02 §M11](./02-http-runtime-core.md) *(partly)* | HTTP/2, and in-process TLS, which the deployment terminates |
| [03 §A2](./03-auth-and-security.md) *(partly)* | permissions and a role hierarchy: `hasRole` takes a flat list of roles |

## Not started

Open, filed on the re-check of 2026-10-15.

| | |
|---|---|
| [01 §M41](./01-data-layer.md) | a page can be as large as its caller asks (`CrudController` takes it from the query), and a negative one reads differently per store |
| [01 §M42](./01-data-layer.md) | a change set names its row's id and not its entity, so two entities sharing an id share a history and rollbacks |
| [01 §M45](./01-data-layer.md) | deleting a row that records change sets keeps its change sets |
| [01 §M46](./01-data-layer.md) | deleting a row that rows point at, through no relation removing them, leaves them dangling off postgres |
| [02 §M18](./02-http-runtime-core.md) | a connection without `auth.offset` joins none of its rooms, and the field is undocumented |
| [04 §2.14](./04-infrastructure-subsystems.md) | a mail whose send throws stays at the head of the queue and can stop a priority |
| [04 §2.15](./04-infrastructure-subsystems.md) | disabling, enabling, rescheduling or stopping a cron job reaches only one instance |
| [04 §2.16](./04-infrastructure-subsystems.md) | the default timeouts of normal and priority thread jobs are swapped |
| [04 §6.1](./04-infrastructure-subsystems.md) | an address on one mailing list is put on any other without confirming |
| [04 §6.2](./04-infrastructure-subsystems.md) | a subscription confirmation token never expires and is never used up |
| [04 §6.3](./04-infrastructure-subsystems.md) | unsubscribing is a GET, and the subscriber id is the only credential for preferences |
| [04 §6.5](./04-infrastructure-subsystems.md) | a payment amount is a float sent as `String(amount)` |
| [04 §6.6](./04-infrastructure-subsystems.md) | two recipients whose names abbreviate alike draw the same invoice numbers, and the second cannot be invoiced |
| [04 §6.7](./04-infrastructure-subsystems.md) | e-invoice amounts are written unrounded and VAT is summed per line, which EN 16931 validators refuse |
| [06 §C8](./06-tooling-ci-and-testing.md) | `zi new` answers `defaultAuth` for the developer, with `'public'` |
| [10 §10.5](./10-leases-and-claims.md) | the first sign-in lease of a directory ends before the login commits |
