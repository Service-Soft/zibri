<p align="center">
    <img src="https://raw.githubusercontent.com/Service-Soft/zibri/release/logo.jpg" alt="Zibri" height=100>
</p>
<h1 align="center">Zibri</h1>

![NPM Version](https://img.shields.io/npm/v/zibri)
![NPM Last Update](https://img.shields.io/npm/last-update/zibri)
![NPM License](https://img.shields.io/npm/l/zibri)

Zibri is an opiniated typescript backend framework based on express. It's heavily inspired by frameworks like [LoopBack](https://loopback.io/doc/en/lb4/index.html) and [Nest](https://docs.nestjs.com/).

What differentiates it from such frameworks can be found in our [goals section](#-goals).

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
- default jwt auth strategy with advanced features like automatic reuse detection
- builtin ORM with transaction and migration support
- controller based route definition, including websocket controllers
- OmitClass, PickClass, PartialClass, IntersectionClass helpers to extend from and easily build new entity or even controller classes
- automatic open api generation
- body parsers for json and form-data
- automatic model based validation
- cron job service out of the box
- email service out of the box, with templating, mail queue, persistence and priority handling
- multithreading service with builtin support for worker files or function
- change sets and soft delete functionality
- backup architecture builtin
- a http client for speaking to external APIs that actually validates responses

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
- handlebars and preact for templating
- busboy for file uploads (the foundation of multer)
- socket.io for websockets
- node-cron for cron jobs

### 🪖 Making "shooting your foot" as hard as possible
All the public facing classes, interfaces and functions are as strictly typed as possible. Zibri even includes a custom parser for handlebar files, that automtically infers the type of the data that is needed to render the template.

In addition to that, you will get warnings whenever there is something off. Like an endpoint that is marked to skip auth, although there isn't anything auth related to skip for it.

Fixing these warnings will keep your code base cleaner and less prone to errors in the future.

### 🛟 Making "shooting your foot" the most pleasant experience
Zibri gives you useful errors, stack traces and debug logs.

It includes source maps and handles even complex cases like giving you the specifics on *why* a dependency injection failed.

In a lot of cases it also directly gives you a possible fix.
