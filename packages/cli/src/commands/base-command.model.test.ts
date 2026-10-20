import { afterEach, describe, expect, it, vi } from 'vitest';

import { BaseCommand } from './base-command.model.ts';
import { mockExitGracefully, ProcessExitError } from '../__testing__/mock-exit-gracefully.function.ts';

type TestInput = {
    value: string
};

class TestCommand extends BaseCommand<TestInput> {
    ran: TestInput | undefined;

    protected override run(input: TestInput): void {
        this.ran = input;
    }

    protected override resolveInput(args: string[]): TestInput {
        return { value: args[0] };
    }
}

describe('BaseCommand', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('resolves input and runs the command when args are within maxLength', async () => {
        const command: TestCommand = new TestCommand();
        await command.start(['api']);
        expect(command.ran).toEqual({ value: 'api' });
    });

    it('exits and never runs the command when more args than maxLength are provided', async () => {
        mockExitGracefully();
        const command: TestCommand = new TestCommand();
        await expect(command.start(['api', 'extra'])).rejects.toThrow(ProcessExitError);
        expect(command.ran).toBeUndefined();
    });
});