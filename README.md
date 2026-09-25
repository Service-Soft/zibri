<p align="center">
    <img src="https://raw.githubusercontent.com/Service-Soft/zibri/release/logo.jpg" alt="Zibri" height=100>
</p>
<h1 align="center">Zibri monorepo</h1>

This repository is an npm-workspaces monorepo. It currently contains:

- [packages/zibri](packages/zibri) — the Zibri framework itself. See its [README](packages/zibri/README.md) for what Zibri is and how to use it.
- [packages/cli](packages/cli) — the Zibri CLI (`zibri-cli`, binary `zi`), used to scaffold new Zibri projects. See its [README](packages/cli/README.md).
- [packages/tsx](packages/tsx) — a custom tsx dialect specific for server side html templating. Restores some client side functionality without hydration, so security leakages are impossible by design. See its [README](packages/tsx/README.md).
- [packages/testing](packages/testing) — `zibri-testing`, the harness Zibri tests itself with, published so an application can use the same one. See its [README](packages/testing/README.md).
- [packages/sandbox](packages/sandbox) — a demo app used to manually exercise Zibri during development.

Development commands (`npm test`, `npm run test:coverage`, `npm start`, `npm run lint`) run from the repo root and are forwarded to whichever workspace packages define them.
