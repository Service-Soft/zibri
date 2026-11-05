# sandbox

The application this repository develops Zibri against. It is two things:

- **What `zi new` generates.** The scaffold's parity suite compares every file `zi new` writes with
  the file of the same path here, so a change to one shows up as a difference in the other.
- **A place to click through features.** Controllers, pages and providers that show a feature
  working against a real Postgres and Valkey.

It is not an example of how to build an application with Zibri. It keeps its schema with
`synchronize` instead of migrations, answers every route without a login by default
(`defaultAuth: 'public'`), and puts its demonstrations side by side rather than in the layers of a
domain. For how an application is put together, read the pages in
[packages/zibri/docs](../zibri/docs), starting with
[getting started](../zibri/docs/getting-started.md).
