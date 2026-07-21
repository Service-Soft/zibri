# Encryption & Hashing
Encryption and hashing of entity properties can be easily defined via the `@Property.string` decorator.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Property.string` | decorator | Marks a string property for encryption/hashing (among other things) |
| `HashString` | type | Type of a hashed property's value |
| `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` | DI token | Injects the encryption service for manual encryption |
| `ZIBRI_DI_TOKENS.HASH_SERVICE` | DI token | Injects the hash service for manual hashing |
| `ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES` | DI token | Overrides the available encryption algorithms |
| `ZIBRI_DI_TOKENS.HASH_STRATEGIES` | DI token | Overrides the available hash algorithms |

## Usage
### Defining encrypted/hashed properties
```ts
// Alternatively you can also provide an options object to encryption instead of the boolean flag.
@Property.string({ encryption: true })
encryptedValue!: string;

// Alternatively you can also provide an options object to hash instead of the boolean flag.
@Property.string({ hash: true })
hashedValue!: HashString;
```

This will encrypt/hash any values that are stored in a data source via a repository.

### Create data typing
A hashed property is typed as `HashString` on the entity (a branded type), but a plain `string` is what you actually pass in when creating one. The branding only exists after the value has been hashed.

Encryption does not have this problem, as the value might be automatically decrypted there, so the typing is always string.

You can solve this inconsistency by defining a separate create-data class and override the hashed property back to type `string`:

```ts
@Entity()
export class Credentials extends BaseEntity {
    @Property.string({ hash: true })
    password!: HashString;
}

export class CredentialsCreateData extends OmitClass(Credentials, ['id', 'password']) {
    @Property.string({ hash: true })
    password!: string;
}
```

See `JwtCredentials`/`JwtCredentialsCreateData` in the auth module for a real example of this split.

### Decryption
When using the `@Property` decorator, encrypted values are automatically decrypted when read from the datasource. This can be configured when using the options object instead of the simple boolean flag. This configuration is pretty flexible with a callback, it allows for example to decrypt based on the current users role. So you could specify that Admins are allowed to decrypt, but normal Users aren't.

Alternatively and if sufficient for your use case, the [exclude functionality](./excluding-properties.md) can be used for this as well or in addition.

### Manual encryption/hashing
To manually encrypt or hash a value Zibri provides the `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` and `ZIBRI_DI_TOKENS.HASH_SERVICE` injection tokens.

## Configuration
By default scrypt and aes-256-gcm are used. If you want a different algorithm, override `ZIBRI_DI_TOKENS.HASH_STRATEGIES` and/or `ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES`.

## See also
- [Excluding properties](./excluding-properties.md) — an alternative/addition to decryption for controlling who can read a value
- [Dependency injection](./di.md) — overriding the strategy tokens via the providers array
