export type FactorHistoryValues = number[] | string[] | (number | null)[];

export interface CrossSectionalFactorCapabilities {
  readonly hasHistory: boolean;
  historyValues(field?: string): FactorHistoryValues | undefined;
}

export interface AssetFactorCapabilities {
  declaresInput(field: string): boolean;
  valueAt(field: string, periods: number): number | undefined;
}
