import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { TsxUtilities } from 'zibri';
import { StartedTestServer, startTestServer } from 'zibri-testing';

import { Checkbox } from './checkbox';
import { testApplicationOptions } from '../../__testing__/test-application-options';

const TIMEOUT: number = 30000;

type RenderedIds = {
    input: string | undefined,
    label: string | undefined
};

/**
 * Renders a checkbox without an id, and reads the id of its input and what its label points at.
 * @returns The id of the input and the `for` of the label.
 */
function renderWithoutId(): RenderedIds {
    const html: string = TsxUtilities.renderPage(Checkbox, { label: 'Automatic reload' });
    return {
        input: /<input[^>]*\sid="([^"]*)"/.exec(html)?.[1],
        label: /<label[^>]*\sfor="([^"]*)"/.exec(html)?.[1]
    };
}

describe('a checkbox without an id', () => {
    let server: StartedTestServer;

    // a template renders in a created application, whose environment decides what a render mistake does
    beforeAll(async () => {
        server = await startTestServer({ application: testApplicationOptions });
    }, TIMEOUT);

    afterAll(async () => {
        await server.shutdown();
    }, TIMEOUT);

    it('gets an id of its own, which its label points at', () => {
        const ids: RenderedIds = renderWithoutId();

        expect(ids.input).toMatch(/^\S+$/);
        expect(ids.input).not.toBe('Automatic reload');
        expect(ids.label).toBe(ids.input);
    });

    it('gets another id on every render, so two with the same label do not share one', () => {
        expect(renderWithoutId().input).not.toBe(renderWithoutId().input);
    });
});
