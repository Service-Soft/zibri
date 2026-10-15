/* eslint-disable no-console */
import { ChalkUtilities } from '../../encapsulation';
import { BaseCommand } from '../base-command.model';
import { Command } from '../command.enum';

/**
 * Displays info on how to use the cli.
 */
export class HelpCommand extends BaseCommand {

    protected override run(): Promise<void> | void {
        console.log(ChalkUtilities.boldUnderline('Commands:'));
        console.log(this.getCommandLabel(Command.HELP, Command.H), 'opens this help-page');
        console.log(this.getCommandLabel(Command.VERSION, Command.V), 'shows the currently used version');
        console.log(this.getCommandLabel(Command.NEW, Command.N), 'creates a new Zibri application, as "new [name] [github|none]"');
    }

    private getCommandLabel(command: Command, shortForm: Command): string {
        return `${ChalkUtilities.secondary(command)} / ${ChalkUtilities.secondary(shortForm)}:`;
    }
}