<p align="center">
    <img src="https://raw.githubusercontent.com/Service-Soft/zibri/release/logo.jpg" alt="Zibri" height=100>
</p>
<h1 align="center">Zibri</h1>

![NPM Version](https://img.shields.io/npm/v/zibri)
![NPM Last Update](https://img.shields.io/npm/last-update/zibri)
![NPM License](https://img.shields.io/npm/l/zibri)
![CI](https://github.com/Service-Soft/zibri/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/Service-Soft/zibri/graph/badge.svg)](https://codecov.io/gh/Service-Soft/zibri)

Zibri is an opiniated typescript backend framework based on express. It's heavily inspired by frameworks like [LoopBack](https://loopback.io/doc/en/lb4/index.html) and [Nest](https://docs.nestjs.com/).

What differentiates it from such frameworks can be found in our [goals section](#-goals).

# 🚀 Quick start
Requires Node.js >= 22.

```sh
npm i -g zibri-cli
zi new
```

Go into your freshly generated project, run `npm start` and enjoy your new api!

See the [getting started guide](https://service-soft.github.io/zibri/documents/getting-started.html) for more details.

# 📑 Documentation
The official documentation of Zibri can be found under [https://service-soft.github.io/zibri](https://service-soft.github.io/zibri)

# 🏆 Goals
## 🔋 Batteries included
Zibri aims to be an ***actual*** batteries included framework. 

Meaning if you need something like an email service it's already there. 

And, in contrast to most other node backend frameworks:<br>
Such a service is not just the most basic implementation, but one with built in templating, queuing support for thousands of mails, the option to save mails in a data source, priority handling etc.

Due to it's dependency injection system you can always swap things out if they are not required or you need even more configuration options. But there will most likely always be a reasonable default you can rely on.

### 🧩 Features
- default jwt auth strategy with advanced features like automatic reuse detection ([docs](https://service-soft.github.io/zibri/documents/auth.html))
- builtin ORM with transaction and migration support ([docs](https://service-soft.github.io/zibri/documents/data-source.html))
- controller based route definition, including websocket controllers ([docs](https://service-soft.github.io/zibri/documents/creating-endpoints.html), [websocket docs](https://service-soft.github.io/zibri/documents/websocket.html))
- OmitClass, PickClass, PartialClass, IntersectionClass helpers to extend from and easily build new entity or even controller classes ([docs](https://service-soft.github.io/zibri/documents/creating-endpoints.html))
- automatic open api generation ([docs](https://service-soft.github.io/zibri/documents/creating-endpoints.html))
- body parsers for json and form-data ([docs](https://service-soft.github.io/zibri/documents/creating-endpoints.html))
- automatic model based validation ([docs](https://service-soft.github.io/zibri/documents/data-source.html))
- cron job service out of the box ([docs](https://service-soft.github.io/zibri/documents/cron.html))
- email service out of the box, with templating, mail queue, persistence and priority handling ([docs](https://service-soft.github.io/zibri/documents/email.html))
- multithreading service with builtin support for worker files or function ([docs](https://service-soft.github.io/zibri/documents/multithreading.html))
- change sets and soft delete functionality ([docs](https://service-soft.github.io/zibri/documents/data-source.html))
- backup architecture builtin ([docs](https://service-soft.github.io/zibri/documents/backup.html))
- a http client for speaking to external APIs that actually validates responses ([docs](https://service-soft.github.io/zibri/documents/http-client.html))
- durable event system that even survives restarts ([docs](https://service-soft.github.io/zibri/documents/events.html))
- encryption and hashing of entity properties simply as configurable flags on the `@Property.string` decorator ([docs](https://service-soft.github.io/zibri/documents/encryption-and-hashing.html))
- highly customizable caching system with multi tier and decorator support ([docs](https://service-soft.github.io/zibri/documents/caching.html))
- rate limiting with interchangeable algorithms and reservation support ([docs](https://service-soft.github.io/zibri/documents/rate-limiting.html))
- localization based on the XLIFF standard, automatically extracting marked parts of your code on startup ([docs](https://service-soft.github.io/zibri/documents/localization.html))
- api versioning tracked in your version control, wired into both migrations and endpoint resolution. Never oversee a regression again. ([docs](https://service-soft.github.io/zibri/documents/versioning.html))

### 🔌 Plugins
Some common concerns that are less technical and more use case specific can be bundled as plugins. Since these are just providers, controllers, cron jobs, body parsers and auth strategies bundled together, you can write and reuse your own really easily ([docs](https://service-soft.github.io/zibri/documents/plugin.html)).

Zibri also provides some plugins out of the box, for things like:
- invoicing, including XRechnung/Peppol e-invoicing ([docs](https://service-soft.github.io/zibri/documents/plugin.html#zibriinvoicingplugin))
- mailing-lists ([docs](https://service-soft.github.io/zibri/documents/plugin.html#zibrimailinglistplugin))
- payments ([docs](https://service-soft.github.io/zibri/documents/plugin.html#zibripaymentplugin))

## ✨ Ease of use
Zibri aims to be as easy to use as possible, with reasonable defaults and by the use of decorators and dependency injection.

All developer facing classes/functions try to provide the strongest type safety possible.

At the same time we try to reduce boiler plate as much as possible. An example of this would be the way we handle entity properties.
Instead of having multiple decorators for open-api, ORM and validation (like Nest does it for example), we bundled those into one decorator used for everything instead.

## 🛡️ Robustness
### 🧱 Strong foundation
With Zibri you can rely on a strong foundation of battle tested libraries that have all been configured to be as fast and robust as possible:
- express as the server
- typeorm for handling everything database related
- nodemailer for sending emails
- handlebars and/or preact for templating
- busboy for file uploads (the foundation of multer)
- socket.io for websockets
- node-cron for cron jobs

### 🧪 Extensive Test Suite
We have ~1600 tests running in our pipeline and strive to be as close to a production environment as possible. This includes:
- initializing actual zibri servers with real database testcontainers
- working with real files for everything related to the file system
- mocking the least amount of things possible

### 🪖 Making "shooting your foot" as hard as possible
All the public facing classes, interfaces and functions are as strictly typed as possible. Zibri even includes a custom parser for handlebar files, that automtically infers the type of the data that is needed to render the template.

In addition to that, you will get warnings whenever there is something off. Like an endpoint that is marked to skip auth, although there isn't anything auth related to skip for it.

Fixing these warnings will keep your code base cleaner and less prone to errors in the future.

### 🛟 Making "shooting your foot" the most pleasant experience
Zibri gives you useful errors, stack traces and debug logs.

It includes source maps and handles even complex cases like giving you the specifics on *why* a dependency injection failed.

In a lot of cases it also directly gives you a possible fix.

# 🤝 Contributing
Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get started.

# 📄 License
Zibri is [MIT licensed](./LICENSE).
