# What's left

An index of what is still open, and nothing else. A finding leaves this file the moment it is
completely done; what was decided, how it closed and what it found on the way belong to its chapter.
If something here is not in a chapter, the chapter is what is wrong.

**309 findings: 295 closed, 2 partly closed, 12 open** (counted 2026-10-19). Counted are every
finding with a heading of its own in chapters 01–06 and 10, whose heading is its status; every entry
of the MINOR lists in 01 and 02; and 03 §E1's password length,
a residue whose owner had closed without it. Chapter 07 is not counted, because nearly every row
of it points at one of those findings; its three open bullets are listed at the end, beside what 09
has not reviewed. Withdrawn and decided-against findings count as closed.

---

## Deferred on purpose

Open, and each with a reason in its chapter for not being done yet.

| | |
|---|---|
| [03 §H20](./03-auth-and-security.md) | a tenant bringing its own sign-in, filed while building multi-tenancy |
| [05 §M6](./05-di-metadata-and-packaging.md) | `exactOptionalPropertyTypes`, a modelling pass over the public api rather than a flag |
| [10 §10.6](./10-leases-and-claims.md) | a deadlock between valkey transactions ends all of them after a timeout |

## Waiting on a decision

Open, with the options in their chapter.

| | |
|---|---|
| [02 §M11](./02-http-runtime-core.md) *(partly)* | HTTP/2, and in-process TLS, which the deployment terminates |
| [03 §A2](./03-auth-and-security.md) *(partly)* | permissions and a role hierarchy: `hasRole` takes a flat list of roles |
| [04 §1.14](./04-infrastructure-subsystems.md) | a push-only websocket application on one instance gets no server |

## Left open by closed findings

Open, filed from 2026-10-15 on, from what a closed finding named as still open, not done or not built.

| | |
|---|---|
| [06 §X7](./06-tooling-ci-and-testing.md) | an application that is itself an ES module is not tested |

## Not counted

| | |
|---|---|
| [07 Part 2](./07-documentation-vs-code.md) | no page on log aggregation or metric label cardinality |
| [07 Part 2](./07-documentation-vs-code.md) | nothing validates a configuration variable beyond it being present |
| [07 Part 2](./07-documentation-vs-code.md) | no runbook gathering what to do when something stopped on its own |
| [09](./09-method-and-coverage.md) | what the review has still not read: the class helpers, `src/document`, `src/localization`, `src/validation` and more |
