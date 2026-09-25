import { BaseUser, PasswordResetEmailTemplate } from 'zibri';

/**
 * The shape `TsxUtilities` accepts: what the zibri-tsx build step emits in place of a template
 * function, described here rather than imported.
 *
 * Declaring it costs three fields. Depending on `zibri-tsx` to produce one would put a compiler in
 * every consumer's test tree for a template they may never render - templating is optional, and an
 * application is free to use handlebars, or an auth strategy that sends no mail at all.
 */
type CompiledEmailComponent = {
    /**
     * The name the renderer reports when something goes wrong.
     */
    name: string,
    /**
     * What a compiled template exposes for client side interactivity. An email has none.
     */
    client: Record<string, never>,
    /**
     * Produces the body. Whatever this returns is handed to the renderer as a child.
     * @param props - The values the caller passed to `renderEmail`.
     * @returns The rendered body.
     */
    render: (props: Record<string, unknown>) => string
};

/**
 * The password reset email a test server sends unless the application names its own.
 *
 * `JwtAuthStrategy` requires a template to be registered before it will construct, so without this
 * a harness could not start an application at all - which is a strange thing to need from a test
 * that is about something else entirely.
 *
 * It renders the one thing a test of that flow reads back: the link. An application testing what
 * its own reset email looks like registers its own template for this token and gets it rendered by
 * whatever it builds templates with.
 */
export const defaultPasswordResetEmailTemplate: PasswordResetEmailTemplate<string, BaseUser<string>>
    // the build step swaps a template function for a compiled object, so the declared type and the
    // runtime value never match - the same (inherent, boundary) cast the framework's own compiled
    // templates need.
    = {
        name: 'DefaultPasswordResetEmail',
        client: {},
        render: (props: Record<string, unknown>) => `<a href="${String(props['confirmPasswordResetLink'])}">Reset your password</a>`
    } as CompiledEmailComponent as unknown as PasswordResetEmailTemplate<string, BaseUser<string>>;