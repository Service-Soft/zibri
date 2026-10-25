import { ScaffoldFeature, ScaffoldManifest } from '../scaffold';
import { Path } from '../utilities';

/**
 * What `zi add` and `zi remove` work on.
 */
export type FeatureChange = {
    /**
     * The project.
     */
    projectPath: Path,
    /**
     * What was generated into it last.
     */
    manifest: ScaffoldManifest,
    /**
     * Every feature it has afterwards.
     */
    features: ScaffoldFeature[],
    /**
     * The features added or removed.
     */
    changed: ScaffoldFeature[]
};
