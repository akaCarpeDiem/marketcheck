/**
 * Physics for the bubble map (Matter.js): bubbles float in a box with no gravity, drift gently towards the
 * middle, bump into each other and can be grabbed and thrown. The engine is loaded only when a visitor turns
 * physics on, as its own file, so the rest of the site does not carry it.
 *
 * Bubble positions live in the caller's own objects: `onFrame` copies them out of the engine every frame.
 * The loop stops by itself once everything has come to rest and starts again on the next touch.
 */
import type * as MatterNS from 'matter-js';

export type PhysNode = { key: string; x: number; y: number; r: number };

export type Physics = {
  /** Match the engine to these bubbles and this box: adds, removes and resizes bodies, moves the walls. */
  sync(nodes: PhysNode[], w: number, h: number): void;
  grab(key: string, x: number, y: number): void;
  drag(x: number, y: number): void;
  release(): void;
  /** Throw every bubble in a random direction. */
  shake(): void;
  stop(): void;
};

const WALL = 400;
/** Pull towards the middle, per unit of distance and mass. */
const PULL = 4e-7;
const STEP = 1000 / 60;

export async function createPhysics(nodesNow: () => PhysNode[], onFrame: () => void): Promise<Physics> {
  const mod = (await import('matter-js')) as unknown as { default?: typeof MatterNS } & typeof MatterNS;
  const M = (mod.default ?? mod) as typeof MatterNS;
  const engine = M.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
  const bodies = new Map<string, { body: MatterNS.Body; r: number }>();
  let walls: MatterNS.Body[] = [];
  let w = 0;
  let h = 0;
  let raf = 0;
  let stopped = false;
  let calm = 0;
  let held: { body: MatterNS.Body; dx: number; dy: number; last: { x: number; y: number } } | null = null;

  function setWalls(nw: number, nh: number): void {
    if (nw === w && nh === h && walls.length) return;
    w = nw;
    h = nh;
    if (walls.length) M.Composite.remove(engine.world, walls);
    const opt = { isStatic: true, restitution: 0.8, friction: 0 };
    walls = [
      M.Bodies.rectangle(w / 2, -WALL / 2, w + WALL * 2, WALL, opt),
      M.Bodies.rectangle(w / 2, h + WALL / 2, w + WALL * 2, WALL, opt),
      M.Bodies.rectangle(-WALL / 2, h / 2, WALL, h + WALL * 2, opt),
      M.Bodies.rectangle(w + WALL / 2, h / 2, WALL, h + WALL * 2, opt),
    ];
    M.Composite.add(engine.world, walls);
  }

  function tick(): void {
    raf = 0;
    if (stopped) return;
    if (document.hidden) {
      // No frames in a hidden tab; pick up again when it is shown.
      document.addEventListener('visibilitychange', wake, { once: true });
      return;
    }
    const cx = w / 2;
    const cy = h / 2;
    let fastest = 0;
    for (const { body } of bodies.values()) {
      if (held?.body === body) continue;
      const m = body.mass;
      M.Body.applyForce(body, body.position, { x: (cx - body.position.x) * PULL * m, y: (cy - body.position.y) * PULL * m });
      fastest = Math.max(fastest, body.speed);
    }
    M.Engine.update(engine, STEP);
    const byKey = new Map(nodesNow().map((n) => [n.key, n]));
    for (const [key, { body }] of bodies) {
      const n = byKey.get(key);
      if (!n) continue;
      // Keep every bubble inside the box even if a fast throw tunnels through a wall.
      const x = Math.max(n.r, Math.min(w - n.r, body.position.x));
      const y = Math.max(n.r, Math.min(h - n.r, body.position.y));
      if (x !== body.position.x || y !== body.position.y) M.Body.setPosition(body, { x, y });
      n.x = x;
      n.y = y;
    }
    onFrame();
    calm = fastest < 0.03 && !held ? calm + 1 : 0;
    if (calm < 90) raf = requestAnimationFrame(tick);
  }

  function wake(): void {
    calm = 0;
    if (!raf && !stopped) raf = requestAnimationFrame(tick);
  }

  return {
    sync(nodes, nw, nh) {
      setWalls(nw, nh);
      const keep = new Set(nodes.map((n) => n.key));
      for (const [key, b] of bodies) {
        if (!keep.has(key)) {
          M.Composite.remove(engine.world, b.body);
          bodies.delete(key);
        }
      }
      for (const n of nodes) {
        if (n.r < 1) continue;
        const b = bodies.get(n.key);
        if (!b) {
          const body = M.Bodies.circle(n.x, n.y, n.r, { restitution: 0.6, friction: 0.01, frictionAir: 0.03, density: 0.001 });
          bodies.set(n.key, { body, r: n.r });
          M.Composite.add(engine.world, body);
        } else if (Math.abs(b.r - n.r) > 0.5) {
          M.Body.scale(b.body, n.r / b.r, n.r / b.r);
          b.r = n.r;
        }
      }
      wake();
    },
    grab(key, x, y) {
      const b = bodies.get(key);
      if (!b) return;
      held = { body: b.body, dx: b.body.position.x - x, dy: b.body.position.y - y, last: { x, y } };
      M.Body.setVelocity(b.body, { x: 0, y: 0 });
      wake();
    },
    drag(x, y) {
      if (!held) return;
      const to = { x: x + held.dx, y: y + held.dy };
      const v = { x: x - held.last.x, y: y - held.last.y };
      M.Body.setPosition(held.body, to);
      // Carrying the pointer's speed means letting go throws the bubble.
      M.Body.setVelocity(held.body, { x: Math.max(-40, Math.min(40, v.x)), y: Math.max(-40, Math.min(40, v.y)) });
      held.last = { x, y };
      wake();
    },
    release() {
      held = null;
      wake();
    },
    shake() {
      for (const { body } of bodies.values()) {
        const a = Math.random() * Math.PI * 2;
        const s = 6 + Math.random() * 12;
        M.Body.setVelocity(body, { x: Math.cos(a) * s, y: Math.sin(a) * s });
      }
      wake();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', wake);
      M.Composite.clear(engine.world, false);
      M.Engine.clear(engine);
      bodies.clear();
    },
  };
}
