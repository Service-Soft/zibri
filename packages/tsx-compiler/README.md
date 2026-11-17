# Zibri TSX Compiler

Compiles the `.tsx` page and email templates of [Zibri](https://github.com/Service-Soft/zibri) applications, and the
pages written in markdown, for `zibri-tsx`. It holds the webpack loader, the jest transform and the type check of the
templates.

```bash
npm i -D zibri-tsx-compiler
```

A devDependency: it runs while the application is built and tested, and a deployment carries neither it nor
TypeScript, which it compiles with. `zi new` installs it and sets up the build for you.

| Subpath | What it is |
|---|---|
| `zibri-tsx-compiler/webpack` | The loader of the templates, and its plugins |
| `zibri-tsx-compiler/jest` | The transform of the templates in tests |

The full documentation is at
[service-soft.github.io/zibri/templates/templating](https://service-soft.github.io/zibri/templates/templating/).
