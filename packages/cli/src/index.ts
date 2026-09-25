#!/usr/bin/env node
import { Command, HelpCommand, NewCommand, resolveCommand, VersionCommand } from './commands';
import { FigletUtilities } from './encapsulation';
import { exitOnSignal } from './utilities';

exitOnSignal();

// eslint-disable-next-line jsdoc/require-jsdoc
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