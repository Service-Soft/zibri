# Templating
Zibri renders both html pages and emails from `.tsx` templates, compiled at build time by Zibri's own
tsx compiler (`zibri-tsx`). The same compiler powers both; the difference is only which components you
use and how you render them.

Handlebars is still available as an [alternative](#alternative-handlebars) if you prefer string
templates.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `TsxUtilities` | class | Renders a tsx page (`renderPage`) or email (`renderEmail`) to html |
| `HtmlResponse` | class | Wraps rendered html to be returned from a controller |
| `TsxComponent` | type | Type of a page component rendered by `TsxUtilities.renderPage` |
| `TsxEmailComponent` | type | Type of an email component rendered by `TsxUtilities.renderEmail` |
| `Mjml`, `MjBody`, `MjSection`, `MjColumn`, `MjText`, … | components | The MJML email component set (see [Emails](#emails)) |
| `onClient`, `onServer`, `$t`, `$ts`, `$f` | hooks | The template hooks (see [Additional functionality](#additional-functionality)) |

## Usage
### Pages
A page is a `TsxComponent`. Render it from a controller with `TsxUtilities.renderPage`:

```ts
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
import { TsxComponent } from 'zibri';

import { BasePage } from '../components/base-page';
import { Card } from '../components/card';
import { Heading } from '../components/heading';
import { Link } from '../components/link';

type Props = {
    appName: string
};

export const HomePage: TsxComponent<Props> = ({ appName }) => {
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

This system is great for a server side framework to render some basic pages. If you have more advanced
use cases however you will probably be better off creating a separate client application that consumes
the Zibri API.

### Emails
Emails are built from Zibri's MJML component set - the same responsive, Outlook-safe structure
[MJML](https://mjml.io/) produces, but as typed tsx components you compose directly. An email is a
`TsxEmailComponent`, rendered with `TsxUtilities.renderEmail`:

```tsx
import { $ts, Mjml, MjHead, MjTitle, MjBody, MjSection, MjColumn, MjText, MjButton, TsxEmailComponent } from 'zibri';

type Props = {
    user: { name: string },
    confirmPasswordResetLink: string
};

export const PasswordResetEmail: TsxEmailComponent<Props> = ({ user, confirmPasswordResetLink }) => {
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
const html: string = TsxUtilities.renderEmail(PasswordResetEmail, {
    user: { name: 'James Smith' },
    confirmPasswordResetLink: 'http://localhost:4200/confirm-password-reset/test-token'
});
```

The available components mirror MJML's:

| Group | Components |
|---|---|
| Document | `Mjml`, `MjHead` (`MjTitle`, `MjPreview`, `MjStyle`, `MjAttributes`), `MjBody` |
| Layout | `MjWrapper`, `MjSection`, `MjColumn`, `MjGroup` |
| Content | `MjText`, `MjButton`, `MjImage`, `MjDivider`, `MjSpacer`, `MjRaw` |

#### Nesting is checked at compile time
MJML has strict rules about what may go inside what - a column belongs in a section, not directly in
the body; raw html belongs in an `MjText` or `MjRaw`, not in a section. Zibri enforces these rules
**when your templates compile**, so a mistake fails the build loudly instead of producing a broken
email:

```
emails/welcome.tsx:4:9 ZTSX004 '<div>' is not a valid child of 'MjColumn'.
    Valid children of 'MjColumn' are: MjText, MjButton, MjImage, MjDivider, MjSpacer, MjRaw.
```

A user component of your own (say a `BaseEmailHeader` that returns some sections) is treated as an
opaque wrapper: its use site is fine, and its own contents are checked in its own file.

#### Emails have no client side
Emails are static server rendered html - there is no script. Any client only code in an email template
(an `onClient` block, an event handler, or a `?client` import) is therefore a compile error
(`ZTSX005`). Use the [page](#pages) approach if you need interactivity.

## Additional functionality
Beyond plain html rendering, Zibri restores some client side functionality for pages: it generates js
script tags in the server rendered output so behavior can run in the browser.

Note that this is NOT hydration, and only properties explicitly passed into a component can appear in
the html/script sent to the client. **No imports are resolved automatically.**

This means you can't accidentally leak server side secrets to the client. Even if you use
`environment.apiUrl` somewhere and the file it's imported from also contains secrets, only what a
component actually receives as a prop (or a browser global from a `?client` import) crosses to the
browser - nothing else. Client code that references an ordinary import is a compile error (`ZTSX003`).
(A recurring problem with frameworks that blur the line between front- and backend.)

Because of this, functionality is more restrictive than React: every hook has to be provided by the
framework. Currently available:
- `onClient`
- `onServer`
- `$t`
- `$ts`
- `$f`

Everything else you might know (`useState` etc.) simply won't work (yet).

Let's take the metrics page as an example (full content down below), because it restores a lot of
client functionality. The first thing you'll notice is the strange import at the start of the file:

```tsx
import { Chart } from 'chart.js?client';
```

This is how you tell the templating engine "chart.js needs to be available on the client side". A js
file is automatically generated in `assets/public/vendor/chart.js.js` and referenced as a script tag in
the rendered html. This also keeps the client side version of chart.js exactly the same as the one on
the server side.

If you want to use a package on the client side, you also have to add an entry to the `tsx.d.ts`.

Next, the component body:

```tsx
// ...
// the below can be safely executed on both server and client side.
Chart.defaults.color = 'whitesmoke';
Chart.defaults.borderColor = 'whitesmoke';
Chart.defaults.scale.grid.color = 'rgba(200, 200, 200, 0.3)';

let snaps: MetricsSnapshot[] = [];
let automaticReload: boolean = true;

// the onClient hook provides a way to mark logic that should only be called on the client.
// In this case, window would throw an error on the server side, because it does not exist there.
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

Finally the template returned:

```tsx
<BasePage title='Metrics'
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
                    onReloadChange={() => automaticReload = !automaticReload} // The onReloadChange method is automatically reapplied, it just works on the client.
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
</BasePage>
```

## Alternative: Handlebars
If you'd rather use string templates, Zibri also supports [Handlebars](https://handlebarsjs.com/):

```ts
import renderBaseEmail from '../templates/emails/base-email.hbs';
import renderPasswordResetTemplate from '../templates/emails/password-reset.hbs';
// ...
const content: string = renderPasswordResetTemplate({
    confirmPasswordResetUrl: 'http://localhost:4200/confirm-password-reset',
    resetToken: 'test-token',
    user: { name: 'James Smith' }
});
const html: string = renderBaseEmail({
    content,
    base: {
        title: 'Password Reset',
        baseUrl: 'http://localhost:3000'
    }
});
// ...
```

You might be wondering how we can import a ts function from a file ending with `.hbs`.

That's due to our handlebars compiler that automatically creates ts definitions based on your
templates. It is actually smart enough to detect any variables that you use in your templates, as well
as infer their type. While being extremely helpful, this type safety comes with the downside that any
variables you use are restricted in their typing for the compiler to infer their type. They need to be
either:
- string
- string[]
- an object with its values being either string, string[] or another object

These are also hot reloaded when you change your templates and eg. introduce or remove a new variable.

> Caveat:<br>
> If you don't run `npm run start` then the compiler won't be able to generate the .ts files. So if you
> have any problems with eg. a property of your template not being recognized, check that first.

## See also
- [Metrics](./metrics.md) — the metrics dashboard page shown above as an example of tsx templating with client-side hooks
