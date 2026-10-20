#!/usr/bin/env node
import { Command, HelpCommand, NewCommand, resolveCommand, VersionCommand } from './commands/index.ts';
import { FigletUtilities } from './encapsulation/index.ts';
import { exitOnSignal } from './utilities/index.ts';

exitOnSignal();

// eslint-disable-next-line jsdoc-js/require-jsdoc
async function main(): Promise<void> {
    const [,, ...args] = process.argv;

    FigletUtilities.displayLogo();

    const command: Command | 'error' = await resolveCommand(args);

    if (command === 'error') {
        return;
    }

    switch (command) {
        case Command.H:
        case Command.HELP: {
            await new HelpCommand().start(args);
            return;
        }
        case Command.VERSION:
        case Command.V: {
            await new VersionCommand().start(args);
            return;
        }
        case Command.NEW:
        case Command.N: {
            await new NewCommand().start(args);
            return;
        }
    }
}

void main();