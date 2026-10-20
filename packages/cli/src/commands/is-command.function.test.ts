import { describe, expect, it } from 'vitest';

import { Command } from './command.enum.ts';
import { isCommand } from './is-command.function.ts';

describe('isCommand', () => {
    it.each(Object.values(Command))('recognizes "%s" as a valid command', command => {
        expect(isCommand(command)).toBe(true);
    });

    it('rejects an unknown value', () => {
        expect(isCommand('nope')).toBe(false);
    });

    it('rejects an empty string', () => {
        expect(isCommand('')).toBe(false);
    });
});