# Contributing to Zibri
Thank you for considering to contribute to this project!

It is open for discussion to change anything regarding contributing, linting, workflow etc. at any point in time.

All development is done using github.

# Table of Contents
- [Contributing to Zibri](#contributing-to-zibri)
- [Table of Contents](#table-of-contents)
- [Create an issue](#create-an-issue)
  - [Special Notes for bugs](#special-notes-for-bugs)
- [Writing code](#writing-code)
- [Releasing](#releasing)
  - [npm tags](#npm-tags)
  - [Releasing a fix for an older major](#releasing-a-fix-for-an-older-major)
- [License](#license)

# Create an issue
If you want to ask a question, need a new feature, found gaps in the documentation, found a bug, found code that can be refactored etc. you first have to start with creating an Issue.

Please check if there already is an issue for your problem.

Right now there are no specific guidelines for Issues, other than that their name and description should include enough details so that everyone knows what the issue is about.

## Special Notes for bugs
Great Bug Reports tend to have:

- A quick summary
- Steps to reproduce (be specific and try to give sample code if possible)
- What you expected would happen
- What actually happens
- Additional info (eg. why you think this might be happening, or workarounds you tried that did/did not work)

# Writing code
Read [CODE_STYLE.md](./CODE_STYLE.md) before your first change. It covers the conventions this repository follows for file naming, types, comments, documentation and tests, and applies to every package here.

# Releasing
`zibri`, `zibri-tsx`, `zibri-testing` and `zibri-cli` are released together, at one version.

1. Run `npm run release:bump -- <version>`. It writes the version into all four packages, into the ranges they name each other by and into `package-lock.json`, and adds an empty section for it to the top of [CHANGELOG.md](./CHANGELOG.md).
2. Write what the release changes into that section. For a new major, also write `packages/zibri/docs/upgrading-to-<major>.md` and link it from the section.
3. Merge into `release`.

The release refuses to publish when the packages declare different versions or name each other at another one, when the registry or a tag already has the version, or when its changelog section is missing or empty. Once all four packages are published, it tags the commit `v<version>` and creates a GitHub release with that section as its notes.

What counts as a breaking change, and which majors get fixes, is in [releases.md](./packages/zibri/docs/releases.md).

## npm tags
Every release picks its npm tag from the versions already published:

| Release | npm tag | GitHub release | Docs site |
|---|---|---|---|
| Newer than every published version | `latest` | marked latest | updated |
| A fix for an older major | `latest-<major>` | not marked latest | unchanged |
| A prerelease, eg. `4.0.0-rc.1` | `next` | marked prerelease | unchanged |

A version below one already published in its own major is refused.

## Releasing a fix for an older major
Only the latest major gets fixes today. To release one for an older major:

1. Create `release-<major>` from its last tag, eg. `git switch -c release-3 v3.2.1`, and give it the same branch protection as `release`.
2. Branch off `release-<major>`, fix, and run `npm run release:bump -- <version>` there.
3. Merge into `release-<major>`, which releases like `release` does.
4. Add the same changelog section to `dev`, so the changelog on the latest major lists every release.

# License
By contributing to this project, you agree that your contributions will be licensed under its MIT License.