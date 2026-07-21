<p align="center">
    <img src="https://raw.githubusercontent.com/Service-Soft/zibri/release/logo.jpg" alt="Zibri" height=100>
</p>
<h1 align="center">Zibri monorepo</h1>

This repository is an npm-workspaces monorepo. It currently contains:

- [packages/zibri](packages/zibri) — the Zibri framework itself. See its [README](packages/zibri/README.md) for what Zibri is and how to use it.
- [packages/sandbox](packages/sandbox) — a demo app used to manually exercise Zibri during development.

Development commands (`npm test`, `npm run test:coverage`, `npm start`, `npm run lint`) run from the repo root and are forwarded to whichever workspace packages define them.
