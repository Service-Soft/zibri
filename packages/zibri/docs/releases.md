---
keywords: [versions, changelog, semver, support, lts, release cycle]
---

# Releases
`zibri`, `zibri-tsx`, `zibri-tsx-compiler`, `zibri-mdx`, `zibri-testing` and `zibri-cli` are released together, at one version, and follow [semantic versioning](https://semver.org). Install them at the same version.

## What is public
The public API is what you can import from a package's entry points:

| Package | Entry points |
|---|---|
| `zibri` | `zibri`, `zibri/webpack`, `zibri/tsconfig.application.json` |
| `zibri-testing` | `zibri-testing`, `zibri-testing/jest-config`, `zibri-testing/jest-preset` |
| `zibri-tsx` | `zibri-tsx`, `zibri-tsx/email`, `zibri-tsx/jsx-runtime`, and `zibri-tsx/compiler`, `zibri-tsx/webpack`, `zibri-tsx/jest`, which are deprecated |
| `zibri-tsx-compiler` | `zibri-tsx-compiler`, `zibri-tsx-compiler/webpack`, `zibri-tsx-compiler/jest` |
| `zibri-mdx` | `zibri-mdx` |
| `zibri-cli` | the `zi` commands and their arguments |

Files inside a package can only be reached through these entry points.

`zibri/internal` holds what the other Zibri packages use from `zibri`. Any release can change it.

`zibri-tsx/internal` holds what the templates `zibri-tsx-compiler` compiles call while they render and in the page,
and what the other Zibri packages use from `zibri-tsx`: `createServerRuntime`, the `RenderServerRuntime` type with
the registries and markers it holds, the sources of the client script, such as `CLIENT_HOOK_SOURCES`, and what the
email components are built from, such as `defineEmailComponent`. Any release can change it, along with the code the
compiler emits.

## What a version number tells you
| Release | Contains |
|---|---|
| Patch, such as `3.0.1` | Fixes |
| Minor, such as `3.1.0` | New features and deprecations. Existing code keeps compiling and behaving the same |
| Major, such as `4.0.0` | Breaking changes: a removed or renamed export, a changed signature or default, a newly required option, a higher node version |

An export that has a replacement is marked `@deprecated` in at least one minor before a major removes it. Your editor shows it struck through, and its documentation names the replacement.

## Which versions get fixes
Fixes, security fixes included, are released for the newest major only. To get them, upgrade to it.

## npm tags
| Tag | Installs |
|---|---|
| `latest` | The newest release |
| `next` | The newest prerelease, such as `4.0.0-rc.1` |

## Finding what changed
[CHANGELOG.md](https://github.com/Service-Soft/zibri/blob/release/CHANGELOG.md) lists every release. Each major has an upgrade guide with what to change in your code:

- [Upgrading to 3](./upgrading-to-3.md)

## See also
- [Upgrading to 3](./upgrading-to-3.md) — what to change in your code for 3.0.0
- [Getting started](./getting-started.md#upgrading-a-project) — bringing a project to what a new version generates, with `zi upgrade`
- [Versioning](./endpoints/versioning.md) — the version of your own application, and what it decides
