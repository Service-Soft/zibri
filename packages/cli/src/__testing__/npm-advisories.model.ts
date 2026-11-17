/**
 * The advisories npm audit reports for a project, by whether the project can do something about them.
 */
export type NpmAdvisories = {
    /**
     * About a dependency the project runs on, or a development dependency with a release that fixed it.
     */
    fixable: string[],
    /**
     * About a development dependency whose newest release is still affected.
     */
    unfixed: string[]
};