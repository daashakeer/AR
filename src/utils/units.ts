/**
 * Unit conversion and formatting for distances.
 * Input is always in METERS (WebXR coordinate system).
 */

export type Unit = 'cm' | 'm' | 'in' | 'ft';

export const UNIT_LABELS: Record<Unit, string> = {
  cm: 'cm',
  m: 'm',
  in: 'in',
  ft: 'ft',
};

export const UNIT_DISPLAY: Record<Unit, string> = {
  cm: 'Centimeters',
  m: 'Meters',
  in: 'Inches',
  ft: 'Feet',
};

/** Convert from meters to the given unit */
export function toUnit(meters: number, unit: Unit): number {
  switch (unit) {
    case 'cm': return meters * 100;
    case 'm':  return meters;
    case 'in': return meters * 39.3701;
    case 'ft': return meters * 3.28084;
  }
}

/** Primary formatted display string */
export function formatPrimary(meters: number, unit: Unit): string {
  const val = toUnit(meters, unit);
  switch (unit) {
    case 'cm': return `${val.toFixed(1)} cm`;
    case 'm':  return `${val.toFixed(3)} m`;
    case 'in': return `${val.toFixed(1)} in`;
    case 'ft': return `${val.toFixed(2)} ft`;
  }
}

/** Secondary multi-unit display */
export interface AllUnits {
  cm: string;
  m: string;
  inches: string;
  feet: string;
  feetInches: string;
}

export function formatAllUnits(meters: number): AllUnits {
  const totalInches = meters * 39.3701;
  const totalFeet = meters * 3.28084;
  const wholeFeet = Math.floor(totalFeet);
  const remInches = ((totalFeet - wholeFeet) * 12);

  return {
    cm: `${(meters * 100).toFixed(1)} cm`,
    m: `${meters.toFixed(3)} m`,
    inches: `${totalInches.toFixed(1)} in`,
    feet: `${totalFeet.toFixed(2)} ft`,
    feetInches: wholeFeet > 0
      ? `${wholeFeet} ft ${remInches.toFixed(1)} in`
      : `${remInches.toFixed(1)} in`,
  };
}

/** Unit cycle order for the Switch Unit button */
export const UNIT_CYCLE: Unit[] = ['cm', 'm', 'in', 'ft'];

export function nextUnit(current: Unit): Unit {
  const idx = UNIT_CYCLE.indexOf(current);
  return UNIT_CYCLE[(idx + 1) % UNIT_CYCLE.length];
}
