# Zibri — Enterprise Adoption Evaluation, round 2

A second technical due-diligence review of Zibri, run on 2026-10-21 over the whole repository, framed
the same way as the [first round](../README.md): *why might a major international company decline to
adopt this as its main backend technology?*

**Scope:** code, architecture, documentation and developer experience. **Out of scope** as before:
maturity, community, ecosystem size, "it's new".

**What is different from round 1.** The first round was written before the rework and has since
closed 302 of its 315 findings. This round starts from the tree as it stands after that rework, with
no restriction to the first round's areas, and adds two things the first round did not have: a
classical code review of shape, duplication and layering ([code-review/](./code-review/)),
and a developer-experience pass written from the point of view of somebody building an application
([08](./08-docs-and-dx.md)). Findings only: no code was changed and no test was written. Every
finding ends with a **Verify** note saying which test would prove it.

---

## Contents

| File | Area | IDs |
|---|---|---|
| [00-executive-summary.md](./00-executive-summary.md) | The prioritised list, grouped by theme — read this first | |
| [01-data-layer-repository.md](./01-data-layer-repository.md) | Repository, the driver chain, entities, class helpers, change sets, scopes, tenancy narrowing | D |
| [02-data-layer-stores.md](./02-data-layer-stores.md) | Postgres and valkey data sources, where conversion, transactions, migrations, backups | S |
| [03-http-runtime-core.md](./03-http-runtime-core.md) | Bootstrap, routing, parsing, middleware, errors, lifecycle, OpenAPI, websockets, validation | H |
| [04-auth-core.md](./04-auth-core.md) | Auth service, sessions, 2FA, passkeys, roles, tenancy, rate limiting, audit | A |
| [05-identity-providers.md](./05-identity-providers.md) | OIDC/OAuth2, SAML, LDAP/AD, SCIM, the authorization server, client certificates | I |
| [06-infrastructure.md](./06-infrastructure.md) | Cron, events, mail, caching, logging, metrics, tracing, thread jobs, leases, http client, plugins | F |
| [07-di-packaging-tooling.md](./07-di-packaging-tooling.md) | DI container, packaging, CI, the CLI scaffold, zibri-testing, the TSX compiler | T |
| [08-docs-and-dx.md](./08-docs-and-dx.md) | Claims the code does not support, missing pages, articulation, the day-to-day of building an app | X |
| [10-whats-open.md](./10-whats-open.md) | Every finding of this round in one table, by severity — the round's own "what now" | |
| [11-unread-code-review.md](./11-unread-code-review.md) | What neither round had read, reviewed after this round's findings closed, and what came of it | T, C, L, S, K, A, U, V, W |

The code review is kept apart from the evaluation, under [code-review/](./code-review/):

| File | Holds | IDs |
|---|---|---|
| [code-review/01](./code-review/01-data-layer-repository.md) … [07](./code-review/07-di-packaging-tooling.md) | The quality and structure items of the chapter with the same number: shape, duplication, naming, CODE_STYLE | Q (T16–T20 in 07) |
| [code-review/09-architecture-and-code-quality.md](./code-review/09-architecture-and-code-quality.md) | The cross-cutting review: the driver stack, the ORM question, generic systems vs hand-written copies, layering, CODE_STYLE, API consistency | Q |

"01 §Q2" is therefore the repository area's second quality item and "09 §Q2" the cross-cutting
review's. Each evaluation chapter also has an **Already filed** list pointing at the round-1 finding
that already covers something, and a **Not reviewed** list.

---

## Method

Nine parallel passes over the working tree of branch `v3` on 2026-10-21, one per chapter, each
read-only. Every pass was told to grep the first round before filing, to read a closed finding's
closure note before calling its outcome a defect, to cite `path:line` and reason from the code
rather than from names, and to check the matching docs page, inline comments and neighbouring tests
for a stated reason before calling something a defect. A behaviour that is deliberate and sound is
not filed; one that is deliberate but still a problem for an adopter is, with the recorded reason
and why it falls short.

**The tree was mid-change.** The review ran on a working tree with a large uncommitted diff (auth,
tenancy, roles, the sandbox, many docs pages). Each finding says when a cited file is modified or
untracked in the working tree; such a citation describes the file as it stood that day and may have
moved since.

**Nothing was executed.** No test, build or lint was run and no container was started. Every
performance statement is a reading of the code, and the **Verify** note on each finding is the
measurement that would settle it. Three of the four CRITICALs were re-read by the coordinator
against the code during synthesis and matched: [03 §H1](./03-http-runtime-core.md) (the
`filesMap` object literal and the `push` inside the `finish` listener), [05 §I1](./05-identity-providers.md)
(the `max_age` request and the `auth_time` refusal; whether Google omits the claim rests on its
discovery document and the Verify note's real sign-in), and [09 §Q3](./code-review/09-architecture-and-code-quality.md)
(the in-process evaluator deciding the write-side scope on every store). The rest come from the
delegated passes with line-level citations; **re-read the cited lines before acting on any one of
them**, as the first round's method note also asked.

**The user's own list.** [after-all-findings-fixed.md](../after-all-findings-fixed.md) holds the
things the maintainer wanted looked at once the first round closed. Each item that fell in a pass's
area is assessed there with a severity and a Verify note, and marked as coming from that list.

---

## Severity legend

| Level | Meaning |
|---|---|
| **CRITICAL** | Independently sufficient grounds to reject, or a live security/availability/data-loss defect. In [code-review/09](./code-review/09-architecture-and-code-quality.md): a structural problem that will keep producing defects |
| **MAJOR** | Would have to be fixed or worked around before a production rollout |
| **MINOR** | Real, but survivable; mostly DX and polish |

## Finding format

```
### <ID>. <Title> — <SEVERITY>
*Filed 2026-10-21.*
What the code does, with path:line. Why it matters to an adopter. What was checked to make sure
it is not deliberate. A fix direction where one is obvious, alternatives where it is not.
**Verify:** the test that proves it, and which harness it needs.
```

Headings are the status, as in round 1: a finding that closes gets `~~SEVERITY~~ **FIXED**` on its
heading and a blockquote under it saying what changed, and leaves [10](./10-whats-open.md).
