# Costs
What a repository call costs is how often it talks to the data source: a round trip is one statement on a sql database, or one request on a key value store. This page lists what each call takes, so you can tell what a loop, an endpoint or a job will cost before you run it.

## What holds on every data source
- **No call reads or writes one row at a time.** On Postgres, `createAll` with a thousand rows takes as many round trips as with one, and so do `updateAll`, `upsertAll` and `deleteAll` whatever they match. On ValKey, the round trips grow by a few for every 1,000 rows, see [below](#per-data-source).
- **`stream` reads in pages** of 500 rows, so it takes one more round trip for every page.
- **A `create` or `createAll` given its ids with `allowId` reads once first**, to refuse an id a stored row holds.
- **Relations are read once for the whole result**, not once per row. Asking for them adds at most a round trip or two to a call, whatever the number of rows.
- **A page and its total are read together.** A page that holds no rows, past the last page or after the last row of a walk, reads its total in one more round trip.
- **`findAll` without a `limit` refuses to answer with more than 10,000 rows**, or the `maxRowsWithoutLimit` of its data source. `updateAll` and `deleteAll` asked to return the rows refuse the same way with an `UnboundedReturnError`, before anything is written.
- **`deleteAll` reads only the ids of the rows it deletes**, unless it hands the rows to somebody: to you with `returnDeleted`, or to a [`beforeDelete`](./data-source.md#running-your-own-code-on-every-row) of your own, which runs for each deleted row. Then it reads every row and holds it in memory for as long as the call runs, so delete a very large set in parts.
- **Updating an encrypted property that is bound to its row reads the matching rows** and writes each its own value, since every row needs a value encrypted for it. Setting `bindToRow: false` on the property makes it one write again.
- **An `upsert` whose `onConflict` sets an encrypted property bound to its row writes that value in one more round trip** when the row was already there, since it is encrypted for that row. `bindToRow: false` makes it part of the single write again.
- **`count` and `exists` decrypt nothing**, and every row you receive is decrypted once. `deleteAll` decrypts the rows it reads, so only when it hands them to somebody.

## Per data source
The round trips each call takes on the data sources Zibri ships with. Measured on an entity with one unique property and a many to one relation, which is read only when the call asks for it.

| Call | Postgres | ValKey |
|---|---|---|
| `findById` | 1 | 1 |
| `findOne` | 1 | 1 |
| `findAll` | 1 | 1 |
| `findAll` with relations | 1 | 2 |
| `findAll` with a relation of a relation | 1 | 3 |
| `findAllPaginated` | 1 | 1 |
| `findAllPaginated` with relations | 1 | 2 |
| `findAllPaginated` with a relation of a relation | 1 | 3 |
| `findAllAfter` | 1 | 1 |
| `stream` | 2 | 1 |
| `stream` in an order | 2 | 1 |
| `count` | 1 | 1 |
| `exists` | 1 | 1 |
| `sum`, `average`, `minimum`, `maximum` | 1 | 1 |
| `count` per group | 1 | 1 |
| `create` | 1 | 3 |
| `create` with relations | 2 | 4 |
| `createAll` | 1 | 3 |
| `createAll` with relations | 2 | 4 |
| `createAll` on an entity declaring nothing unique | 1 | 2 |
| `updateById` | 2 | 4 |
| `updateById` with a condition | 2 | 4 |
| `updateById` with relations | 3 | 5 |
| `updateAll` | 1 | 4 |
| `updateAll` returning the rows | 4 | 4 |
| `upsert` | 1 | 5 |
| `upsertAll` | 1 | 5 |
| `deleteById` | 2 | 3 |
| `deleteById` with a condition | 2 | 3 |
| `deleteAll` | 1 | 3 |
| `deleteAll` returning the rows | 2 | 3 |

On ValKey, a filter reads every row of the entity and is answered in your application, unless it names the id, every property of a unique declaration, or every property of an index group the entity declares. Its cost in memory and time then grows with the table. A filter names an index group with a plain value for each of its properties, or with a `oneOf` of plain values for a group of one property. A filter naming only some properties of an index group reads every row.

On ValKey, a filter reads rows 1,000 at a time, or 500 at a time for a `stream`, and the first of them come in the same round trip as their ids. So every further 1,000 rows take one more round trip. These go out together, so a read of many rows waits about as long as a read of 1,000. The table shows a filter that reads at most 1,000 rows.

On ValKey, a write also locks and reads its rows 1,000 at a time, and takes the locks one group after the other. So its round trips grow with the rows it writes:

| Write | 1 row | 1,000 rows | 2,000 rows |
|---|---|---|---|
| `createAll` | 3 | 6 | 10 |
| `updateAll` | 4 | 5 | 8 |
| `upsertAll` | 5 | 6 | 10 |
| `deleteAll` | 3 | 4 | 5 |

On ValKey, a `stream` in an order that reads more than 500 rows reads them twice: once for what the order compares, which it holds for every matching row together with the id until the stream ends, and once to hand them out. Up to 500 rows are read once.

## What source maps cost
A bundled application started with `node --enable-source-maps` reads its source map once per process, the first time it logs an entry or formats a stack trace. Each instance pays this for itself. Measured on a bundle of 6 MB with the map of a deployment:

| What | Cost |
|---|---|
| Reading the map, which blocks the process | About 100 ms |
| The memory the map then keeps | About 60 MB |
| Every log entry a transport admits | About 1 µs more |

The first two grow with the bundle.

## See also
- [Data Sources](./data-source.md) — the repository calls this page lists
- [Logging](./logging.md) — what the source map is read for
- [Encryption & Hashing](./encryption-and-hashing.md) — what `bindToRow` decides
- [Caching](./caching.md) — answering a repeated read without a round trip