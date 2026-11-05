import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { quietly } from './quietly.function';
import { NewCommand } from '../commands/new/new.command';
import { CPUtilities, FsUtilities } from '../encapsulation';
import { SCAFFOLD_MANIFEST_FILE, ScaffoldManifest, ScaffoldUtilities } from '../scaffold';
import { Path } from '../utilities';

/**
 * A project `zi new` generated and committed, which a suite changes the way a developer would.
 *
 * The suite stubs out `CPUtilities.exec` and keeps the machine's git configuration out first, as
 * the upgrade suite describes.
 */
export class GeneratedProject {
    private constructor(readonly appDir: Path) {}

    /**
     * Generates a project named "api" and commits it, leaving the cli working in it.
     * @param workDir - The folder to generate into.
     * @param args - What follows the name on the command line of `zi new`.
     * @returns The project.
     */
    static async create(workDir: Path, args: string[]): Promise<GeneratedProject> {
        CPUtilities['cwd'] = workDir;
        await quietly(async () => new NewCommand().start(['n', 'api', ...args]));
        const project: GeneratedProject = new GeneratedProject(path.join(workDir, 'api') as Path);
        CPUtilities['cwd'] = project.appDir;
        project.git('init', '--quiet');
        project.commitAll('zi new');
        return project;
    }

    /**
     * Runs git in the project, with an identity of its own so no machine's configuration is needed.
     * @param args - The git command and its arguments.
     * @returns What it printed.
     */
    git(...args: string[]): string {
        return execFileSync(
            'git',
            ['-c', 'user.name=zi', '-c', 'user.email=zi@example.com', ...args],
            { cwd: this.appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
    }

    /**
     * Commits everything in the project.
     * @param message - The commit message.
     */
    commitAll(message: string): void {
        this.git('add', '--all');
        this.git('commit', '--quiet', '--allow-empty', '--message', message);
    }

    /**
     * Whether the project has a file.
     * @param relativePath - The file, relative to the project.
     * @returns True when it exists.
     */
    async exists(relativePath: string): Promise<boolean> {
        return await FsUtilities.exists(path.join(this.appDir, relativePath) as Path);
    }

    /**
     * A file of the project, as text.
     * @param relativePath - The file, relative to the project.
     * @returns Its content.
     */
    async read(relativePath: string): Promise<string> {
        return await FsUtilities.readFile(path.join(this.appDir, relativePath) as Path);
    }

    /**
     * Overwrites a file of the project.
     * @param relativePath - The file, relative to the project.
     * @param content - What it holds afterwards.
     */
    async write(relativePath: string, content: string): Promise<void> {
        await FsUtilities.writeFileBuffer(path.join(this.appDir, relativePath) as Path, Buffer.from(content));
    }

    /**
     * The project's manifest.
     * @returns It.
     */
    async resolveManifest(): Promise<ScaffoldManifest> {
        const manifest: ScaffoldManifest | undefined = await ScaffoldUtilities.findManifest(this.appDir);
        assert(manifest, `the project has no ${SCAFFOLD_MANIFEST_FILE}`);
        return manifest;
    }
}