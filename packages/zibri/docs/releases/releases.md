---
keywords: [versions, changelog, semver, support, lts, release cycle]
---

# Releases
`zibri`, `zibri-contract`, `zibri-tsx`, `zibri-tsx-compiler`, `zibri-mdx`, `zibri-testing` and `zibri-cli` are released together, at one version, and follow [semantic versioning](https://semver.org). Install them at the same version.

## What is public
The public API is what you can import from a package's entry points:

| Package | Entry points |
|---|---|
| `zibri` | `zibri`, `zibri/webpack`, `zibri/tsconfig.application.json` |
| `zibri-contract` | `zibri-contract` |
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
[CHANGELOG.md](./CHANGELOG.md) lists every release. Each major has an upgrade guide with what to change in your code:

- [Upgrading to 3](./upgrading-to-3.md)

## Upgrading your project
Run `zi upgrade` in your project with the cli of the release you upgrade to:

```sh
npm i -g zibri-cli@latest
zi upgrade
```

This will update all packages and install every package a new project gets that
yours does not have, and brings each file `zi new` generated to what that release generates:

- a file you never changed is replaced.
- a file you changed is merged with what the release changed, the way git merges a branch. Where you
  both changed the same lines, the file has conflict markers for you to resolve.
- a file you deleted stays deleted.

`zibri-scaffold.json` records what was generated. The merge reads that version back out of your git
history, or generates it again with `npx zibri-cli@<recorded release> generate`. Commit before you
upgrade, and commit the result. A file whose generated version is found in neither keeps your content,
with the release's version beside it as `<file>.zibri-upgrade` to compare.

`zi upgrade github` or `zi upgrade none` changes which continuous integration workflow the project has.

The build, the jest configuration and the compiler options come from the packages themselves:
`webpack.config.js` calls `resolveWebpackConfiguration` of `zibri/webpack`, `jest.config.mjs` names the
`zibri-testing` preset, and `tsconfig.json` extends `zibri/tsconfig.application.json`. Updating the
packages updates them.

## See also
- [Upgrading to 3](./upgrading-to-3.md) — what to change in your code for 3.0.0
- [Versioning](../endpoints/versioning.md) — the version of your own application, and what it decides
