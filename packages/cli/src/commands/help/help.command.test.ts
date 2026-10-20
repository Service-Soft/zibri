import { afterEach, describe, expect, it, vi, MockInstance } from 'vitest';

import { HelpCommand } from './help.command.ts';
import { Command } from '../command.enum.ts';

describe('HelpCommand', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('prints every command', async () => {
        const logSpy: MockInstance<typeof console.log> = vi.spyOn(console, 'log').mockImplementation(() => {});

        await new HelpCommand().start([]);

        const output: string = logSpy.mock.calls.map(call => call.join(' ')).join('\n');
        expect(output).toContain(Command.HELP);
        expect(output).toContain(Command.H);
        expect(output).toContain(Command.VERSION);
        expect(output).toContain(Command.V);
        expect(output).toContain(Command.NEW);
        expect(output).toContain(Command.N);
    });
});