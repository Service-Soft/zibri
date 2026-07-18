# Assets
Zibri offers a simple way to serve static files.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `AssetServiceInterface` | interface | Serves files from your project's `assets/public` folder |
| `ZIBRI_DI_TOKENS.ASSET_SERVICE` | DI token | Injects `AssetServiceInterface` |

## Usage
### Serving assets
Anything you put under your projects assets/public folder will served under `/assets/{asset-name-with-file-ending}` (With the default configuration).

### File explorer
For documentation purposes there is also a simple "file explorer" page provided by Zibri under `/assets` when not specifying an asset, that can also be reached from the root page:

![Zibri's builtin assets file explorer](./assets-explorer.png)

## See also
- [Templating](./templating.md) — referencing assets (eg. scripts, icons) from rendered pages
