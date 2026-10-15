# Getting started
The following guide will walk you through setting up a new Zibri project.

## Requirements
Zibri runs on Node 24 and every maintained release after it, on Linux, macOS and Windows.

CI derives that list from Node's own release schedule, so a new Node release line is tested as soon
as it ships.

### Build toolchains
Zibri's decorators are TypeScript's `experimentalDecorators` ones, so a project turns that on in its
`tsconfig.json`. Every toolchain that compiles TypeScript implements them.

`emitDecoratorMetadata` is a separate option, and what it decides is how a constructor says what to
inject:

| Toolchain | `experimentalDecorators` | `emitDecoratorMetadata` |
|---|---|---|
| `tsc` | supported | supported |
| SWC | `jsc.transform.legacyDecorator` | `jsc.transform.decoratorMetadata` |
| esbuild, and Vite through it | supported | left to the second style below |
| Bun | supported | left to the second style below |

Where the metadata is written down, a constructor parameter is resolved from its declared type.
Naming the token says the same thing without it, and that is the style every toolchain builds:

```ts
import { Inject, Injectable } from 'zibri';

@Injectable()
class PdfService {}

// resolved from the declared type, which the metadata records
@Injectable()
class InvoiceService {
    constructor(private readonly pdf: PdfService) {}
}

// resolved from the token, which is written down in the code itself
@Injectable()
class ReceiptService {
    constructor(@Inject(PdfService) private readonly pdf: PdfService) {}
}
```

`zi new` writes a `tsconfig.json` with both options on, so a generated project uses either style. A
build that records no metadata names every token, and any parameter left untagged is refused while
the application starts, with the class and the position in the message.

A class that declares no constructor of its own is built with the one it inherits. Types are recorded
only for the constructor of a decorated class, so the class declaring that constructor is either
decorated or names its tokens with `@Inject`, and is otherwise refused the same way, naming both
classes. In a build that records no metadata, a class declaring a constructor that takes nothing is
refused too when its parent's constructor takes parameters.

One thing follows the metadata: a number property's declared type is checked against the `format` it
names as the class is declared, and that check reads what the build wrote down. The value itself is
checked against the format as it is stored, either way.

### Optional packages
Some features need a package that installing Zibri leaves out, so a deployment carries only what it
uses. Declaring the feature is what asks for the package, and the application says which one is
missing while it starts:

| Feature | Package |
|---|---|
| A postgres data source | `pg`, `pg-query-stream` |
| A valkey data source | `@valkey/valkey-glide` |
| Tracing, which the default tracer records, see [tracing](./tracing.md) | `@opentelemetry/api`, `@opentelemetry/sdk-trace-node` |
| Sending traces to a tracing backend with `otlpTraceExporter` | `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources` |
| The sftp backup transport, see [backup](./backup.md) | `ssh2` |
| `BcryptHashStrategy` | `bcryptjs` |
| A `regex` on a string property or parameter, see [models](./models.md) | `re2` |
| The otp two factor method, which ships as the default | `otpauth` |
| `JwtAuthStrategy`, which ships as the default auth strategy | `jose` |
| Sign-in through a provider, see [sign-in through a provider](./sign-in-through-a-provider.md) | `openid-client` |
| Sign-in through a SAML provider, see [SAML](./sign-in-through-a-provider.md#saml) | `@node-saml/node-saml` |
| Sign-in through a directory, see [sign-in through a directory](./sign-in-through-a-directory.md) | `ldapts` |
| Passkeys, see [passkeys](./passkeys.md) | `@simplewebauthn/server`, and `jose` when the devices are [restricted](./passkeys.md#restricting-the-devices) |
| Websocket controllers | `socket.io`, and `socket.io-parser`, which `socket.io` brings with it |
| A websocket adapter data source, for broadcasts across instances | `socket.io-adapter`, which `socket.io` brings with it |
| `PdfUtilities` and the invoicing plugin | `pdfmake` |
| The xml body parser, which ships as one of the default body parsers, translations, `XmlUtilities`, XRechnung and Peppol invoices | `saxes` |
| The form data body parser, which ships as one of the default body parsers, see [file uploads](./creating-endpoints.md#handling-file-uploads) | `@fastify/busboy` |
| Metrics, which the default metrics service collects, see [metrics](./metrics.md) | `prom-client`, `systeminformation` |
| Sending emails over smtp with `SmtpEmailTransport`, see [email](./email.md) | `nodemailer` |
| Generating entities from an OpenAPI document with `OpenApiFileProvider` or `OpenApiUrlProvider` | `swagger2openapi` |
| Handlebars templates | `handlebars` |
| TypeScript worker files, see [multithreading](./multithreading.md) | `ts-node` |
| Extracting source translations, see [localization](./localization.md) | `typescript`, `saxes` |

Install the ones you use, eg. `npm i socket.io`.

## Usage
### Install the cli
To setup new projects, we built [zibri-cli](https://github.com/service-soft/zibri-cli).

You can install it using:

```sh
npm i -g zibri-cli
```

### Create a new project

Now you should be able to run

```sh
zi new
```

and provide a name for your new project, and whether it gets a continuous integration workflow. Both
can be given on the command line instead, as `zi new <name> <github|none>`.

With `github`, the project gets `.github/workflows/ci.yml`, which installs, builds and tests it on
every pull request and every push to `main`. A checkout has no `.env`, so the workflow copies
`.env.example` and fills each blank secret with a value made for that run.

### Configuration

A generated project reads everything that differs between one machine and the next from the
environment: the port it listens on, the database it connects to, the secrets it signs tokens and
encrypts columns with, and the first administrator it creates.

Two files describe that:

- **`.env.example`** is the checked in list of every variable the project reads, with the secrets
  left blank. It is what tells a deployment - or the next person to clone the repository - what has
  to be set.
- **`.env`** holds the values, and is git ignored. `zi new` writes one with a freshly generated
  secret for each blank, so a new project runs as it stands.

`src/env.ts` is where they are read. `requireEnv` refuses to start the application when a variable
it names is unset, so a deployment missing one stops with the name of what is missing rather than
signing tokens with an empty string. `optionalEnv` is for the ones a project runs without, like the
mail server it has not chosen yet.

A deployment that sets its variables directly needs no `.env` at all: the file is loaded when it is
there and skipped when it is not.

### 🚀 Start up the application
You can now go into your freshly generated project, run `npm start` and enjoy your new api!

## See also
- [Architecture](./architecture.md) — how the pieces of an application fit together
- [Creating endpoints](./creating-endpoints.md) — build your first API endpoint
- [Dependency injection](./di.md) — how Zibri wires up services and providers