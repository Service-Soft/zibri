# Zibri CLI

The command line interface for [Zibri](https://github.com/Service-Soft/zibri). It creates a new
project, adds and removes features, and brings an existing project to what a newer release generates.

```bash
npm i -g zibri-cli
```

| Command | What it does |
|---|---|
| `zi new` | Creates a project. Asks for its name, its continuous integration workflow, what a route without `@Auth` requires, and its features |
| `zi add <features>` | Adds features to the project in this folder |
| `zi remove <features>` | Removes features from the project in this folder |
| `zi upgrade` | Brings the project in this folder to what this release generates, merging the files you changed |
| `zi version` | Shows the version of the cli |
| `zi help` | Lists the commands |

Every question of `zi new` can be answered on the command line instead:

```bash
zi new api github isLoggedIn pages,mailingList
```

The full documentation is at
[service-soft.github.io/zibri/documents/getting-started](https://service-soft.github.io/zibri/documents/getting-started.html).
