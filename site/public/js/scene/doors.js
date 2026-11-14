// Weighted door motion: the scroll timeline sets where a door should be (0 shut, 1 open);
// the door follows on an under-damped spring, so it swings with a little overshoot and settles,
// like a heavy door on its check strap. Positive rotation about Y swings the trailing edge out (+Z).

export class DoorMotion {
  constructor(pivot, maxDeg, { stiffness = 38, damping = 0.5 } = {}) {
    this.pivot = pivot;
    this.max = (maxDeg * Math.PI) / 180;
    this.k = stiffness;
    this.c = 2 * damping * Math.sqrt(stiffness);
    this.a = 0;
    this.v = 0;
  }

  /** Advances the spring toward `target` (0..1). Returns true while still moving. */
  step(target, dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = Math.min(dt, 0.1) / steps;
    for (let i = 0; i < steps; i++) {
      const acc = this.k * (target - this.a) - this.c * this.v;
      this.v += acc * h;
      this.a += this.v * h;
    }
    // Never swing back through the body.
    if (this.a < 0) { this.a = 0; this.v = Math.max(0, this.v) * 0.3; }
    this.pivot.rotation.y = this.a * this.max;
    const moving = Math.abs(target - this.a) > 0.0005 || Math.abs(this.v) > 0.0005;
    if (!moving) { this.a = target; this.v = 0; this.pivot.rotation.y = this.a * this.max; }
    return moving;
  }

  /** Jumps straight to a state (reduced motion, first frame). */
  set(target) {
    this.a = target;
    this.v = 0;
    this.pivot.rotation.y = target * this.max;
  }
}
