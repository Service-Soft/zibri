import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { Command } from './command.enum';
import { resolveCommand } from './resolve-command.function';
import { mockExitGracefully, ProcessExitError } from '../__testing__/mock-exit-gracefully.function';

describe('resolveCommand', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('resolves known commands, both long and short form', async () => {
        await expect(resolveCommand(['help'])).resolves.toBe(Command.HELP);
        await expect(resolveCommand(['h'])).resolves.toBe(Command.H);
        await expect(resolveCommand(['new'])).resolves.toBe(Command.NEW);
        await expect(resolveCommand(['n', 'api'])).resolves.toBe(Command.N);
    });

    it('exits when no command is given', async () => {
        mockExitGracefully();
        await expect(resolveCommand([])).rejects.toThrow(ProcessExitError);
    });

    it('exits when the command is unknown', async () => {
        mockExitGracefully();
        await expect(resolveCommand(['bogus'])).rejects.toThrow(ProcessExitError);
    });
});