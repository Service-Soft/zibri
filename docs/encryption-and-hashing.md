# Encryption & Hashing
Encryption and hashing of entity properties can be easily defined via the `@Property.string` decorator:

```ts
// Alternatively you can also provide an options object to encryption instead of the boolean flag.
@Property.string({ encryption: true })
encryptedValue!: string;

// Alternatively you can also provide an options object to hash instead of the boolean flag.
@Property.string({ hash: true })
hashedValue!: HashString;
```

This will encrypt/hash any values that are stored in a data source via a repository.

## Decryption
When using the `@Property` decorator, encrypted values are automatically decrypted when read from the datasource. This can be configured when using the options object instead of the simple boolean flag. This configuration is pretty flexible with a callback, it allows for example to decrypt based on the current users role. So you could specify that Admins are allowed to decrypt, but normal Users aren't.

Alternatively and if sufficient for your use case, the [exclude functionality](./excluding-properties.md) can be used for this as well or in addition.

## Manual encryption/hashing
To manually encrypt or hash a value Zibri provides the `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` and `ZIBRI_DI_TOKENS.HASH_SERVICE` injection tokens, as well as `.HASH_STRATEGIES` and `ENCRYPTION_STRATEGIES` if you simply want a different algorithm. By default bcrypt and aes-256-gcm are used.