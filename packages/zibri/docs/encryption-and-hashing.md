# Encryption & Hashing
Encryption and hashing of entity properties can be easily defined via the `@Property.string` decorator.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Property.string` | decorator | Marks a string property for encryption/hashing (among other things) |
| `HashString` | type | Type of a hashed property's value |
| `Sha256HashStrategy` | class | Unsalted hash for values that must stay findable. Never for passwords |
| `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS` | DI token | The key that encrypts the encryption keys. No default, required for any encryption |
| `EncryptionStrategyInterface` | interface | What an encryption algorithm implements, including a kms or hsm backed one |
| `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` | DI token | Injects the encryption service for manual encryption |
| `ZIBRI_DI_TOKENS.HASH_SERVICE` | DI token | Injects the hash service for manual hashing |
| `ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES` | DI token | Overrides the available encryption algorithms |
| `ZIBRI_DI_TOKENS.HASH_STRATEGIES` | DI token | Overrides the available hash algorithms |

## Usage
### Defining encrypted/hashed properties
```ts
// src/models/secret.model.ts
import { AesGcmEncryptionStrategy, BaseEncryptOptions, BaseEntity, defineProvider, EncryptionKey, EncryptionKeyStatus, EncryptionServiceInterface, EncryptionString, EncryptionStrategyInterface, Entity, HashServiceInterface, HashString, OmitClass, Property, Repository, ScryptCost, Sha256HashStrategy, ZIBRI_DI_TOKENS } from 'zibri';

@Entity()
export class Secret extends BaseEntity {
    // Alternatively you can also provide an options object to encryption instead of the boolean flag.
    @Property.string({ encryption: true })
    encryptedValue!: string;

    // Alternatively you can also provide an options object to hash instead of the boolean flag.
    @Property.string({ hash: true })
    hashedValue!: HashString;
}
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

### Where an encrypted value is allowed to be
Encryption protects a value that was *read*. On its own it does nothing about a value that was
**moved**: everything needed to decrypt lives in the stored value, so anyone who gains a write to the
database — a sql injection, an over-permissive admin screen, an import that trusts its input — can
copy one row's encrypted column into another row, and the application will decrypt it and serve it to
whoever owns that row.

So an encrypted value is bound to the row it was written to. The row id goes inside the
authentication tag, and a value that turns up anywhere else refuses to decrypt at all. This is on by
default and needs nothing from you.

What it costs is bulk writes. A bound value has to be encrypted for the row it lands in, so one
statement carrying one value to every matching row is exactly the thing the binding forbids.
`updateAll` reads the rows it matched, encrypts a value per row, and writes them in a single call —
the same primitive bulk creation uses — saying so in the log above a hundred rows. So the cost is one
extra read plus work proportional to how many rows matched.

That read widens a window that was always open: a row inserted while the update runs is not included.
Neither is one inserted while a plain update statement runs, at the isolation level either of them
gets by default — what changes is the length of the window, from one statement to a read plus a
write. If you need the two to be one thing, hand in a transaction and choose its isolation level;
both halves run inside it.

Turn the binding off for a property where that trade is the wrong way round:

```ts
@Entity()
export class SharedSecret extends BaseEntity {
    @Property.string({ encryption: { bindToRow: false } })
    sharedSecret!: string;
}
```

Such a value can be written in bulk and can move between rows. It is still bound to the envelope it
was written with, so its key id and strategy cannot be edited underneath it.

**Renaming a table or a column is safe**, because the binding names neither — only the row. That is a
deliberate trade rather than an omission: naming the column would also stop a value being moved into
a *different encrypted column of the same row*, but those are the same operation as far as the
encryption can tell. A value that stays in its row and is read under another column name is either an
attack or a rename, and no rule can allow one and refuse the other. Renames are the far more common
of the two, and a rule that broke them would do so silently, at the next read.

The other thing to plan for is a data migration that rewrites rows under **new ids** — it has to
decrypt and re-encrypt as it goes, as it would for any row-scoped protection.

A value stored without a binding decrypts as it stands, and gains one the next time its row is
written.

### Rotating a key
Keys are retired rather than swapped. Make a new one the default, deprecate the old one, and the
values written under it get rewritten in the background:

```ts
export async function rotateKey(encryptionService: EncryptionServiceInterface, oldKeyId: string): Promise<void> {
    const replacement: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
        status: EncryptionKeyStatus.ACTIVE
    });
    await encryptionService.markKeyAsDefaultForStrategy(replacement.id, AesGcmEncryptionStrategy);
    await encryptionService.deprecateKey(oldKeyId);
}
```

`EncryptionRotationCronJob` is registered for you and does the rewriting — hourly, on one instance,
at most a few hundred rows per run so a large table is not one long write storm. It reads rows as
they are stored to find the ones still under a retired key, reads those back as values, and hands
them to their repository, which re-encrypts them under the current key. There is no separate notion
of "encrypted correctly" hiding in the job.

It also picks up values written before binding existed and binds them, so
[binding](#where-an-encrypted-value-is-allowed-to-be) reaches data that was already in the database
rather than only new writes.

Once the job has nothing left to do, the old key can be deleted. Deprecating the *default* key is
refused — something has to be the key new values are written with.

### Reading a value as it is stored
Every read decrypts by default. Pass `autoDecrypt: false` to get the values exactly as they sit in the
data source instead:

```ts
export async function readAsStored(secretRepository: Repository<Secret>): Promise<Secret[]> {
    return await secretRepository.findAll({ autoDecrypt: false });
    // "aes-256-gcm.v1.<keyId>.b.<iv>.<tag>.<ciphertext>"
}
```

What that buys you is the envelope — which strategy and key a value was written with, and whether it
is bound to its row — none of which survives decryption. It is how you ask whether a value is still
stored the way it should be, rather than only what it says.

Two things to keep in mind: the properties come back as encryption strings, so anything treating them
as plain values will be wrong about them, and writing one back through a repository encrypts it
again — ciphertext and all. Excluded properties are still removed, because who may see a value is not
a question about how it happens to be stored.

### Decryption
When using the `@Property` decorator, encrypted values are automatically decrypted when read from the datasource. This can be configured when using the options object instead of the simple boolean flag. This configuration is pretty flexible with a callback, it allows for example to decrypt based on the current users role. So you could specify that Admins are allowed to decrypt, but normal Users aren't.

Alternatively and if sufficient for your use case, the [exclude functionality](./excluding-properties.md) can be used for this as well or in addition.

### Hashing a value you still need to find

A salted hash cannot be searched for: hashing the same input twice gives two different hashes, so
`where: { token: hash(presented) }` matches nothing. That is fine for a password, which is checked
against a row you already found by email — but not for a token that *is* the lookup key. A refresh
token or a password reset token arrives on its own, with nothing else in the request to find its row
by.

`Sha256HashStrategy` exists for exactly that case. It is unsalted, so the same value always produces
the same hash and the column stays searchable:

```ts
@Entity()
export class ApiToken extends BaseEntity {
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy } })
    value!: HashString;
}

// finding one: hash what the caller presented, exactly as it is stored
export async function findToken(
    hashService: HashServiceInterface,
    tokenRepository: Repository<ApiToken>,
    presented: string
): Promise<ApiToken | undefined> {
    const value: HashString = await hashService.hash(presented, { strategy: Sha256HashStrategy });
    return await tokenRepository.findOne({ where: { value }, required: false });
}
```

> **Never use it for a password, or anything else short enough to guess.** scrypt and bcrypt are slow
> and salted because their input is guessable; neither property buys anything against a value like
> `randomBytes(16)`, where there is nothing to enumerate. Against a password both are exactly what is
> missing. The strategy declares `deterministic: true`, and the hash service refuses to use a
> deterministic strategy as the default — so registering it cannot silently change how passwords are
> stored — but nothing stops a property asking for it by name.

The builtin password reset and JWT refresh tokens are stored this way, which is why a leaked database
copy contains no token that can be replayed against the api.

### Manual encryption/hashing
To manually encrypt or hash a value Zibri provides the `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` and `ZIBRI_DI_TOKENS.HASH_SERVICE` injection tokens.

## Configuration
By default scrypt and aes-256-gcm are used, with `Sha256HashStrategy` also registered so a property can ask for it by name. If you want a different algorithm, override `ZIBRI_DI_TOKENS.HASH_STRATEGIES` and/or `ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES`.

Whatever you register, one of the hash strategies has to be non-deterministic: that is the one an
unqualified `hash: true` uses, which in practice means every stored password. A list containing only
deterministic strategies is refused at the first hash rather than quietly used.

### The master key
**Encryption needs `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS`**, which has no default — the service
throws without it. That includes the builtin TOTP second factor, whose secret is an encrypted
property, so an application using it has to configure this before anyone can enroll:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
    useValue: {
        currentMasterStrategy: new AesGcmEncryptionStrategy(),
        currentMasterKey: { id: 'k1', value: process.env['MASTER_KEY'] }
    }
})
```

Nothing in the database is encrypted with this key. Data keys are generated per strategy, stored in
the key table, and it is *those* that the master key encrypts — so the master key is what a stolen
database dump does not contain, and rotating it rewrites a handful of key rows rather than every
encrypted column.

Old master keys and strategies go in `oldMasterKeys` and `oldMasterStrategies`, which is what makes
replacing one possible: key rows written under the old key still decrypt, and get rewritten under
the current one.

#### Keeping the key material off the host
`currentMasterKey.value` is typed by the strategy, not by the framework — `EncryptionStrategyInterface<TKey>`
puts `TKey` in the caller's hands and every method that touches it may be async. So `value` does not
have to be key material at all. A strategy whose `TKey` is a key handle and whose `encrypt`/`decrypt`
call out to a KMS, an HSM or Vault fits without changing anything:

```ts
import { BaseDecryptOptions } from 'zibri';

import { callKms, createKeyInKms } from './kms-client';

type KmsKeyHandle = { arn: string };

class KmsEncryptionStrategy implements EncryptionStrategyInterface<KmsKeyHandle> {
    readonly name: string = 'kms';
    readonly version: string = 'v1';

    async encrypt(value: string, options: BaseEncryptOptions<KmsKeyHandle>): Promise<EncryptionString> {
        // options.key is the handle. The plaintext leaves the process, the key never enters it
        return await callKms('encrypt', options.key, value);
    }

    async decrypt(value: EncryptionString, options: BaseDecryptOptions<KmsKeyHandle>): Promise<string> {
        return await callKms('decrypt', options.key, value);
    }

    isBoundToRow(value: EncryptionString): boolean {
        return value.split('.')[3] === 'b';
    }

    async generateRandomKey(): Promise<KmsKeyHandle> {
        return { arn: await createKeyInKms() };
    }

    serializeKey(key: KmsKeyHandle): Buffer {
        return Buffer.from(key.arn, 'utf8');
    }

    deserializeKey(raw: Buffer): KmsKeyHandle {
        return { arn: raw.toString('utf8') };
    }
}
```

Used as the **master** strategy this is textbook envelope encryption: the data key is generated
locally, handed to the service to wrap, and the wrap is the only call that crosses the network — once
per key, not once per value. Used as a *data* strategy every read and write becomes a network call,
which is almost never what you want.

Two things a remote strategy has to get right, because nothing checks them for you: `encrypt` has to
put `options.keyId` in the envelope it returns, and it has to honour `options.binding` or the
[row binding](#where-an-encrypted-value-is-allowed-to-be) silently stops applying to values it
writes. Zibri ships no such strategy — that would mean depending on one vendor's sdk — so this is a
seam rather than a feature.

### What a password hash costs
scrypt ships at `n=131072, r=8, p=1` — the parameters current guidance asks for. That is roughly
**128MB of memory and a few hundred milliseconds per hash**, and both scale with `n`. Memory is the
one to size for: it is per concurrent hash, so a burst of logins is a burst of allocations.

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.SCRYPT_COST,
    useFactory: (): ScryptCost => ({ n: 65536, r: 8, p: 1 })
})
```

**Raising or lowering it does not invalidate stored hashes.** Each hash records the cost it was made
at and is verified with that, so a change only applies to hashes written afterwards.

**Existing accounts upgrade as they sign in.** A successful login is the only moment the plaintext
exists, so that is where `needsRehash` is checked and the stored hash replaced. Users who never sign
in keep their old hash — a cost change is not a migration, it is a floor for everything new plus a
gradual upgrade of everything active.

The same applies to retiring a whole strategy: marking one `DEPRECATED` in the hash strategy table
makes `needsRehash` return true for every hash it produced, and those accounts move to the current
default strategy on their next login.

### Writing to a hashed property
A hashed property takes **plaintext only**. Writing a value that is already a hash is refused:

```ts
export async function rewritePassword(credentialsRepository: Repository<Credentials>, id: string): Promise<void> {
    const stored: Credentials = await credentialsRepository.findById(id);
    await credentialsRepository.updateById(id, { password: stored.password }); // throws
}
```

That is what a read-modify-write does — load an entity, hand it back — and hashing a hash cannot be
undone. The value it would replace is the only thing that could ever verify the password again, so
the write is refused rather than silently locking the account out. Leave the property off the update,
or set it to a new plaintext.

## See also
- [Excluding properties](./excluding-properties.md) — an alternative/addition to decryption for controlling who can read a value
- [Dependency injection](./di.md) — overriding the strategy tokens via the providers array
