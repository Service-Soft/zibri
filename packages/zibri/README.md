<p align="center">
    <img src="https://raw.githubusercontent.com/Service-Soft/zibri/release/logo.jpg" alt="Zibri" height=100>
</p>
<h1 align="center">Zibri</h1>

![NPM Version](https://img.shields.io/npm/v/zibri)
![NPM Last Update](https://img.shields.io/npm/last-update/zibri)
![NPM License](https://img.shields.io/npm/l/zibri)
[![codecov](https://codecov.io/gh/Service-Soft/zibri/graph/badge.svg)](https://codecov.io/gh/Service-Soft/zibri)

Zibri is an opinionated typescript backend framework based on express. It's heavily inspired by frameworks like [LoopBack](https://loopback.io/doc/en/lb4/index.html) and [Nest](https://docs.nestjs.com/).

What differentiates it from such frameworks can be found in our [goals section](#-goals).

# 🚀 Quick start
Requires Node.js >= 24.

```sh
npm i -g zibri-cli
zi new
```

Go into your freshly generated project, run `npm start` and enjoy your new api!

See the [getting started guide](https://service-soft.github.io/zibri/) for more details.

# 📑 Documentation
The official documentation of Zibri can be found under [https://service-soft.github.io/zibri](https://service-soft.github.io/zibri)

For an AI assistant, [llms.txt](https://service-soft.github.io/zibri/llms.txt) indexes every page, and [llms-full.txt](https://service-soft.github.io/zibri/llms-full.txt) holds them all.

# 🏆 Goals
## 🔋 Batteries included
Zibri aims to be an ***actual*** batteries included framework. 

Meaning if you need something like an email service it's already there. 

And, in contrast to most other node backend frameworks:<br>
Such a service is not just the most basic implementation, but one with built in templating, queuing support for thousands of mails, the option to save mails in a data source, priority handling etc.

Due to it's dependency injection system you can always swap things out if they are not required or you need even more configuration options. But there will most likely always be a reasonable default you can rely on.

### 🧩 Features
- default jwt auth strategy with advanced features like automatic reuse detection ([docs](https://service-soft.github.io/zibri/auth/auth/))
- builtin ORM with transaction and migration support ([docs](https://service-soft.github.io/zibri/data/data-source/))
- controller based route definition, including websocket controllers ([docs](https://service-soft.github.io/zibri/endpoints/creating-endpoints/), [websocket docs](https://service-soft.github.io/zibri/endpoints/websocket/))
- OmitClass, PickClass, PartialClass, IntersectionClass helpers to extend from and easily build new entity or even controller classes ([docs](https://service-soft.github.io/zibri/endpoints/creating-endpoints/))
- automatic open api generation ([docs](https://service-soft.github.io/zibri/endpoints/creating-endpoints/))
- body parsers for json, xml, form-data and form-url-encoded ([docs](https://service-soft.github.io/zibri/endpoints/creating-endpoints/))
- automatic model based validation ([docs](https://service-soft.github.io/zibri/endpoints/validation/))
- cron job service out of the box ([docs](https://service-soft.github.io/zibri/background-work/cron/))
- email service out of the box, with templating, mail queue, persistence and priority handling ([docs](https://service-soft.github.io/zibri/templates/email/))
- multithreading service with builtin support for worker files or function ([docs](https://service-soft.github.io/zibri/background-work/multithreading/))
- change sets and soft delete functionality ([docs](https://service-soft.github.io/zibri/data/data-source/))
- backup architecture builtin ([docs](https://service-soft.github.io/zibri/data/backup/))
- a http client for speaking to external APIs that actually validates responses ([docs](https://service-soft.github.io/zibri/endpoints/http-client/))
- durable event system that even survives restarts ([docs](https://service-soft.github.io/zibri/background-work/events/))
- encryption and hashing of entity properties simply as configurable flags on the `@Property.string` decorator ([docs](https://service-soft.github.io/zibri/data/encryption-and-hashing/))
- highly customizable caching system with multi tier and decorator support ([docs](https://service-soft.github.io/zibri/data/caching/))
- rate limiting with interchangeable algorithms and reservation support ([docs](https://service-soft.github.io/zibri/endpoints/rate-limiting/))
- localization based on the XLIFF standard, automatically extracting marked parts of your code on startup ([docs](https://service-soft.github.io/zibri/templates/localization/))
- api versioning tracked in your version control, wired into both migrations and endpoint resolution. Never oversee a regression again. ([docs](https://service-soft.github.io/zibri/endpoints/versioning/))

### 🔌 Plugins
Some common concerns that are less technical and more use case specific can be bundled as plugins. Since these are just providers, controllers, cron jobs, body parsers and auth strategies bundled together, you can write and reuse your own really easily ([docs](https://service-soft.github.io/zibri/application/plugin/)).

Zibri also provides some plugins out of the box, for things like:
- invoicing, including XRechnung/Peppol e-invoicing ([docs](https://service-soft.github.io/zibri/plugins/invoicing-plugin/))
- mailing-lists ([docs](https://service-soft.github.io/zibri/plugins/mailing-list-plugin/))
- payments ([docs](https://service-soft.github.io/zibri/plugins/payment-plugin/))

## ✨ Ease of use
Zibri aims to be as easy to use as possible, with reasonable defaults and by the use of decorators and dependency injection.

All developer facing classes/functions try to provide the strongest type safety possible.

At the same time we try to reduce boiler plate as much as possible. An example of this would be the way we handle entity properties.
Instead of having multiple decorators for open-api, ORM and validation (like Nest does it for example), we bundled those into one decorator used for everything instead.

## 🛡️ Robustness
### 🧱 Strong foundation
With Zibri you can rely on a strong foundation of battle tested libraries that have all been configured to be as fast and robust as possible:
- express as the server
- pg for talking to Postgres
- nodemailer for sending emails
- handlebars and/or tsx for templating
- @fastify/busboy for file uploads
- socket.io for websockets
- node-cron for cron jobs

### 🧪 Extensive Test Suite
We have more than 2500 tests running in our pipeline and strive to be as close to a production environment as possible. This includes:
- initializing actual zibri servers with real database testcontainers
- working with real files for everything related to the file system
- mocking the least amount of things possible

### 🪖 Making "shooting your foot" as hard as possible
All the public facing classes, interfaces and functions are as strictly typed as possible. Zibri even includes a custom parser for handlebar files, that automatically infers the type of the data that is needed to render the template.

In addition to that, you will get warnings whenever there is something off. Like an endpoint that is marked to skip auth, although there isn't anything auth related to skip for it.

Fixing these warnings will keep your code base cleaner and less prone to errors in the future.

### 🛟 Making "shooting your foot" the most pleasant experience
Zibri gives you useful errors, stack traces and debug logs.

It includes source maps and handles even complex cases like giving you the specifics on *why* a dependency injection failed.

In a lot of cases it also directly gives you a possible fix.

# 🤝 Contributing
Contributions are welcome! See [CONTRIBUTING.md](../../CONTRIBUTING.md) for how to get started.

# 📄 License
Zibri is [MIT licensed](./LICENSE).
