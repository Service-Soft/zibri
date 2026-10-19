# Encryption & Hashing
Encryption and hashing of entity properties can be easily defined via the `@Property.string` decorator.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Property.string` | decorator | Marks a string property for encryption/hashing (among other things) |
| `HashString` | type | Type of a hashed property's value |
| `ScryptHashStrategy` | class | The default hash, for passwords and everything else guessable |
| `Sha256HashStrategy` | class | Unsalted hash for values that must stay findable. Never for passwords |
| `BcryptHashStrategy` | class | Deprecated. Verifies the password hashes of zibri 2.x, see [bcrypt](#bcrypt) |
| `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS` | DI token | The key that encrypts the encryption keys. No default, required by the default encryption service |
| `EncryptionStrategyInterface` | interface | What an encryption algorithm implements, including a kms or hsm backed one |
| `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` | DI token | Injects the encryption service for manual encryption |
| `ZIBRI_DI_TOKENS.HASH_SERVICE` | DI token | Injects the hash service for manual hashing |
| `ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES` | DI token | Overrides the available encryption algorithms |
| `ZIBRI_DI_TOKENS.HASH_STRATEGIES` | DI token | Overrides the available hash algorithms |
| `EncryptionRotationProgress` | entity | How far the rotation job is through the stored values |
| `EncryptionRotationFailure` | entity | A row the rotation job could not rewrite, and when it tries again |

## Usage
### Defining encrypted/hashed properties
```ts
// src/models/secret.model.ts
import { AesGcmEncryptionStrategy, BaseEncryptOptions, BaseEntity, defineProvider, EncryptionKey, EncryptionKeyStatus, EncryptionServiceInterface, EncryptionString, EncryptionStrategyInterface, Entity, HashServiceInterface, HashString, OmitClass, Property, Repository, RetiredKeyUsage, ScryptCost, Sha256HashStrategy, ZIBRI_DI_TOKENS } from 'zibri';

@Entity()
export class Secret extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    // Alternatively you can also provide an options object to encryption instead of the boolean flag.
    @Property.string({ encryption: true })
    encryptedValue!: string;

    // Alternatively you can also provide an options object to hash instead of the boolean flag.
    @Property.string({ hash: true })
    hashedValue!: HashString;
}
```

This will encrypt/hash any values that are stored in a data source via a repository. The same flags work on the string items of an array and on a string shape of `@Property.oneOf`, and each shape can name a strategy of its own.

A property holding an encrypted or hashed value stays out of change sets unless it declares `excludeFromChangeSets: false`.

### Create data typing
A hashed property is typed as `HashString` on the entity (a branded type), but a plain `string` is what you actually pass in when creating one. The branding only exists after the value has been hashed.

Encryption does not have this problem, as the value might be automatically decrypted there, so the typing is always string.

You can solve this inconsistency by defining a separate create-data class and override the hashed property back to type `string`:

```ts
@Entity({ tenant: 'shared' })
export class Credentials extends BaseEntity {
    @Property.string({ hash: true })
    password!: HashString;
}

export class CredentialsCreateData extends OmitClass(Credentials, ['id', 'password']) {
    @Property.string({ hash: true })
    password!: string;
}
```

See `PasswordCredentials`/`PasswordCredentialsCreateData` in the auth module for a real example of this split.

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
    @Property.string({ format: 'uuid' })
    tenantId!: string;

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

The job reads the stored values in passes. A pass starts when a key or strategy is retired that the
last finished pass did not look for, and once on every instance after it started. Each run continues
the pass where the last one stopped, and `EncryptionRotationProgress` holds how far it got. With
nothing retired, a run reads no stored values at all.

A row it cannot rewrite is recorded as an `EncryptionRotationFailure`, with the error, and logged once.
The job tries it again an hour later, then after a wait that doubles with every failure, up to a day.
The record is removed once the row is rewritten or deleted.

Both entities belong in the data source that holds `EncryptionKey`, and the application refuses to
start without them.

Once the job has nothing left to do, the old key can be deleted. Deprecating the *default* key is
refused — something has to be the key new values are written with.

### Telling when a rotation is done
`resolveRetiredKeyUsage()` counts what is still encrypted under every key being retired: the stored
values under each deprecated data key, and the data keys and recorded backups that need each entry of
`oldMasterKeys` and `oldMasterStrategies`:

```ts
export async function findUnusedRetiredKeyIds(encryptionService: EncryptionServiceInterface): Promise<string[]> {
    const usage: RetiredKeyUsage = await encryptionService.resolveRetiredKeyUsage();
    return usage.dataKeys.filter(k => k.values === 0).map(k => k.keyId);
}
```

Each retired data key also names its `stuckRows`: the rows the rotation job could not rewrite, with
the error and when it tries again. A key with stuck rows still encrypts their values.

It counts what the framework stores: the values of the encrypted properties your models declare, the
data keys, and the backups recorded in the database. A value you encrypt yourself with `encrypt`, or
one in a column no model declares any more, is not counted, and the rotation job does not rewrite it
either. Rotating those is up to you.

A backup that holds the data source the data keys are stored in brings its data keys back when it is
restored, so it counts towards the master keys they were encrypted under, whether or not the backup
itself is encrypted. A backup that does not hold that data source needs its data keys to still exist,
so it counts towards every data key there was when it was taken. Each backup records which keys it
needs when it is taken, in `masterKeys` and `dataKeyIds`.

The count reads every row of every entity holding an encrypted property, as one full pass of the
rotation job does, so call it when you mean to retire something.

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
    @Property.string({ format: 'uuid' })
    tenantId!: string;

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

`unique` on a hashed property needs a deterministic strategy too. A salted hash of one value is
stored differently every time, so a unique declaration on it rejects nothing: the application refuses
to start with one, and an entity whose hash is a function chosen per row is refused where it is
declared.

`unique` on an encrypted property is refused where it is declared. One value is stored differently
under each key it is encrypted with, so after a key rotation the declaration could not reject it.

### Manual encryption/hashing
To manually encrypt or hash a value Zibri provides the `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` and `ZIBRI_DI_TOKENS.HASH_SERVICE` injection tokens.

## Configuration
By default scrypt and aes-256-gcm are used, with `Sha256HashStrategy` also registered so a property can ask for it by name. If you want a different algorithm, override `ZIBRI_DI_TOKENS.HASH_STRATEGIES` and/or `ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES`.

Whatever you register, one of the hash strategies has to be non-deterministic: that is the one an
unqualified `hash: true` uses, which in practice means every stored password. A list containing only
deterministic strategies is refused at the first hash rather than quietly used.

### The master key
**The default encryption service needs `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS`**, which has no
default. It starts with every application, whether or not anything is encrypted, and refuses to start
without it:

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
encrypted column. The keys of [encrypted backups](./backup.md#encrypting-backups) are encrypted with
it as well.

Old master keys and strategies go in `oldMasterKeys` and `oldMasterStrategies`, which is what makes
replacing one possible: key rows written under the old key still decrypt, and get rewritten under
the current one. A backup taken under an old key is restored with it, so keep an old key listed for
as long as you keep backups taken under it. [`resolveRetiredKeyUsage()`](#telling-when-a-rotation-is-done)
counts both.

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
    readonly usableInMigrations: boolean = true;

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

`usableInMigrations` says whether a strategy works while [migrations](./data-source.md#handling-migrations) run, which is before the application is initialized. Set it to `false` when what it calls is set up by a provider during initialization. A migration that encrypts or decrypts with such a strategy is refused, and the error names the strategy.

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

### bcrypt
`BcryptHashStrategy` verifies the password hashes zibri 2.x wrote, and is deprecated. It hashes with
10 rounds and does its work on the main thread, where scrypt runs on the thread pool, so every bcrypt
hash a login checks holds up the requests around it. Keep it registered while stored hashes need it,
with bcrypt marked `DEPRECATED` in the hash strategy table: each of its hashes is replaced with a scrypt
hash the next time its user signs in. The [upgrade migration](./upgrading-to-3.md#the-migration) does
both.

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
