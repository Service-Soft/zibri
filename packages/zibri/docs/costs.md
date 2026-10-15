# Costs
What a repository call costs is how often it talks to the data source: a round trip is one statement on a sql database, or one request on a key value store. This page lists what each call takes, so you can tell what a loop, an endpoint or a job will cost before you run it.

## What holds on every data source
- **A call costs the same number of round trips however many rows it reads or writes.** `createAll` with a thousand rows takes as many as with one, and so do `updateAll`, `upsertAll` and `deleteAll` whatever they match.
- **`stream` reads in pages** of 500 rows, so it takes one more round trip for every page.
- **Relations are read once for the whole result**, not once per row. Asking for them adds a round trip or two to a call, whatever the number of rows.
- **`findAll` without a `take` refuses to answer with more than 10,000 rows.** `updateAll` and `deleteAll` asked to return the rows count them first and refuse the same way, before anything is written.
- **`deleteAll` reads every row it deletes**, because the delete hooks run for each entity. The rows are held in memory for as long as the call runs, so delete a very large set in parts.
- **Updating an encrypted property that is bound to its row reads the matching rows** and writes each its own value, since every row needs a value encrypted for it. Setting `bindToRow: false` on the property makes it one write again.
- **`count` and `exists` decrypt nothing**, and every row you receive is decrypted once. `deleteAll` decrypts every row it deletes, whether or not you asked for them back.

## Per data source
The round trips each call takes on the data sources zibri ships with. Measured on an entity with one unique property and a many to one relation, which is read only when the call asks for it.

| Call | Postgres | ValKey |
|---|---|---|
| `findById` | 1 | 1 |
| `findOne` | 1 | 2 |
| `findAll` | 1 | 2 |
| `findAll` with relations | 2 | 3 |
| `findAllPaginated` | 6 | 2 |
| `findAllAfter` | 6 | 2 |
| `stream` | 2 | 2 |
| `count` | 1 | 2 |
| `exists` | 1 | 2 |
| `create` | 4 | 7 |
| `create` with relations | 6 | 9 |
| `createAll` | 4 | 7 |
| `createAll` with relations | 5 | 9 |
| `createAll` on an entity declaring nothing unique | 4 | 3 |
| `updateById` | 2 | 7 |
| `updateById` with a condition | 2 | 8 |
| `updateById` with relations | 4 | 9 |
| `updateAll` | 1 | 8 |
| `updateAll` returning the rows | 5 | 11 |
| `upsert` | 1 | 9 |
| `upsertAll` | 1 | 9 |
| `deleteById` | 2 | 3 |
| `deleteAll` | 2 | 4 |
| `deleteAll` returning the rows | 3 | 6 |

On ValKey a filter that names neither the id, nor every property of a unique declaration, nor every property of an index group the entity declares, reads every row of the entity and is answered in your application, so its cost in memory and time grows with the table. An index group is named by plain values for each of its properties, or by a `oneOf` of plain values for a group of one; an index answers no leading part of itself here.

## See also
- [Data Sources](./data-source.md) — the repository calls this page lists
- [Encryption & Hashing](./encryption-and-hashing.md) — what `bindToRow` decides
- [Caching](./caching.md) — answering a repeated read without a round trip