export type FactorWeatherDirection = 'positive' | 'negative';
export type FactorWeatherPinStatus = 'pending' | 'running' | 'ready' | 'error';

export interface FactorWeatherPoint {
  formationDate: string;
  periodEndDate: string;
  rankIc: number;
  topReturn: number;
  bottomReturn: number;
  longShortGrossReturn: number;
  longShortNetReturn: number;
  topTurnover: number | null;
  sampleSize: number;
  sampleCoverage: number;
}

export interface FactorWeatherPin {
  id: string;
  factorId: string;
  factorName: string;
  builtin: boolean;
  direction: FactorWeatherDirection;
  status: FactorWeatherPinStatus;
  error?: string;
  computedThrough?: string;
  codeHash: string;
  points: FactorWeatherPoint[];
  createdAt: string;
}

export interface FactorWeatherResponse {
  methodology: {
    frequency: 'month';
    neutral: 'size_industry';
    weighting: 'equal';
    groups: 10;
    partialMonth: false;
  };
  pins: FactorWeatherPin[];
}
