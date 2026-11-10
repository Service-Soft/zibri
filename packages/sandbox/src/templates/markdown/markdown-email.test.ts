import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { defineProvider, TsxUtilities, ZIBRI_DI_TOKENS } from 'zibri';
import { StartedTestServer, startTestServer } from 'zibri-testing';

import { InlineEmailLink } from './inline-email-link';
import { WelcomeEmail } from './welcome-email';
import { testApplicationOptions } from '../../__testing__/test-application-options';

describe('a page written in markdown in an email', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({
            application: {
                ...testApplicationOptions,
                providers: [
                    ...testApplicationOptions.providers ?? [],
                    defineProvider({ token: ZIBRI_DI_TOKENS.MDX_EMAIL_COMPONENTS, useValue: { link: InlineEmailLink } })
                ]
            }
        });
        await server.start();
    }, 60000);

    afterAll(async () => {
        await server.shutdown();
    }, 30000);

    it('renders the components the application names for emails, and not those of its pages', () => {
        const html: string = TsxUtilities.renderEmail(WelcomeEmail);

        // the Heading of the pages carries the classes of a stylesheet an email client does not load
        expect(html).toContain('<h1 id="welcome">Welcome</h1>');
        expect(html).toContain('<a href="https://app.example.com/tasks" style="color:#0e456f">your tasks</a>');
        expect(html).not.toContain('<script');
    });
});