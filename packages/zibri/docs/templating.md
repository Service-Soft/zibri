# Templating
HTML pages and emails are rendered from `.tsx` templates, which the `zibri-tsx` compiler compiles at
build time. Pages and emails differ in the components you use and in how you render them.

For string templates, [Handlebars](#rendering-a-handlebars-template) is available as an alternative.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `TsxUtilities` | class | Renders a tsx page (`renderPage`) or email (`renderEmail`) to html |
| `HtmlResponse` | class | Wraps rendered html to be returned from a controller |
| `TsxComponent` | type | Type of a page component rendered by `TsxUtilities.renderPage` |
| `TsxEmailComponent` | type | Type of an email component rendered by `TsxUtilities.renderEmail` |
| `Mjml`, `MjHead`, `MjTitle`, `MjPreview`, `MjStyle`, `MjAttributes`, `MjBody` | function | The document of an email and its head (see [rendering an email](#rendering-an-email)) |
| `MjWrapper`, `MjSection`, `MjColumn`, `MjGroup` | function | The layout of an email |
| `MjText`, `MjButton`, `MjImage`, `MjDivider`, `MjSpacer`, `MjRaw` | function | The content of an email |
| `onClient`, `onServer`, `$t`, `$ts`, `$f` | function | The template hooks (see [running code in the browser](#running-code-in-the-browser)) |

## Rendering a page
A page is a `TsxComponent`. Render it from a controller with `TsxUtilities.renderPage`:

```ts
// src/controllers/page.controller.ts
import { Controller, Get, GlobalRegistry, HtmlResponse, TsxUtilities, Response } from 'zibri';

import { HomePage } from '../templates/pages/home';

@Controller('/')
export class PageController {

    @Response.html()
    @Get()
    index(): HtmlResponse {
        const html: string = TsxUtilities.renderPage(
            HomePage,
            { appName: GlobalRegistry.getAppData('name') ?? '' }
        );
        return HtmlResponse.fromString(html);
    }
}
```

And the `HomePage` component definition:

```tsx
// src/templates/pages/home.tsx
import { TsxComponent } from 'zibri';

import { BasePage } from '../components/base-page';
import { Card } from '../components/card';
import { Heading } from '../components/heading';
import { Link } from '../components/link';

type HomePageProps = {
    appName: string
};

export const HomePage: TsxComponent<HomePageProps> = ({ appName }) => {
    return (
        <BasePage title='' activeRoute='/' className="flex flex-col gap-4 py-8">
            <Heading className="text-center">{appName}</Heading>
            <div className="max-w-fit mx-auto grid grid-cols-2 gap-4">
                <Card className="flex flex-col gap-2 max-w-80">
                    <Link href="/assets" icon="/assets/assets.svg">
                        Assets
                    </Link>
                    <p>
                        Lists all publicly registered assets.
                    </p>
                </Card>
                <Card className="flex flex-col gap-2 max-w-80">
                    <Link href="/explorer" icon="/assets/open-api/swagger.png">
                        OpenAPI Explorer
                    </Link>
                    <p>
                        The official OpenAPI/Swagger documentation.
                    </p>
                </Card>
            </div>
        </BasePage>
    );
};
```

A template file is an ordinary module. Next to its components it can declare constants, helper
functions, contexts and further components, exported or not, and all of them are available while
rendering. JSX and the render hooks (`useContext`, `provideContext`, `$raw`) are written inside a
component: a function named in PascalCase that returns JSX (`ZTSX010`).

Any TypeScript syntax works in a template, inside components as well as around them: classes, enums,
generators, getters, every kind of loop. The compiled server module and client script target ES2022,
which Node and current browsers run. Newer syntax, such as decorators and `using`, is compiled down to
it.

Every value a template writes is escaped, text and attribute values alike, whatever shape it has. Only
`$raw` writes html as it is. An attribute whose name starts with `on`, or holds anything but letters,
digits and `_ : . -`, is left out. So is a `javascript:` url in an attribute that takes a url, such as
`href` or `src`. Behavior in the browser goes through `onClick={...}` and the hooks in
[running code in the browser](#running-code-in-the-browser).

Pages fit server rendered pages with some behavior in the browser. For a client application with state
of its own, build a separate frontend that calls your API.

## Rendering an email
Emails are built from the MJML component set: typed tsx components that produce the responsive,
Outlook-safe structure [MJML](https://mjml.io/) produces. An email is a `TsxEmailComponent`, rendered
with `TsxUtilities.renderEmail`:

```tsx
// src/templates/emails/password-reset.tsx
import { $ts, Mjml, MjHead, MjTitle, MjBody, MjSection, MjColumn, MjText, MjButton, TsxEmailComponent } from 'zibri';

type PasswordResetEmailProps = {
    user: { name: string },
    confirmPasswordResetLink: string
};

export const PasswordResetEmail: TsxEmailComponent<PasswordResetEmailProps> = ({ user, confirmPasswordResetLink }) => {
    return (
        <Mjml>
            <MjHead>
                <MjTitle>{$ts`Password Reset`}</MjTitle>
            </MjHead>
            <MjBody>
                <MjSection>
                    <MjColumn>
                        <MjText>{$ts`Hello ${user.name},`}</MjText>
                        <MjButton href={confirmPasswordResetLink}>{$ts`Reset Password`}</MjButton>
                    </MjColumn>
                </MjSection>
            </MjBody>
        </Mjml>
    );
};
```

```ts
// src/services/password-reset-email.service.ts
import { TsxUtilities } from 'zibri';

import { PasswordResetEmail } from '../templates/emails/password-reset';

export function renderPasswordResetEmail(): string {
    return TsxUtilities.renderEmail(PasswordResetEmail, {
        user: { name: 'Ada' },
        confirmPasswordResetLink: 'https://app.example.com/confirm-password-reset/3f9a1c'
    });
}
```

The html is what you queue as a mail, see [queueing an email](./email.md#queueing-an-email).

The available components mirror MJML's:

| Group | Components |
|---|---|
| Document | `Mjml`, `MjHead` (`MjTitle`, `MjPreview`, `MjStyle`, `MjAttributes`), `MjBody` |
| Layout | `MjWrapper`, `MjSection`, `MjColumn`, `MjGroup` |
| Content | `MjText`, `MjButton`, `MjImage`, `MjDivider`, `MjSpacer`, `MjRaw` |

### Nesting is checked at compile time
MJML has rules about what goes inside what. A column belongs in a section, and raw html belongs in an
`MjText` or `MjRaw`. These rules are checked when your templates compile, and a template that breaks
one fails the build:

```
emails/welcome.tsx:4:9 ZTSX004 '<div>' is not a valid child of 'MjColumn'.
    Valid children of 'MjColumn' are: MjText, MjButton, MjImage, MjDivider, MjSpacer, MjRaw.
```

A user component of your own (say a `BaseEmailHeader` that returns some sections) is treated as an
opaque wrapper: its use site is fine, and its own contents are checked in its own file.

### Emails have no client side
An email is static html, without a script. Client code in an email template (an `onClient` block, an
event handler, or a `?client` import) is a compile error (`ZTSX005`). For behavior in the browser, use
a [page](#rendering-a-page).

## Running code in the browser
A page can run code in the browser. The server rendered html carries script tags with that code.

What reaches the browser is what a component receives as a prop, and the globals of a `?client`
import. Imports are not carried over. A secret in a file a template imports stays on the server, even
when the template uses another value of that file, such as `environment.apiUrl`. Client code that
references an ordinary import is a compile error (`ZTSX003`). So is client code that loads a module
with `import(...)` or reads `import.meta` (`ZTSX008`): the client script is part of the page, and has
no imports.

Each name in client code is resolved to the declaration it refers to, and the script carries exactly
the declarations and props client code reads, including those nested in `if` blocks, loops and
multi-variable declarations. A local, parameter or loop variable inside client code is its own
variable, whatever else in the component shares its name.

Client code reads from a closed set of names. Besides the component's own declarations and props, it
can read:
- the browser's globals (`document`, `window`, `fetch`, `JSON`, ...)
- the globals a `?client` import provides
- globals the page provides and the template declares, such as `declare const gtag: (...args: unknown[]) => void;`
- the hooks listed below

Any other name is a compile error (`ZTSX009`). That includes a declaration of the template outside the
component: the markup can render it, and client code declares or receives what it needs itself. The
generated client script is checked a second time on its own, against the same set of names.

A prop or loop value that client code reads is written into the page as the fields client code reads
from it, followed through aliases, destructuring, loops and array callbacks like `map` and `find`. A
value client code uses whole (passes on, spreads, stringifies) is written whole. Give client code only
the values it needs.

Client code has these hooks, and no others:
- `onClient`
- `onServer`
- `$t`
- `$ts`
- `$f`

React's hooks, such as `useState`, are not among them.

The metrics page uses these in full. It imports `chart.js?client`. Code at the top level of a template
runs on the server and in the browser alike. Code inside `onClient` runs only in the browser, such as
code reading `window`, which the server does not have:

```tsx
// src/templates/pages/metrics.tsx
import { Chart } from 'chart.js?client';

import { MetricsSnapshot, onClient } from 'zibri';

// ...
Chart.defaults.color = 'whitesmoke';
Chart.defaults.borderColor = 'whitesmoke';
Chart.defaults.scale.grid.color = 'rgba(200, 200, 200, 0.3)';

let snaps: MetricsSnapshot[] = [];
let automaticReload: boolean = true;

onClient(() => {
    window.addEventListener('load', () => {
        void loadSnapshots();
        setInterval(() => void loadSnapshots(), 1000);
    });
});

async function loadSnapshots(): Promise<void> {
    if (!automaticReload) {
        return;
    }
    try {
        const resp: Response = await fetch('/metrics');
        snaps = await resp.json();
        document.dispatchEvent(new CustomEvent('metrics:update', { detail: { snaps } }));
    }
    catch (error) {
        console.error('failed to load metrics', error);
    }
}
//...
```

The `?client` suffix makes a package available in the browser. The build writes it to
`assets/public/vendor/chart.js.js`, and the rendered html loads it with a script tag. The browser runs
the same version of the package as the server.

To use a package in the browser, also add an entry for it to `tsx.d.ts`.

The component the page renders. An event handler such as `onReloadChange` runs in the browser:

```tsx
// src/templates/pages/metrics.tsx
import { TsxComponent } from 'zibri';

import { BasePage } from '../components/base-page';
import { NetworkChart, RequestDurationChart, RequestsPerSecondChart, ResourceUsageChart } from '../components/charts';
import { Heading } from '../components/heading';
import { MetricsStatus } from '../components/metrics-status';

type MetricsPageProps = {
    version: string,
    primary: string,
    secondary: string
};

export const MetricsPage: TsxComponent<MetricsPageProps> = ({ version, primary, secondary }) => <BasePage
    title='Metrics'
    activeRoute='/metrics/dashboard'
    scripts={['/assets/lib/chartjs-adapter-date-fns.js']}
    className="flex flex-col gap-4 py-8"
>
    <Heading className="text-center">Metrics</Heading>
    <div className="w-full px-10 flex flex-col gap-5">
        <div className="grid grid-cols-5 gap-5">
            <div className="col-span-2 flex flex-col gap-5">
                <MetricsStatus
                    automaticReloadChecked={automaticReload}
                    onReloadChange={() => automaticReload = !automaticReload}
                    version={version}
                    className="flex-1"
                >
                </MetricsStatus>
                <RequestDurationChart className="flex-1" secondary={secondary}></RequestDurationChart>
            </div>
            <RequestsPerSecondChart secondary={secondary} className="col-span-3"></RequestsPerSecondChart>
        </div>
        <div className="grid grid-cols-2 gap-5">
            <ResourceUsageChart primary={primary} secondary={secondary}></ResourceUsageChart>
            <NetworkChart primary={primary} secondary={secondary}></NetworkChart>
        </div>
    </div>
</BasePage>;
```

## Rendering a Handlebars template
[Handlebars](https://handlebarsjs.com/) renders string templates:

```ts
// src/services/password-reset-handlebars-email.service.ts
import renderBaseEmail from '../templates/emails/base-email.hbs';
import renderPasswordResetTemplate from '../templates/emails/password-reset.hbs';
export function renderPasswordResetHandlebarsEmail(): string {
    const content: string = renderPasswordResetTemplate({
        confirmPasswordResetUrl: 'https://app.example.com/confirm-password-reset',
        resetToken: '3f9a1c',
        user: { name: 'Ada' }
    });
    return renderBaseEmail({
        content,
        base: {
            title: 'Password Reset',
            baseUrl: 'https://api.example.com'
        }
    });
}
```

A `.hbs` import is a function, typed after its template. Before every build, `npm start` included, a
type definition is written for each template, with every variable the template uses. A variable is
one of:
- `string`
- `string[]`
- an object whose values are `string`, `string[]` or another such object

When you add or remove a variable while `npm start` runs, the type follows.

> [!NOTE]
> The types are written by the build. When TypeScript does not know a property of a template, run a
> build.

## Requirements
| Package | Used for |
|---|---|
| `zibri-tsx` | Compiling the `.tsx` templates |
| `handlebars` | Rendering `.hbs` templates. You install it |

## See also
- [Email](./email.md) — queueing a rendered email
- [Localization](./localization.md) — the strings `$t` and `$ts` translate
- [Assets](./assets.md) — the files a page loads, such as scripts and icons
- [Metrics](./metrics.md) — the metrics dashboard page shown above as an example of tsx templating with client-side hooks
