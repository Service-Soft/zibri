# Documentation style

How the pages in `packages/zibri/docs/` are written. Read this before you write or change one.

The pages are for two readers at once: a developer who is new to Zibri, and the AI assistant that
developer asks for help. Both need the same things. Exact names, tables that list everything,
examples that compile, and one topic in one place. A page that serves one of them well serves the
other.

The documentation site in `packages/docs-site` publishes every page in `docs/`, which is why this file lives at the
root.

`packages/zibri/src/application/docs-style.test.ts` checks what a single word gives away: history,
references into the repository, store internals, framing, pronouns, made-up names, em dashes,
`<br>` and British spelling. It also checks the parts of a page and their order, the file comment
on every example, the links between pages, that every imported name has a Key exports row, and that
every package Zibri stands on and every entity it stores rows in has a Requirements row. The rest of
this file takes a reader.

# Table of Contents

- [Documentation style](#documentation-style)
- [Table of Contents](#table-of-contents)
- [The reader](#the-reader)
- [The voice](#the-voice)
  - [What stays out of a page](#what-stays-out-of-a-page)
  - [Reasons](#reasons)
  - [Warnings and limits](#warnings-and-limits)
  - [Words and punctuation](#words-and-punctuation)
- [A page](#a-page)
  - [Keywords](#keywords)
  - [The intro](#the-intro)
  - [Key exports](#key-exports)
  - [Sections](#sections)
  - [Option tables](#option-tables)
  - [Choosing between tools](#choosing-between-tools)
  - [Requirements](#requirements)
  - [See also](#see-also)
- [Code examples](#code-examples)
- [Pages and folders](#pages-and-folders)
- [The FAQ](#the-faq)

# The reader

**They know TypeScript, Node, HTTP and SQL. They do not know Zibri, and they may not know the
domain.** Passkeys, OIDC, SAML, SCIM, leases and envelope encryption are new to many readers.
Explain such a term in one plain sentence where the page introduces it, and link it to the
[glossary](./packages/zibri/docs/glossary.md).

**They come with a task.** They want to log users in, send a mail, run a job every night. Pages
and sections are named and ordered by those tasks, not by how the code is organized.

# The voice

**Say what is.** What the reader does, and what they get. Present tense, active voice.

**Short sentences.** One idea per sentence. A long sentence with three clauses is three sentences.
There is no rule on how many sentences a paragraph has: shorter sentences are what make a page easy
to read, not fewer of them.

**Second person for the developer, third person for their users.** The developer is "you". The
people using their application are "users", and a user is "they". Never "he" or "she".

**Name Zibri only where the reader has to tell it apart from their own code.** "Registered for you"
says enough; "Zibri registers it for you" says the same thing longer.

**Write it plainly.** No framing ("Two things have to be true"), no closing aphorism, no bold
sentence in the middle of a paragraph, no announcing that something matters. Do not call anything
simple or easy: the reader decides that. If a sentence would fit on any other page of any other
framework, it says nothing about this one.

**A comparison is a one-line orientation.** "This is what NestJS calls a provider" saves a reader
real time. Which framework does it better does not belong on a page.

## What stays out of a page

**History.** Not what changed, not what something used to do, not "still", "any more", "now" or
"today". A reader who never saw the old version does not need it. `upgrading-to-<major>.md` is the
one exception, and it lists only what an application has to act on.

**How it works underneath.** Not the key layout in Valkey, not the Postgres lock, not which library
runs the schedule. Name a concrete implementation only as an example of what to configure. If it
ever matters to the reader which store is underneath, the abstraction leaks, and that is the bug.
`costs.md` is the one page that names stores, in a table of measured numbers.

**References into the repository.** No bug finding, no test file, no source path ("see
`PasswordCredentials` in the auth module"). Link to a page, or name the export.

**What a feature is not**, phrased as a negative. A limit is stated as what is, see
[warnings and limits](#warnings-and-limits).

**What the reader will notice on their own.** No "must be registered in a data source" or "the
application does not start without it": the boot error says that. A required option is marked
"Required" in its table.

**What the types already show.** When the type makes it clear that something is possible, a side
note is enough. It does not need a section with an example.

## Reasons

**One short sentence of why, when a rule would look arbitrary without it.** Never a paragraph.

**Or a link to the page that covers it.** Someone setting up their data source does not care about
round trips yet. They will once their application grows, so the setup section links to
`costs.md`, and a cost that surprises (a `select` that reads more columns than it names) gets one
sentence there and the link.

**A decision that spans many pages goes to the [FAQ](#the-faq).** The page links to the entry.

**Everything else goes to an inline `//` comment** next to the code that holds the decision, as
`CODE_STYLE.md` says.

## Warnings and limits

**Small, unsurprising and with small effects: a plain sentence**, right after the option or example
it concerns. "The ticket logs in once."

**Detailed, or with heavy implications: an alert block.** Two kinds, nothing else:

```md
> [!WARNING]
> Changing `relyingPartyId` makes every passkey unusable.

> [!NOTE]
> `ValKeyDataSource` connects to a single server.
```

`WARNING` is for what can hurt the reader: data loss, a security hole, a setting that cannot be
undone, something that fails silently. `NOTE` is for a limit: what a feature covers and where it
ends, phrased as what is.

## Words and punctuation

**American spelling.** Enroll, honor, behavior, organization.

**Acronyms in their standard casing** in prose: JWT, CSRF, HTTP, JSON, SMTP, HTML, SQL, URL.
Products as their owners write them: Valkey, Postgres. Code stays in backticks exactly as it is
written: `ValKeyDataSource`, `'jwt'`.

**No em dashes in prose.** Use a full stop, a colon or a comma. The one place an em dash stays is
the separator in a [See also](#see-also) list.

**No `<br>`.** A blank line starts a paragraph.

**"Such as" or "for example"**, not "eg." or "e.g.".

# A page

Every page has the same parts, in this order:

1. The frontmatter, with the [keywords](#keywords) the search finds it by
2. `# Title`: the topic, in the reader's words
3. The intro paragraph
4. `## Key exports`
5. The sections, one per task, starting with setting it up when there is anything to set up
6. `## Requirements`, when a default implementation stands on another package or stores rows in an
   entity of the framework
7. `## See also`

## Keywords

```md
---
keywords: [2fa, mfa, otp, one time password, authenticator app]
---
```

**The words a reader searches with that the title does not use**: other names for the topic, its
abbreviations, the standards and products it covers. The search finds a page by its title and the
headings of its sections already, and by other forms of their words, such as `logs` for "Logging".
A keyword is lowercase. One that YAML reads as a number is quoted: `'429'`.

## The intro

**First what it is, then what it enables.** It is a paragraph that opens the page, so it reads as
an opening and not as a dictionary entry. Explain a domain term the reader may not know here.

No scenario openers ("At some point you will probably stumble across…"), no "This page explains…".

## Key exports

```md
| Export | Kind | Purpose |
|---|---|---|
| `PasskeyAuthenticator` | class | Logs users in with a passkey, and links passkeys to them |
| `PasskeyOptions` | type | Where passkeys are used, via `ZIBRI_DI_TOKENS.PASSKEY_OPTIONS`. Required |
| `PasskeyCleanupCronJob` | cron job | Deletes the challenges and tickets that expired. Registered for you |
```

**Every name from `zibri` that an example uses is in the table of the page that owns it.** A page
using `inject` in passing does not list it again; `di.md` does. The style test checks that every
imported name is in the table of at least one page.

**What a reader starts with comes first**: the decorator, class or service the page is about, and what setting it up
takes. The site shows the first 8 rows of a table longer than 12, so those are the ones a reader sees. The options,
errors and types a signature reaches follow.

**Kind** is one of: class, interface, type, entity, decorator, function, constant, enum, error,
cron job, DI token. Two names that belong together share a row ("interface, class").

**Purpose** says what the export does for the reader, starting with a verb or a noun ("Signs users
in", "A passkey of a user"). Not "This class…". The same endings mean the same thing on every
page:

| Ending | Means |
|---|---|
| `Required` | It has no default, and the application needs it |
| `Defaults to …` | What it is when you do not provide it |
| `Registered for you` | Nothing to add to the application options |
| `Replaceable through ZIBRI_DI_TOKENS.X` | Provide your own implementation under that token |

## Sections

**Headings name the task, as a gerund, in sentence case**: "Logging in", "Adding a passkey to an
account", "Restricting the devices". They are `##` directly under the page, with no "Usage"
section around them.

**Headings are stable.** Other pages and assistants link to their anchors. Renaming one means
fixing every link to it. The style test checks that every link between pages names a page and a
heading that exist.

**Link a concept to the page that owns it** where it first comes up, with a relative link and the
anchor: `[recent login](./two-factor.md#accepting-a-recent-login-instead)`.

## Option tables

```md
| Option | What it is |
|---|---|
| `relyingPartyId` | The domain passkeys are bound to. A passkey works on this domain and its subdomains |
| `challengeExpiresInMs` | How long a device may take to answer. 5 minutes by default |
```

Each row ends with its default ("5 minutes by default") or with "Required". Durations are written
in words, not milliseconds.

## Choosing between tools

**When the reader has to pick, give them a table:**

```md
| Use | When |
|---|---|
| [`upsert`](./data-source.md#…) | One value is read and written back |
| [`withLease`](./leases.md#taking-a-lease) | Only one instance may do a piece of work |
```

If the table leaves the reader with more questions than they had before, add a short description
or an example below it.

## Requirements

```md
## Requirements
| Package | Used for |
|---|---|
| `@simplewebauthn/server` | Checking what the browser answers. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Passkey`, `PasskeyChallenge` | `PasskeyAuthenticator` or `PasskeyTwoFactorMethod` is registered |
| `PasskeyRegistrationTicket` | `PasskeyAuthenticator` is registered |
```

**What the default implementation of the feature needs, in the same place on every page**, so a
reader planning a deployment finds it and one who does not care skips it.

**The packages it stands on.** Mark a package the reader installs with "You install it". Nothing
about how the package is used inside.

**The entities it stores rows in**, which the reader adds to the `entities` of their data source.
"Needed when" names what makes the feature need it, such as a registered class or an option, or
"Every application". What the entity is goes in Key exports; this table says only when it is
needed. An entity two features need is listed on both pages.

## See also

```md
## See also
- [Auth](./auth.md) — strategies and authenticators
- [Two factor](./two-factor.md) — the second factor on operations
```

The pages a reader of this one goes to next, each with what they find there.

# Code examples

**Every block compiles.** `packages/zibri/src/application/docs-examples.test.ts` type-checks each
page.

**Every block stands on its own.** It imports exactly what it uses and nothing else, so a reader or
an assistant copying one block gets code that works. The same test checks each block's imports.
What another block of the page declares is imported from the file that block names, like any other
file of the reader's.

**A file of the reader's that the page does not show holds the running example.** The test checks a
name imported from one, such as `User` from `../models`, against
`packages/zibri/src/application/__testing__/docs-reader-project.ts`. When a page needs a name that
file does not declare, add it there, typed the way `zi new` writes it.

**The first line names the file**: `// src/providers.ts`. Browser code says so:
`// src/login.ts, in the browser`.

**A comment in an example marks what the reader changes** (`// your own domain`). It never explains
why and never offers an alternative. Say that in the sentence before or after the block.

**Examples follow `CODE_STYLE.md`**, typed locals included. Readers copy them.

**Names are realistic.** Never `Foo`, `Test` or `MyService`. Where it is natural, draw them from the
running example, a task tracker for teams:

| Name | What it is |
|---|---|
| Tenant | A team. Its rows are its projects, tasks and comments |
| `User` | Someone who logs in. Ada, `ada@example.com` |
| `Project` | Holds the tasks of a team |
| `Task` | Belongs to a project, assigned to a user |
| `Comment` | Written by a user on a task |

Domains are `example.com`, with `app.example.com` for the frontend and `api.example.com` for the
application. A topic with a domain of its own, such as invoices for documents, keeps it.

# Pages and folders

**One topic per page.** When two pages start carrying content that belongs to a third, write the
third and link to it.

**Split a page by reader task.** When a section is something a reader does on a different day
(relations, transactions, migrations), it is a page of its own. There is no line limit.

**Related pages share a folder**, such as `docs/auth/` for the login pages.

**Anything worth documenting is documented in the same change**, or written down as a TODO.

# The FAQ

`docs/faq.md` holds the decisions that span many pages: why every entity has a tenant, why an
application has to choose its default auth. It is the one page where "why" is the content.

**Each entry is a question as a reader would ask it**, answered in a short paragraph that links
to the page that owns the topic. A page that would otherwise explain the decision links to the
entry instead.
