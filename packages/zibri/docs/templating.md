# Templating
HTML pages and emails are rendered from `.tsx` templates, which the `zibri-tsx` compiler compiles at
build time. Pages and emails differ in the components you use and in how you render them.

The build type-checks the templates with your `tsconfig.json`, and a type error in a template fails it,
naming the file and the line. In `npm start`, it fails that rebuild, and the running application keeps
running until the error is fixed.

For string templates, [Handlebars](#rendering-a-handlebars-template) is available as an alternative.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `TsxUtilities` | class | Renders a tsx page (`renderPage`) or email (`renderEmail`) to html |
| `MaskUtilities` | class | Masks sensitive text for display: `mask` keeps the first character and the last two |
| `HtmlResponse` | class | Wraps rendered html to be returned from a controller |
| `TsxComponent` | type | Type of a page component rendered by `TsxUtilities.renderPage` |
| `TsxEmailComponent` | type | Type of an email component rendered by `TsxUtilities.renderEmail` |
| `TsxElement`, `TsxChildren` | type, type | What a JSX expression renders to, and anything that can be placed inside an element |
| `Mjml`, `MjHead`, `MjTitle`, `MjPreview`, `MjStyle`, `MjAttributes`, `MjBody` | function | The document of an email and its head (see [rendering an email](#rendering-an-email)) |
| `MjWrapper`, `MjSection`, `MjColumn`, `MjGroup` | function | The layout of an email |
| `MjText`, `MjButton`, `MjImage`, `MjDivider`, `MjSpacer`, `MjRaw` | function | The content of an email |
| `MjmlProps`, `MjBodyProps`, `MjSectionProps`, `MjColumnProps`, `MjGroupProps`, `MjWrapperProps`, `MjTextProps`, `MjButtonProps`, `MjImageProps`, `MjDividerProps`, `MjSpacerProps`, `MjAttributesProps` | type, type, type, type, type, type, type, type, type, type, type, type | The props of the email components |
| `EmailLayoutContext`, `EmailLayout` | constant, type | The width and inherited typography of the section or column an email component is in |
| `onClient`, `onServer`, `$t`, `$ts`, `$f` | function | The template hooks (see [running code in the browser](#running-code-in-the-browser)) |
| `useState` | function | Creates a state, which client code changes and the markup follows (see [keeping the page in step with a state](#keeping-the-page-in-step-with-a-state)) |
| `State` | type | What `useState` returns: `value` reads and writes the state |
| `useEffect` | function | Runs code in the browser once the page starts, and again after a change to a state (see [running code after a state changes](#running-code-after-a-state-changes)) |
| `useInput`, `useWritableInput` | function, function | Read a value a component is handed and follow the state it comes from, or take a state it may write (see [handing a state to another component](#handing-a-state-to-another-component)) |
| `Input` | type | What `useInput` returns: `value` reads the value, read only |
| `useRef`, `useRefs` | function | Give client code the element, or the elements, they are put on with `ref` (see [reaching an element from client code](#reaching-an-element-from-client-code)) |
| `Ref`, `Refs` | type | What `useRef` and `useRefs` return: `current` holds the element, or the elements |
| `createContext`, `provideContext`, `useContext` | function, function, function | Create a context, give it a value for the components below, and read it (see [passing a value to nested components](#passing-a-value-to-nested-components)) |
| `RenderContext` | type | A context `createContext` returns, with the value read when nothing provides one |
| `$raw` | function | Writes trusted html as it is, unescaped |
| `HandlebarUtilities` | class | Renders a Handlebars template file (`renderTemplate`) or string (`renderTemplateString`), and parses one (`parse`) |
| `HandlebarOptions` | type | The Handlebars instance and the folder of the components a template uses, via `ZIBRI_DI_TOKENS.HANDLEBAR_OPTIONS` |
| `generateHandlebarTypeFiles`, `generateHandlebarType` | function, function | Write a type definition for each `.hbs` template, and resolve the lines of one from a parsed template |
| `AstProgram`, `AstStatement`, `AstBlockStatement`, `AstCommentStatement`, `AstContentStatement`, `AstPartialStatement`, `AstMustacheStatement`, `AstPartialBlockStatement`, `AstExpression`, `AstPathExpression`, `AstBlockPathExpression`, `AstSubExpression`, `AstStringLiteral`, `AstNumberLiteral`, `AstBooleanLiteral`, `AstUndefinedLiteral`, `AstNullLiteral`, `AstHash`, `AstHashPair` | type, type, type, type, type, type, type, type, type, type, type, type, type, type, type, type, type, type, type | The nodes of the syntax tree `HandlebarUtilities.parse` returns |

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
effect, an event handler, a ref, a state, an input, or a `?client` import) is a compile error (`ZTSX005`). For behavior in the browser, use
a [page](#rendering-a-page).

## Passing a value to nested components
A context hands a value to every component a component renders, however deep, without passing it
through the props of each one. Create it once with `createContext`, give it a value with
`provideContext`, and read it with `useContext`:

```tsx
// src/templates/pages/project.tsx
import { createContext, provideContext, RenderContext, TsxComponent, useContext } from 'zibri';

type ProjectPageProps = {
    accentClass: string,
    taskTitles: string[]
};

type TaskHeadingProps = {
    title: string
};

const AccentClass: RenderContext<string> = createContext('text-slate-900');

const TaskHeading: TsxComponent<TaskHeadingProps> = ({ title }) => {
    const accentClass: string = useContext(AccentClass);
    return <h2 className={accentClass}>{title}</h2>;
};

export const ProjectPage: TsxComponent<ProjectPageProps> = ({ accentClass, taskTitles }) => {
    provideContext(AccentClass, accentClass);
    return <main>{taskTitles.map(title => <TaskHeading title={title} />)}</main>;
};
```

`useContext` reads the value of the nearest component above that provided one, or the default given to
`createContext` when none did. A context exists while the html renders on the server, so code in the
browser cannot read it. A context holding a value that follows a state is read with `useInput`, see
[handing a state to another component](#handing-a-state-to-another-component).

The email components hand their width down the same way. An email component of your own reads the width
of the section or column it is in with `useContext(EmailLayoutContext)`.

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
value client code uses whole (passes on, spreads, stringifies) is written whole. A field taken out with
a rest stays out: after `const { password, ...others } = user`, a handler reading `others` whole gets
everything but `password`. Give client code only the values it needs.

Client code gets a value as what it is: a `Date`, a `Map` or a `Set` as one, and `undefined`, `NaN`,
`Infinity` and a `bigint` as themselves. A `Date`, `Map` or `Set` is written whole, as client code reads
it through its methods. An instance of a class of yours is written as a plain object of its fields,
without its methods, and a value with a `toJSON` method as what that returns. A function in a value is
left out.

Client code has these hooks, and no others:
- `onClient`
- `onServer`
- `useState`
- `useInput`, `useWritableInput`
- `useEffect`
- `useRef`, `useRefs`
- `$t`
- `$ts`
- `$f`

React's other hooks, such as `useMemo`, are not among them, as a component runs once, and `useRef` holds an element,
never a value.

The metrics page uses these in full. It imports `chart.js?client`. The body of a component runs on the
server while it renders, and what client code needs of it runs again in the browser. Code inside
`onClient` runs only in the browser, such as code reading `window`, which the server does not have, or
a `?client` import, which only the page loads:

```tsx
// src/templates/pages/metrics.tsx
import { Chart } from 'chart.js?client';

import { MetricsSnapshot, onClient, State, useEffect, useState } from 'zibri';

// ...
let snaps: MetricsSnapshot[] = [];
const reloadsAtStart: boolean = true;
const automaticReload: State<boolean> = useState(reloadsAtStart);

onClient(() => {
    Chart.defaults.color = 'whitesmoke';
    Chart.defaults.borderColor = 'whitesmoke';
    Chart.defaults.scale.grid.color = 'rgba(200, 200, 200, 0.3)';
});

useEffect(() => {
    if (!automaticReload.value) {
        return;
    }
    void loadSnapshots();
    const timer: ReturnType<typeof setInterval> = setInterval(() => void loadSnapshots(), 1000);
    return () => clearInterval(timer);
}, [automaticReload]);

async function loadSnapshots(): Promise<void> {
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

`onClient` runs its callback once every component of the page is set up: their handlers are attached,
and everything a component declares exists, also what it declares below the `onClient` call. The
callbacks of a page run before those of the components inside it, and those of one component in the
order it called `onClient`. A callback calling `onClient` adds one that runs after those already
waiting. Called from a handler, it runs the callback right away.

A callback may return a cleanup, such as one clearing a timer it started. It runs when the component is removed from
the page with the branch or the row of [markup that follows a state](#rendering-markup-that-follows-a-state).

A callback that throws is reported like an uncaught error, and the other callbacks still run. A
component whose setup throws is reported the same way, and its callbacks are dropped. The components
after it still start, and one it hands a function to receives `undefined` for it.

These are compile errors as well:

| Code | Written |
|---|---|
| `ZTSX010` | `onClient`, `useEffect`, `useState`, `useRef` or `useRefs` outside a component, where nothing runs it |
| `ZTSX012` | JSX in client code. The markup is rendered on the server, and client code changes the page through the DOM |
| `ZTSX013` | A `?client` import of a file of your application. Only a package has a script the page can load |
| `ZTSX014` | A name only the browser has, read while the server renders: a global such as `document` or `window`, or a `?client` import, at module level, in the body of a component or in its markup |

A read under a `typeof` check of the same name is allowed, such as
`typeof window === 'undefined' ? '' : window.location.href`, and so is a global the template declares. A
function the component calls while it renders is not followed, so a browser name read there throws when
the page is rendered.

The callbacks run at the end of the page's body, before the scripts the page loads with `defer`. Code
that needs one of those waits for the document's `DOMContentLoaded` event.

The `?client` suffix makes a package available in the browser. The build writes the package's
browser script to `assets/public/vendor/chart-js.js`, and the rendered html loads it with a script
tag. The browser runs the same version of the package as the server.

> [!NOTE]
> The build takes a classic script that sets a global, such as a UMD build, from what the package
> names as its browser distribution. A package that ships its browser distribution as ES modules only
> fails the build, which names it.

To use a package in the browser, also add an entry for it to `tsx.d.ts`.

The component the page renders. An event handler such as the `onChange` of the checkbox runs in the browser:

```tsx
// src/templates/pages/metrics.tsx
import { State, TsxComponent, useState } from 'zibri';

import { BasePage } from '../components/base-page';
import { NetworkChart, RequestDurationChart, RequestsPerSecondChart, ResourceUsageChart } from '../components/charts';
import { Checkbox } from '../components/checkbox';
import { Heading } from '../components/heading';
import { MetricsStatus } from '../components/metrics-status';

type MetricsPageProps = {
    version: string,
    primary: string,
    secondary: string
};

export const MetricsPage: TsxComponent<MetricsPageProps> = ({ version, primary, secondary }) => {
    const automaticReload: State<boolean> = useState(true);

    return <BasePage
        title='Metrics'
        activeRoute='/metrics/dashboard'
        scripts={['/assets/lib/chartjs-adapter-date-fns.js']}
        className="flex flex-col gap-4 py-8"
    >
        <Heading className="text-center">Metrics</Heading>
        <Checkbox label="Automatic reload" onChange={() => automaticReload.value = !automaticReload.value} checked={automaticReload.value} />
        <div className="w-full px-10 flex flex-col gap-5">
            <div className="grid grid-cols-5 gap-5">
                <div className="col-span-2 flex flex-col gap-5">
                    <MetricsStatus id="overview" version={version} className="flex-1" />
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
};
```

A component whose `label` points at its input, such as the `Checkbox`, generates the id with `UUIDUtilities.generate()`
when none is passed. A generated id differs on every render, so a test that finds the element passes an `id` of its own.

## Keeping the page in step with a state
`useState` creates a state of the component. Client code reads it with `value` and changes it by assigning
`value`, and every text and attribute of the markup that reads it follows. Call it at the top of a
component, assigned to a `const`:

```tsx
// src/templates/components/task-counter.tsx
import { State, TsxComponent, useState } from 'zibri';

export const TaskCounter: TsxComponent = () => {
    const done: State<number> = useState(0);

    function label(): string {
        return done.value === 1 ? '1 task done' : `${done.value} tasks done`;
    }

    return (
        <div>
            <p>{label()}</p>
            <button disabled={done.value >= 10} onClick={() => { done.value = done.value + 1; }}>Done</button>
        </div>
    );
};
```

The server renders the markup with the value the state starts with. In the browser, a change writes every part of the
markup that reads the state again, once the code changing it has finished, and only what differs. A text, an attribute,
or a function of the component they call can read it. `checked` and `value` are written to the element's properties,
which a user changes, and `style` to its style properties.

The argument of `useState` runs on the server while it renders, and the page gets what it returns, narrowed to what
client code reads of it. So `useState(MaskUtilities.mask(email))` hands the browser the masked text, and the helper stays
on the server.

Assign a state a new value to change it, such as `tasks.value = [...tasks.value, task]`: a value changed in place, as
`tasks.value.push(task)` does, is the same value, and the markup does not follow it.

A state itself on the `value` of an `input`, a `textarea` or a `select`, or on the `checked` of a checkbox, binds both
ways: what the user enters is written to the state. Its value binds one way:

```tsx
// src/templates/components/task-search.tsx
import { State, TsxComponent, useState } from 'zibri';

export const TaskSearch: TsxComponent = () => {
    const query: State<string> = useState('');
    const onlyOpen: State<boolean> = useState(true);

    return (
        <div>
            <input value={query}/>
            <input type="checkbox" checked={onlyOpen}/>
            <p>{onlyOpen.value ? 'Open tasks' : 'All tasks'} matching {query.value}</p>
        </div>
    );
};
```

A component that forwards a state it is handed to such an attribute binds it both ways as well, see
[handing a state to another component](#handing-a-state-to-another-component). `onChange` is the `change` event of the
DOM, which a text field fires when it loses focus, and `onInput` fires on every change.

| Code | Written |
|---|---|
| `ZTSX016` | `useState`, `useInput` or `useWritableInput` not at the top of a component as `const name = useState(value)`, a value of a state changed in place, a write through the handle `useInput` returns, markup reading a state in any form but those of [rendering markup that follows a state](#rendering-markup-that-follows-a-state), a row of such a list without a key or with more than one root element, `$raw` or `dangerouslySetInnerHTML` in such markup, a spread of a state or a row onto a component in it, a constant computed once from a state and read by the markup, or `$raw` reading a state |

A `let` the markup reads and client code writes compiles with a `ZTSX016` warning: the markup never follows it. Make it a
state. The build reports the warning, and so does a test rendering the template.

## Rendering markup that follows a state
A condition or a list whose condition or items read a state is rendered again in the browser when the state changes.
It is written in one of three forms:

```tsx
// src/templates/components/task-list.tsx
import { State, TsxComponent, useState } from 'zibri';

type TaskItem = {
    id: string,
    title: string,
    done: boolean
};

type TaskListProps = {
    tasks: TaskItem[]
};

export const TaskList: TsxComponent<TaskListProps> = ({ tasks }) => {
    const shown: State<TaskItem[]> = useState(tasks);
    const failed: State<boolean> = useState(false);

    return (
        <div>
            {shown.value.length === 0 && <p>No tasks</p>}
            {failed.value ? <p>Saving failed</p> : <p>All saved</p>}
            <ul>
                {shown.value.map(task => <li key={task.id}>
                    {task.title}
                    {task.done && <b> done</b>}
                    <button onClick={() => { shown.value = shown.value.filter(other => other.id !== task.id); }}>Remove</button>
                </li>)}
            </ul>
        </div>
    );
};
```

| Form | Renders |
|---|---|
| `cond && <p/>` | The markup while `cond` holds, and nothing while it does not |
| `cond ? <a/> : <b/>` | The markup of the branch that holds. A branch can be `null` |
| `items.map(item => <li key={item.id}/>)` | One row for each item. Each row has one root element, with a key |

The server renders the branch that holds or the rows, and the browser takes over the elements it rendered. When the
state changes, a condition builds the branch that holds now and removes the other. A list keeps each row whose key
stays, with its element, and adds, removes and moves the others, so an input in a row keeps its focus and its text. A
kept row whose item changed shows the new item. Two rows with the same key throw while the page renders in
`development`. In the browser, a change giving two rows the same key is reported, and the list keeps the rows it has.

Inside the markup, handlers work as anywhere else, a ref of `useRefs` holds the elements of the rows the list has, and
another condition or list can follow the item of a row.

The markup can hold components, and the `children` of the component. A prop reading a state or the row follows it in
the component, as a value handed to a component does, see [handing a state to another component](#handing-a-state-to-another-component):
the component forwards it to an element, or reads it with `useInput`. A handler or a function reading the row calls it
with the item the row has now:

```tsx
// src/templates/components/task-board.tsx
import { State, TsxComponent, useState } from 'zibri';

import { TaskRow } from './task-row';

type BoardTask = {
    id: string,
    title: string
};

type TaskBoardProps = {
    tasks: BoardTask[]
};

export const TaskBoard: TsxComponent<TaskBoardProps> = ({ tasks }) => {
    const shown: State<BoardTask[]> = useState(tasks);

    return (
        <ul>
            {shown.value.map(task => <TaskRow
                key={task.id}
                title={task.title}
                onRemove={() => { shown.value = shown.value.filter(other => other.id !== task.id); }}
            />)}
        </ul>
    );
};
```

```tsx
// src/templates/components/task-row.tsx
import { TsxComponent } from 'zibri';

type TaskRowProps = {
    title: string,
    onRemove: () => void
};

export const TaskRow: TsxComponent<TaskRowProps> = ({ title, onRemove }) => (
    <li>
        {title}
        <button onClick={() => onRemove()}>Remove</button>
    </li>
);
```

For a branch or a row the browser builds later, the server renders it once more without its values, into a template the
browser copies. Removing a branch or a row removes its components: their effects stop, and the cleanups of their
effects and of their `onClient` callbacks run. Shown again, a component starts anew, from the values the server
rendered.

> [!NOTE]
> A branch that is not shown is in the page as a template, which anyone reading the page sees. Keep what a user may
> not see out of the page with a condition on a value of the server, such as a prop.

## Handing a state to another component
A component hands a value that follows a state to another one as a prop, or to every component below it with
`provideContext`. The value follows the state in the component it is handed to:

```tsx
// src/templates/components/send-button.tsx
import { TsxComponent } from 'zibri';

type SendButtonProps = {
    disabled: boolean
};

export const SendButton: TsxComponent<SendButtonProps> = ({ disabled }) => <button type="submit" disabled={disabled}>Send</button>;
```

```tsx
// src/templates/components/task-title-field.tsx
import { State, TsxComponent, useWritableInput } from 'zibri';

type TaskTitleFieldProps = {
    value: State<string>
};

export const TaskTitleField: TsxComponent<TaskTitleFieldProps> = ({ value }) => {
    const title: State<string> = useWritableInput(value);
    return <input value={title.value} onInput={ev => { title.value = ev.currentTarget.value; }}/>;
};
```

```tsx
// src/templates/components/title-preview.tsx
import { Input, TsxComponent, useInput } from 'zibri';

type TitlePreviewProps = {
    text: string
};

export const TitlePreview: TsxComponent<TitlePreviewProps> = ({ text }) => {
    const shown: Input<string> = useInput(text);
    return <p className={shown.value.length > 80 ? 'text-red-700' : ''}>{shown.value}</p>;
};
```

```tsx
// src/templates/components/new-task-form.tsx
import { State, TsxComponent, useState } from 'zibri';

import { SendButton } from './send-button';
import { TaskTitleField } from './task-title-field';
import { TitlePreview } from './title-preview';

export const NewTaskForm: TsxComponent = () => {
    const taskTitle: State<string> = useState('');

    return (
        <form>
            <TaskTitleField value={taskTitle}/>
            <TitlePreview text={taskTitle.value}/>
            <SendButton disabled={taskTitle.value === ''}/>
        </form>
    );
};
```

| A component | Takes it with |
|---|---|
| Hands it on as it is, to an attribute of an element, into a text or to another component | Nothing |
| Reads it in any other way | `useInput(prop)`, whose `value` is read only |
| Writes it | `useWritableInput(prop)`, when it is handed the state itself, such as `value={taskTitle}` |
| Reads it from a context | `useInput(useContext(X))` |

The argument of `useInput` runs on the server, like the argument of `useState`. A value that follows no state is
written into the page as it is, narrowed to what client code reads of it, and never changes.

A value that follows a state reaching a prop the component uses any other way, or a value that is not a state reaching
`useWritableInput`, throws while the page renders in `development`. In `production` it is logged, and the component
gets the value the state has, which does not follow it. A state handed to a prop typed as its value, or its value to
a prop typed `State`, is a type error, which the build reports.

## Running code after a state changes
`useEffect` runs code in the browser once the page starts, and again after a change to a state of its list. Call it at
the top of a component, with the states it runs again for written in place:

```tsx
// src/templates/components/task-timer.tsx
import { State, TsxComponent, useEffect, useState } from 'zibri';

export const TaskTimer: TsxComponent = () => {
    const running: State<boolean> = useState(false);
    const seconds: State<number> = useState(0);

    useEffect(() => {
        if (!running.value) {
            return;
        }
        const timer: ReturnType<typeof setInterval> = setInterval(() => {
            seconds.value = seconds.value + 1;
        }, 1000);
        return () => clearInterval(timer);
    }, [running]);

    return (
        <div>
            <p>{seconds.value} seconds</p>
            <button onClick={() => { running.value = !running.value; }}>{running.value ? 'Stop' : 'Start'}</button>
        </div>
    );
};
```

An effect first runs with the callbacks of `onClient`, in the order the component calls them. After a change, it runs
once the page shows the change, and only when a state of its list holds another value. A function of the component in
the list, such as `[isDirty]`, makes it run again when the function returns another value. The function an effect
returns runs before the effect runs again.

An effect reads the current value of every state, listed or not. The list decides only when it runs again. For code
that runs once, use `onClient`.

An effect that throws is reported like an uncaught error, and the other effects still run.

| Code | Written |
|---|---|
| `ZTSX017` | `useEffect` anywhere but as a statement of its own at the top of a component, or with anything but an array of at least one state or function written in place as its list |

## Reaching an element from client code
`useRef` gives client code the element it is put on with `ref`, such as a dialog to open or a canvas to hand
to a library. Call it at the top of a component, assigned to a `const`, and read `current` in `onClient` or
in a handler:

```tsx
// src/templates/components/confirm-delete.tsx
import { TsxComponent, useRef } from 'zibri';

export const ConfirmDelete: TsxComponent = () => {
    const dialog = useRef<HTMLDialogElement>();

    return (
        <div>
            <button onClick={() => dialog.current.showModal()}>Delete the task</button>
            <dialog ref={dialog}>
                <button onClick={() => dialog.current.close()}>Keep it</button>
            </dialog>
        </div>
    );
};
```

A ref is required: it needs to be on an element. `useRef<HTMLElement>({ required: false })` creates one
that may be on none, whose `current` is then `undefined`. `useRefs` holds every element it is put on, such
as the rows of a list, in document order. In [markup that follows a state](#rendering-markup-that-follows-a-state), a
ref holds the element of the branch that is shown, and `useRefs` the elements of the rows the list has. The type of a ref
says which elements it fits: a
`Ref<HTMLInputElement>` fits an `<input>`, and a `Ref<HTMLElement>` fits any element.

A ref is a value like any other in the markup, so a component can hand it to another one under any name,
such as `<Field inputRef={input}/>`, which puts it on its own element with `<input ref={inputRef}/>`. On
the page, the element carries an id of the ref, and nothing else.

What the compiler cannot see is reported when the page renders: a required ref on no element, and a ref of
`useRef` on more than one, such as one handed to a component of another file. In `development` the render
throws, naming the component and the ref. In `production` it is logged, and the page renders: a required
ref on no element throws when client code reads it, and a ref on several elements holds the first.

| Code | Written |
|---|---|
| `ZTSX015` | `useRef` or `useRefs` not at the top of a component as `const name = useRef()`, `useRef` with anything but `{ required: true }` or `{ required: false }` written in place, a ref on no element and handed to no component, a ref of `useRef` on an element in a loop or on two elements that can both render, or a required ref on an element some path of the component does not render |

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
