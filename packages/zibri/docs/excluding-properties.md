# Excluding properties
At some point in time you will probably stumble across the problem of having some sensitive data like eg. a password where you want to make sure that it will never leave the server in some form. Be it via http, websocket connection or inside of logs.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Property` | decorator | Defines an entity property; accepts an `exclude` option |

## Usage
### Marking a property as excluded
To support that use case, Zibri provides a exclude flag:

```ts
// Alternatively you can also provide an options object instead of the boolean flag.
@Property.string({ hash: true, exclude: true })
password!: HashString;
```

The configuration object that can be used instead of the boolean flag here is pretty flexible with a callback. It allows for example to exclude based on the current users role. So you could specify that for Admins the password hash is not excluded, but for normal Users it is.

### CAVEAT: What this actually does
Be aware that this does NOT remove the property as soon as the result comes back from your repository call. It simply marks them as not enumarable, which results in the property never showing up when things like JSON.stringify etc. are used.

This allows you to work with the value while it's still on the server. If you have a login endpoint for example, you can access the password hash to compare it to the user input. But if you return the current user data afterwards, the password is removed.

## See also
- [Creating endpoints](./creating-endpoints.md) — how `@Property` decorated classes are used for request/response validation
- [Encryption and hashing](./encryption-and-hashing.md) — hashing values like the `password` example above