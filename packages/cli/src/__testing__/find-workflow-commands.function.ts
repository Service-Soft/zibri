/**
 * Every command a generated GitHub workflow runs, in the order it runs them.
 *
 * Reads the two shapes the generator writes - `run: <command>` on one line, and `run: |` followed by
 * a more deeply indented block - rather than yaml in general, which is what keeps it free of a
 * parser. A step written in any other shape is missed, and the assertions on what the commands are
 * catch that.
 * @param workflow - The workflow file's contents.
 * @returns One entry per step, a block as one script of several lines.
 */
export function findWorkflowCommands(workflow: string): string[] {
    const lines: string[] = workflow.split('\n');
    const commands: string[] = [];
    for (let index: number = 0; index < lines.length; index++) {
        const match: RegExpExecArray | undefined = /^( *)(?:- )?run: (.*)$/.exec(lines[index] ?? '') ?? undefined;
        if (match == undefined) {
            continue;
        }
        const [, indent, command]: (string | undefined)[] = match;
        if (command !== '|') {
            commands.push(command ?? '');
            continue;
        }
        const block: string[] = [];
        while (index + 1 < lines.length && leadingSpaces(lines[index + 1] ?? '') > (indent ?? '').length) {
            index++;
            block.push(lines[index] ?? '');
        }
        const blockIndent: number = Math.min(...block.map(leadingSpaces));
        commands.push(block.map(line => line.slice(blockIndent)).join('\n'));
    }
    return commands;
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function leadingSpaces(line: string): number {
    return line.trim() === '' ? 0 : line.length - line.trimStart().length;
}