/** The age bands every ageing report uses. One definition, so customer, supplier and stock agree. */
export interface AgeingBand {
  readonly label: string;
  readonly fromDays: number;
  readonly toDays: number | null;
}

export const AGEING_BANDS: ReadonlyArray<AgeingBand> = [
  { label: "0-30 days", fromDays: 0, toDays: 30 },
  { label: "31-60 days", fromDays: 31, toDays: 60 },
  { label: "61-90 days", fromDays: 61, toDays: 90 },
  { label: "Over 90 days", fromDays: 91, toDays: null },
];

/** Index of the band an age in whole days falls in, or -1 (cannot happen for age >= 0). */
export function ageingBandIndex(ageDays: number): number {
  return AGEING_BANDS.findIndex((band) => ageDays >= band.fromDays && (band.toDays === null || ageDays <= band.toDays));
}
