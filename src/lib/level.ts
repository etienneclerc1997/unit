// Spirit level math. Input is the gravity reaction vector from `devicemotion`
// (accelerationIncludingGravity), in device coordinates: x right, y up, z out
// of the screen. Lying flat face up it reads about (0, 0, +9.81).

export type LevelMode = 'edge' | 'flat';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Calibration {
  edge: number; // degrees subtracted from the edge reading
  flatX: number; // degrees subtracted from the flat tilts
  flatY: number;
}

export const noCalibration = (): Calibration => ({ edge: 0, flatX: 0, flatY: 0 });

export interface Reading {
  mode: LevelMode;
  /** The angle shown: edge → angle of the screen's edge, -45..135 (near 0 or 90); flat → total tilt ≥ 0. */
  angle: number;
  /** Signed distance from the nearest level/plumb reference, in degrees. */
  deviation: number;
  /** Flat mode: tilt along the screen's x and y axes, in degrees (bubble position). */
  tiltX: number;
  tiltY: number;
}

const DEG = 180 / Math.PI;

/** Low-pass filter for the gravity vector; time-based so it behaves the same at any sensor rate. */
export class GravityFilter {
  value: Vec3 | null = null;
  tau: number;
  constructor(tau = 0.28) {
    this.tau = tau;
  }

  push(v: Vec3, dt: number): Vec3 {
    if (!this.value) return (this.value = { ...v });
    const a = 1 - Math.exp(-Math.max(0, dt) / this.tau);
    const p = this.value;
    p.x += (v.x - p.x) * a;
    p.y += (v.y - p.y) * a;
    p.z += (v.z - p.z) * a;
    return p;
  }

  reset() {
    this.value = null;
  }
}

/** Pick edge or flat with hysteresis so it doesn't flicker around 45°. */
export function detectMode(g: Vec3, previous: LevelMode): LevelMode {
  const n = Math.hypot(g.x, g.y, g.z) || 1;
  const flatness = Math.abs(g.z) / n; // 1 = lying flat, 0 = standing on an edge
  if (previous === 'flat') return flatness < 0.62 ? 'edge' : 'flat';
  return flatness > 0.78 ? 'flat' : 'edge';
}

export function read(g: Vec3, mode: LevelMode, cal: Calibration): Reading {
  if (mode === 'edge') {
    // Angle of the screen's horizontal edge, counter-clockwise positive. A line has
    // no direction, so fold into -45..135: readings land near 0 (level) or 90 (plumb).
    const raw = Math.atan2(g.x, g.y) * DEG;
    let a = ((((raw + 45) % 180) + 180) % 180) - 45;
    a -= cal.edge;
    const ref = a > 45 ? 90 : 0;
    return { mode, angle: a, deviation: a - ref, tiltX: 0, tiltY: 0 };
  }
  const tiltX = Math.atan2(g.x, g.z) * DEG - cal.flatX;
  const tiltY = Math.atan2(g.y, g.z) * DEG - cal.flatY;
  const total = Math.atan(Math.hypot(Math.tan(tiltX / DEG), Math.tan(tiltY / DEG))) * DEG;
  return { mode, angle: total, deviation: total, tiltX, tiltY };
}

/** Make the current position read as level (or plumb). */
export function calibrate(g: Vec3, mode: LevelMode, cal: Calibration): Calibration {
  const r = read(g, mode, noCalibration());
  if (mode === 'edge') return { ...cal, edge: r.deviation };
  return { ...cal, flatX: r.tiltX, flatY: r.tiltY };
}

/** How far a line at `deg` from level drifts over `distance` (same unit back). */
export function offsetAt(deg: number, distance: number): number {
  return Math.tan(deg / DEG) * distance;
}
