import { afterEach, describe, expect, it, vi } from 'vitest';

import { Command } from './command.enum.ts';
import { resolveCommand } from './resolve-command.function.ts';
import { mockExitGracefully, ProcessExitError } from '../__testing__/mock-exit-gracefully.function.ts';

describe('resolveCommand', () => {
    afterEach(() => {
        vi.restoreAllMocks();
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