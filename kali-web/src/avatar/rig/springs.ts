/** Critically damped spring (exact solution): no overshoot, frame-rate independent. */
export interface Spring { x: number; v: number }

export function stepSpring(s: Spring, target: number, omega: number, dt: number): void {
  const d = s.x - target;
  const e = Math.exp(-omega * dt);
  const t = (s.v + omega * d) * dt;
  s.x = target + (d + t) * e;
  s.v = (s.v - omega * t) * e;
}

export function isSettled(s: Spring, target: number, eps = 0.002): boolean {
  return Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 4;
}
