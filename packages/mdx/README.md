# Zibri MDX

Builds the `.md` and `.mdx` page templates of [Zibri](https://github.com/Service-Soft/zibri) applications. It
reads the markdown, highlights the code blocks and hands `zibri-tsx` a template it compiles like any `.tsx` one. It
also renders markdown an application gets while it runs, such as from a database, with the same components.

```bash
npm i -D zibri-mdx
```

A devDependency for the templates: it runs while the application is built and tested, and a deployment carries none
of it. The `pages` feature of `zi new` installs it for you. An application rendering markdown at runtime lists it in
its `dependencies` instead.

The full documentation is at
[service-soft.github.io/zibri/templates/templating](https://service-soft.github.io/zibri/templates/templating/#writing-a-page-in-markdown).
