/* eslint-disable no-console */
import { ChalkUtilities } from '../../encapsulation';
import { SCAFFOLD_FEATURES } from '../../scaffold';
import { BaseCommand } from '../base-command.model';
import { Command } from '../command.enum';

// the features as a command line names them, comma separated
const FEATURE_LIST: string = SCAFFOLD_FEATURES.join(',');

/**
 * Displays info on how to use the cli.
 */
export class HelpCommand extends BaseCommand {

    protected override run(): Promise<void> | void {
        console.log(ChalkUtilities.boldUnderline('Commands:'));
        console.log(this.getCommandLabel(Command.HELP, Command.H), 'opens this help-page');
        console.log(this.getCommandLabel(Command.VERSION, Command.V), 'shows the currently used version');
        console.log(
            this.getCommandLabel(Command.NEW, Command.N),
            `creates a new Zibri application, as "new [name] [github|none] [isLoggedIn|public] [${FEATURE_LIST}|none]"`
        );
        console.log(
            this.getCommandLabel(Command.UPGRADE, Command.U),
            'brings the project in this folder to what this version generates, as "upgrade [github|none] [isLoggedIn|public]"'
        );
        console.log(
            this.getCommandLabel(Command.ADD, Command.A),
            `adds features to the project in this folder, as "add <${FEATURE_LIST}>"`
        );
        console.log(
            this.getCommandLabel(Command.REMOVE, Command.R),
            `removes features from the project in this folder, as "remove <${FEATURE_LIST}>"`
        );
        console.log(
            this.getCommandLabel(Command.MIGRATE, Command.M),
            'writes the migrations of what the entities of the project in this folder changed, as "migrate create [name] [--empty]",'
            + ' or where they start for a database that holds the entities already, as "migrate baseline"'
        );
        console.log(
            this.getCommandLabel(Command.GENERATE, Command.G),
            'writes the files of a project into a folder and installs nothing,'
            + ` as "generate <folder> <name> <github|none> <isLoggedIn|public> <${FEATURE_LIST}|none>"`
        );
    }

    private getCommandLabel(command: Command, shortForm: Command): string {
        return `${ChalkUtilities.secondary(command)} / ${ChalkUtilities.secondary(shortForm)}:`;
    }
}