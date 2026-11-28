import { BigNumber } from '../../../../../utilities/number.utilities';
import { type HgbSizeThreshold } from './hgb-size-threshold.model';

/**
 * The thresholds of the size classes of § 267 and § 267a HGB for the fiscal years starting on or after a day.
 */
export type HgbSizeClassThresholds = {
    /**
     * The first day a fiscal year they apply to starts on, at midnight UTC.
     */
    validFrom: Date,
    /**
     * The limits of a micro corporation, § 267a (1) HGB.
     */
    micro: HgbSizeThreshold,
    /**
     * The limits of a small corporation, § 267 (1) HGB.
     */
    small: HgbSizeThreshold,
    /**
     * The limits of a medium-sized corporation, § 267 (2) HGB. A corporation above them is large.
     */
    medium: HgbSizeThreshold
};

/**
 * The thresholds of the size classes of § 267 and § 267a HGB, the latest last, which the
 * `HgbCorporationConformanceService` classifies by: those raised for the fiscal years starting after 2023-12-31.
 */
export const HGB_SIZE_CLASS_THRESHOLDS: HgbSizeClassThresholds[] = [
    {
        validFrom: new Date('2024-01-01T00:00:00.000Z'),
        micro: { balanceSheetTotal: new BigNumber(450_000), revenue: new BigNumber(900_000), employees: 10 },
        small: { balanceSheetTotal: new BigNumber(7_500_000), revenue: new BigNumber(15_000_000), employees: 50 },
        medium: { balanceSheetTotal: new BigNumber(25_000_000), revenue: new BigNumber(50_000_000), employees: 250 }
    }
];