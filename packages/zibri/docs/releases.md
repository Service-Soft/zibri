# Releases
`zibri`, `zibri-tsx`, `zibri-testing` and `zibri-cli` are released together, at one version, and follow [semantic versioning](https://semver.org). Install them at the same version.

## What is public
The public API is what you can import from a package's entry points:

| Package | Entry points |
|---|---|
| `zibri` | `zibri` |
| `zibri-testing` | `zibri-testing` |
| `zibri-tsx` | `zibri-tsx`, `zibri-tsx/compiler`, `zibri-tsx/webpack`, `zibri-tsx/jest`, `zibri-tsx/email`, `zibri-tsx/jsx-runtime` |
| `zibri-cli` | the `zi` commands and their arguments |

Files inside a package can only be reached through these entry points.

## What a version number tells you
| Release | Contains |
|---|---|
| Patch, eg. `3.0.1` | Fixes |
| Minor, eg. `3.1.0` | New features and deprecations. Existing code keeps compiling and behaving the same |
| Major, eg. `4.0.0` | Breaking changes: a removed or renamed export, a changed signature or default, a newly required option, a higher node version |

An export that has a replacement is marked `@deprecated` in at least one minor before a major removes it. Your editor shows it struck through, and its documentation names the replacement.

## Which versions get fixes
Fixes, security fixes included, are released for the newest major only. To get them, upgrade to it.

## npm tags
| Tag | Installs |
|---|---|
| `latest` | The newest release |
| `next` | The newest prerelease, eg. `4.0.0-rc.1` |

## Finding what changed
[CHANGELOG.md](https://github.com/Service-Soft/zibri/blob/release/CHANGELOG.md) lists every release. Each major has an upgrade guide with what to change in your code:

- [Upgrading to 3](./upgrading-to-3.md)
