/**
 * The parts of a package.json this normalization cares about.
 */
type PackageJsonLike = {
    /**
     * Who the package is attributed to.
     */
    author?: string,
    /**
     * The runtime dependencies of the package.
     */
    dependencies?: Record<string, string>,
    /**
     * The build time dependencies of the package.
     */
    devDependencies?: Record<string, string>
};

/**
 * The keys holding the dependencies of a package.
 */
type DependencyKey = 'dependencies' | 'devDependencies';

/**
 * The lower (inclusive) and upper (exclusive) version a range allows.
 */
type VersionBounds = {
    /**
     * The lowest version the range allows, inclusive.
     */
    min: VersionTuple,
    /**
     * The first version the range no longer allows.
     */
    max: VersionTuple
};

/**
 * A version split into its major, minor and patch part.
 */
type VersionTuple = [number, number, number];

/**
 * Both package.json contents after normalization.
 */
type NormalizedPackageJsonPair = {
    /**
     * The normalized content of the generated package.json.
     */
    generated: Buffer,
    /**
     * The normalized content of the sandbox package.json.
     */
    sandbox: Buffer
};

const DEPENDENCY_KEYS: DependencyKey[] = ['dependencies', 'devDependencies'];

/**
 * Stands in for the author on both sides.
 * "zi new" fills the field the way npm does, off the git configuration of the machine it runs on, so
 * what it writes is whoever ran the test. There is no value packages/sandbox could hold that would
 * equal that anywhere but on one developer's machine.
 */
const AUTHOR_PLACEHOLDER: string = '<whoever generated it>';

/**
 * The zibri packages the local dev flow rewrites to a "file:" link pointing at the workspace build.
 * That link contains the temp directory the test generated the app in, so it can never match what
 * packages/sandbox declares.
 */
const LOCALLY_LINKED_DEPENDENCIES: string[] = ['zibri', 'zibri-testing', 'zibri-tsx'];

const LOCAL_LINK_PLACEHOLDER: string = '<locally linked>';

/**
 * Matches the version forms npm writes into a package.json: "1.2.3", "^1.2.3" and "~1.2.3".
 */
const VERSION_PATTERN: RegExp = /^([\^~]?)(\d+)\.(\d+)\.(\d+)$/;

/**
 * Resolves the versions a range allows.
 * Anything that is not a plain version or a caret/tilde range around one (a "file:" link, "*", a
 * git url, ...) has no bounds and is reported as undefined so the caller can leave it untouched.
 * @param value - The version range from a package.json.
 * @returns The bounds of the range, or undefined when it is not a supported form.
 */
function toBounds(value: string): VersionBounds | undefined {
    const match: RegExpExecArray | null = VERSION_PATTERN.exec(value);
    if (!match) {
        return undefined;
    }

    const prefix: string = match[1];
    const min: VersionTuple = [Number(match[2]), Number(match[3]), Number(match[4])];
    const [major, minor, patch]: VersionTuple = min;

    if (prefix === '^') {
        // A caret only lets the leftmost non-zero part stay put, so "^0.2.3" is not "^1.x".
        if (major !== 0) {
            return { min, max: [major + 1, 0, 0] };
        }
        if (minor !== 0) {
            return { min, max: [0, minor + 1, 0] };
        }
        return { min, max: [0, 0, patch + 1] };
    }
    if (prefix === '~') {
        return { min, max: [major, minor + 1, 0] };
    }
    return { min, max: [major, minor, patch + 1] };
}

/**
 * Compares two version tuples.
 * @param a - The first tuple.
 * @param b - The tuple to compare against.
 * @returns A negative number when a is smaller, a positive one when it is bigger, 0 when equal.
 */
function compare(a: VersionTuple, b: VersionTuple): number {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Checks whether two version ranges have at least one version in common.
 * @param a - The first range.
 * @param b - The range to check against.
 * @returns Whether the ranges overlap.
 */
function overlaps(a: VersionBounds, b: VersionBounds): boolean {
    return compare(a.min, b.max) < 0 && compare(b.min, a.max) < 0;
}

/**
 * Rewrites a single generated dependency so that it no longer differs from the sandbox one for a
 * reason the parity test should not report.
 * @param name - The name of the dependency.
 * @param generatedDependencies - The generated dependencies, modified in place.
 * @param sandboxDependencies - The sandbox dependencies, modified in place.
 */
function alignDependency(
    name: string,
    generatedDependencies: Record<string, string>,
    sandboxDependencies: Record<string, string>
): void {
    if (LOCALLY_LINKED_DEPENDENCIES.includes(name)) {
        generatedDependencies[name] = LOCAL_LINK_PLACEHOLDER;
        if (sandboxDependencies[name] != undefined) {
            sandboxDependencies[name] = LOCAL_LINK_PLACEHOLDER;
        }
        return;
    }

    const sandboxVersion: string | undefined = sandboxDependencies[name];
    if (sandboxVersion == undefined) {
        return;
    }

    const generatedBounds: VersionBounds | undefined = toBounds(generatedDependencies[name]);
    const sandboxBounds: VersionBounds | undefined = toBounds(sandboxVersion);
    if (!generatedBounds || !sandboxBounds) {
        return;
    }
    if (overlaps(generatedBounds, sandboxBounds)) {
        generatedDependencies[name] = sandboxVersion;
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function withDependenciesLast(packageJson: PackageJsonLike): PackageJsonLike {
    // rest carries every key this function does not name - "name", "scripts", ... - in the order the
    // file declares them. That order is the author's and stays as it is; only the two blocks npm
    // writes on its own are put in a fixed place.
    const { dependencies, devDependencies, ...rest }: PackageJsonLike = packageJson;
    const reordered: PackageJsonLike = { ...rest };
    if (dependencies != undefined) {
        reordered.dependencies = dependencies;
    }
    if (devDependencies != undefined) {
        reordered.devDependencies = devDependencies;
    }
    return reordered;
}

/**
 * Normalizes both package.json files so that only meaningful drift remains in their diff.
 * "zi new" installs through a real "npm install", so it writes whatever npm resolved on the day the
 * test ran. Requiring those ranges to equal the ones in packages/sandbox byte for byte would turn
 * the test red every time an upstream package publishes a release, so a generated version is
 * aligned with the sandbox one whenever the two ranges still overlap. Ranges that no longer overlap
 * mean the sandbox really has fallen behind (or ahead) and stay visible in the diff.
 * The author and the order of the two dependency blocks are dropped for the same reason: both say
 * something about the run rather than about the two projects.
 * @param generated - The package.json produced by the cli generator.
 * @param sandbox - The package.json inside packages/sandbox.
 * @returns Both contents, normalized for comparison.
 */
export function normalizePackageJson(generated: Buffer, sandbox: Buffer): NormalizedPackageJsonPair {
    // JSON.parse is untyped, so the shape has to be stated here.
    const parsedGenerated: PackageJsonLike = JSON.parse(generated.toString('utf8')) as PackageJsonLike;
    const parsedSandbox: PackageJsonLike = JSON.parse(sandbox.toString('utf8')) as PackageJsonLike;

    if (parsedGenerated.author != undefined) {
        parsedGenerated.author = AUTHOR_PLACEHOLDER;
    }
    if (parsedSandbox.author != undefined) {
        parsedSandbox.author = AUTHOR_PLACEHOLDER;
    }

    for (const key of DEPENDENCY_KEYS) {
        const generatedDependencies: Record<string, string> | undefined = parsedGenerated[key];
        const sandboxDependencies: Record<string, string> | undefined = parsedSandbox[key];
        if (!generatedDependencies || !sandboxDependencies) {
            continue;
        }

        for (const name of Object.keys(generatedDependencies)) {
            alignDependency(name, generatedDependencies, sandboxDependencies);
        }
    }

    return {
        generated: Buffer.from(`${JSON.stringify(withDependenciesLast(parsedGenerated), undefined, 4)}\n`),
        sandbox: Buffer.from(`${JSON.stringify(withDependenciesLast(parsedSandbox), undefined, 4)}\n`)
    };
}