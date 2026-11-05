import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { HelpCommand } from './help.command';
import { Command } from '../command.enum';

describe('HelpCommand', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('prints every command', async () => {
        const logSpy: jest.SpiedFunction<typeof console.log> = jest.spyOn(console, 'log').mockImplementation(() => {});

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