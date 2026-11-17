# Zibri Contract

The models a frontend shares with a [Zibri](https://github.com/Service-Soft/zibri) backend: the filter and the order of
a list, a page, the error body, what the auth routes answer and take, logs and change sets. Each is the model as it
arrives as json, so a date is the ISO string it is sent as. Types and the two enums they hold, `LogLevel` and
`ChangeSetType`, so it runs in a browser and a bundler leaves out what a page doesn't use.

```bash
npm i zibri-contract
```

zibri declares its own models against these: its enums are the ones of this package, and a check fails its build when
one of its models no longer arrives as the model here says.

## Filtering and ordering a list

A config declared once types both sides: the backend hands it to its `CrudController`, and the frontend builds the
query from it.

```ts
// src/task-list.config.ts, in a file the backend and the frontend share
import { FilterConfig, FilterValue, OrderConfig, OrderValue } from 'zibri-contract';

export type Task = {
    title: string,
    status: string,
    dueAt: Date,
    project: { name: string }
};

// eslint-disable-next-line typescript/typedef
export const taskFilter = { title: 'iLike', status: 'oneOf', dueAt: 'range', project: { name: 'equals' } } as const satisfies FilterConfig<Task>;

// eslint-disable-next-line typescript/typedef
export const taskOrder = { dueAt: true, title: true } as const satisfies OrderConfig<Task>;

export type TaskFilter = FilterValue<Task, typeof taskFilter>;

export type TaskOrder = OrderValue<Task, typeof taskOrder>;
```

`as const satisfies` keeps each match, so `TaskFilter` takes a text for `title`, a list for `status` and
`{ from, to }` for `dueAt`, and `TaskOrder` only the properties of `taskOrder`.

| Type | What it is |
|---|---|
| `FilterConfig` | How each property of a model filters a list: a match, or the config of the properties inside |
| `FilterValue`, `FilterRange` | The filter a list takes for a config, and the `from` and `to` of a range in it |
| `FilterMatch` | `StringFilterMatch`, `RangeFilterMatch`, `BooleanFilterMatch` or `ArrayFilterMatch`, by the type of the property |
| `OrderConfig` | The properties a list may be ordered by: `true`, or the config of the properties inside |
| `OrderValue`, `OrderDirection` | The order a list takes for a config, `'ASC'` or `'DESC'` by property |
| `PaginationResult` | A page of a list: its `items` and the `totalAmount` of all pages |

## The other models

| Models | What they are |
|---|---|
| `ErrorResponseBody`, `ValidationProblem` | What a refused or failed request is answered with, and the problems of the values it refused |
| `StoredFile` | A file your backend stored, like an attachment or a picture, with the url a browser loads it from. zibri hands you the upload, your routes answer with this once it is stored |
| `SecondFactorRequiredErrorBody`, `PasswordChangeRequiredErrorBody` | The error body of a login that waits for a second factor or a new password, with its ticket |
| `JwtAuthData`, `Jwt`, `CookieAuthData`, `CsrfToken`, `LogoutResult` | What a login, a refresh and a logout answer |
| `CurrentUserProfile`, `CurrentUserMembership`, `UserLogin`, `LinkedIdentity` | The logged in user, their tenants, where they are logged in and the identities linked to them |
| `TwoFactorRegistrations`, `OtpRegistration`, `OtpRegistrationConfirmData`, `RecoveryCodeRegistration`, `CodeRegistrationConfirmData`, `SmsRegistrationRequestData` | The enrollment of a second factor |
| `EmailConfirmation`, `PasswordResetTokenValidity`, `FederatedLinkIdentityStart`, `PasskeyTicketCredentials` | What following the link of an email, checking a password reset, linking a provider and creating a passkey answer |
| `Log`, `LogLevel`, `LogContext`, `LoggedError`, `LogRequestContext`, `LogCollapsedContext`, `CacheContext` | A log and where it comes from |
| `ChangeSet`, `ChangeSetType`, `Change`, `ChangeSetEntity`, `SoftDeleteEntity`, `ResetChangeSetResult` | The change sets of an entity, and what resetting one answers |

The full documentation is at
[service-soft.github.io/zibri](https://service-soft.github.io/zibri/endpoints/creating-endpoints/#filtering-and-ordering-a-list).