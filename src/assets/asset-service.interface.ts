import { ZibriApplication } from '../application';
import { Route } from '../routing';

export interface AssetServiceInterface {
    readonly assetsPath: string,
    readonly assetsRoute: Route,
    // eslint-disable-next-line typescript/no-explicit-any
    attachTo: (app: ZibriApplication, ...params: any[]) => void
}