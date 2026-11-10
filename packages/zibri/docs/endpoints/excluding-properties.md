---
keywords: [hide fields, exclude, omit, response fields, sensitive fields]
---

# Excluding properties
An excluded property stays on the server. Your code reads it like any other property, and it is left out wherever the object is serialized: in an HTTP response, a websocket message or a log. Mark a password hash or another secret this way.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Property` | decorator | Defines an entity property; accepts an `exclude` option |

## Marking a property as excluded
Set `exclude: true` on the property:

```ts
// src/models/user.model.ts
import { BaseEntity, Entity, HashString, Property } from 'zibri';

@Entity({ tenant: 'shared' })
export class User extends BaseEntity {
    @Property.string({ password: true, exclude: true })
    password!: HashString;
}
```

Instead of `true`, `exclude` takes a function of the object and the request context, which returns whether to exclude the property. It can, for example, exclude the password hash for every role but admins.

## Reading an excluded property on the server
An entity read through a repository still holds its excluded properties. They are not enumerable, so `JSON.stringify` and everything else that serializes the object leaves them out.

A login endpoint reads the password hash to compare it with what the user sent. When it returns the user afterwards, the response has no password.

## See also
- [Models](../data/models.md) — the `@Property` decorators the `exclude` option belongs to
- [Creating endpoints](./creating-endpoints.md) — how `@Property` decorated classes are used for request/response validation
- [Encryption and hashing](../data/encryption-and-hashing.md) — hashing values like the `password` example above