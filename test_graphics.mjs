import assert from 'node:assert/strict';
import { register } from 'node:module';

// Resolve extensionless TS imports (Vite style) under Node's type stripping.
register(
  `data:text/javascript,export async function resolve(s, c, next) {
    try { return await next(s, c); }
    catch (e) { if (s.startsWith('.')) return next(s + '.ts', c); throw e; }
  }`,
);

const { detectPreset, GraphicsSettings } = await import(
  './src/core/GraphicsSettings.ts'
);

// 2017 ThinkPad: Intel HD 620, 8GB, 2c/4t -> low (shadows off).
assert.equal(
  detectPreset({
    gpu: 'ANGLE (Intel, Mesa Intel(R) HD Graphics 620 (KBL GT2), OpenGL 4.6)',
    ramGb: 8,
    cores: 4,
  }),
  'low',
);
assert.equal(
  detectPreset({ gpu: 'NVIDIA GeForce GTX 1060', ramGb: 4, cores: 8 }),
  'low',
);
assert.equal(
  detectPreset({
    gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4)',
    ramGb: 8,
    cores: 10,
  }),
  'ultra',
);
assert.equal(
  detectPreset({ gpu: 'NVIDIA GeForce RTX 3060', ramGb: 8, cores: 6 }),
  'high',
);
assert.equal(
  detectPreset({ gpu: 'AMD Radeon Graphics', ramGb: 8, cores: 8 }),
  'medium',
);

// FPS cap: 30 cap on a 60Hz display renders every other frame.
const gfx = Object.create(GraphicsSettings.prototype);
gfx.opts = { fpsCap: 30 };
gfx.lastFrameMs = 0;
let rendered = 0;
for (let i = 1; i <= 60; i++)
  if (gfx.shouldRenderFrame(i * (1000 / 60))) rendered++;
assert.equal(rendered, 30, `30 cap rendered ${rendered}/60 frames`);

gfx.opts.fpsCap = 60;
rendered = 0;
for (let i = 61; i <= 120; i++)
  if (gfx.shouldRenderFrame(i * (1000 / 60))) rendered++;
assert.equal(
  rendered,
  60,
  `60 cap on 60Hz must not drop frames, got ${rendered}`,
);

console.log('graphics settings: ok');
