import { AssetService, Inject, Injectable, ZIBRI_DI_TOKENS } from 'zibri';

@Injectable()
export class DepService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.ASSET_SERVICE)
        private readonly assetService: AssetService
    ) {}
}