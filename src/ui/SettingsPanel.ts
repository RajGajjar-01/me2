import { GRAPHICS, QUALITY_PRESETS } from '../constants/graphics';
import type {
  GraphicsOptions,
  GraphicsSettings,
} from '../core/GraphicsSettings';

type BoolKey = {
  [K in keyof GraphicsOptions]: GraphicsOptions[K] extends boolean ? K : never;
}[keyof GraphicsOptions];

const TOGGLES: Array<[BoolKey, string, string]> = [
  ['shadows', 'Shadows', 'Biggest GPU cost after resolution. Off on Low.'],
  ['softShadows', 'Soft shadows', 'Blurred shadow edges (PCF soft).'],
  [
    'dynamicResolution',
    'Dynamic resolution',
    'Lowers resolution when FPS drops below the cap.',
  ],
  ['antialias', 'Anti-aliasing (MSAA)', 'Applies after reload.'],
  [
    'rayTracing',
    'Ray tracing',
    'Press P in-game for a path-traced photo of the frame.',
  ],
  ['showFps', 'Show FPS counter', ''],
];

export class SettingsPanel {
  private root: HTMLElement;

  constructor(private gfx: GraphicsSettings) {
    this.root = document.createElement('div');
    this.root.id = 'settings-panel';
    this.root.className = 'hidden';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Graphics settings');

    const presets = Object.keys(QUALITY_PRESETS)
      .map((p) => {
        const tag = p === gfx.detectedPreset ? ' (recommended)' : '';
        return `<option value="${p}">${p.toUpperCase()}${tag}</option>`;
      })
      .join('');
    const shadowSizes = GRAPHICS.SHADOW_MAP_SIZES.map(
      (s) => `<option value="${s}">${s} px</option>`,
    ).join('');
    const caps = GRAPHICS.FPS_CAPS.map(
      (c) =>
        `<option value="${c}">${c === 0 ? 'UNLIMITED' : `${c} FPS`}</option>`,
    ).join('');
    const toggles = TOGGLES.map(
      ([key, label, hint]) => `
        <label class="set-row">
          <span><span class="set-label">${label}</span><span class="set-hint">${hint}</span></span>
          <input type="checkbox" data-key="${key}" />
        </label>`,
    ).join('');

    this.root.innerHTML = `
      <div class="settings-modal">
        <div class="settings-head">
          <span>GRAPHICS // SETTINGS</span>
          <button type="button" class="settings-close" aria-label="Close">✕</button>
        </div>
        <label class="set-row">
          <span class="set-label">Quality preset</span>
          <select data-key="preset">${presets}<option value="custom" disabled>CUSTOM</option></select>
        </label>
        <label class="set-row">
          <span><span class="set-label">Resolution scale</span><span class="set-hint" data-out="resolutionScale"></span></span>
          <input type="range" data-key="resolutionScale" min="${GRAPHICS.RESOLUTION_SCALE_MIN}" max="${GRAPHICS.RESOLUTION_SCALE_MAX}" step="${GRAPHICS.RESOLUTION_SCALE_STEP}" />
        </label>
        <label class="set-row">
          <span class="set-label">Shadow quality</span>
          <select data-key="shadowMapSize">${shadowSizes}</select>
        </label>
        <label class="set-row">
          <span class="set-label">FPS limit</span>
          <select data-key="fpsCap">${caps}</select>
        </label>
        ${toggles}
        <div class="settings-foot">DETECTED HARDWARE TIER: ${gfx.detectedPreset.toUpperCase()}</div>
      </div>`;

    document.getElementById('game-container')!.appendChild(this.root);

    this.root
      .querySelector('.settings-close')!
      .addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) this.close();
    });
    this.root.addEventListener('change', (e) => this.onInput(e));
    this.root.addEventListener('input', (e) => {
      if ((e.target as HTMLInputElement).type === 'range') this.onInput(e);
    });

    gfx.onChange = () => this.sync();
    this.sync();
  }

  public get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  public open(): void {
    this.sync();
    this.root.classList.remove('hidden');
  }

  public close(): void {
    this.root.classList.add('hidden');
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const key = el.dataset.key as keyof GraphicsOptions | undefined;
    if (!key) return;
    if (key === 'preset') {
      this.gfx.setPreset(el.value as keyof typeof QUALITY_PRESETS);
      return;
    }
    const value =
      el instanceof HTMLInputElement && el.type === 'checkbox'
        ? el.checked
        : Number(el.value);
    // FPS counter / RT / cap don't change the quality tier.
    const cosmetic =
      key === 'showFps' || key === 'rayTracing' || key === 'fpsCap';
    this.gfx.update({
      [key]: value,
      ...(cosmetic ? {} : { preset: 'custom' as const }),
    });
  }

  private sync(): void {
    const o = this.gfx.opts;
    for (const el of this.root.querySelectorAll<HTMLInputElement>(
      '[data-key]',
    )) {
      const v = o[el.dataset.key as keyof GraphicsOptions];
      if (el.type === 'checkbox') el.checked = Boolean(v);
      else el.value = String(v);
    }
    this.root.querySelector<HTMLElement>(
      '[data-out="resolutionScale"]',
    )!.textContent = `${Math.round(o.resolutionScale * 100)}%`;
    const shadowDeps = this.root.querySelectorAll<HTMLInputElement>(
      '[data-key="shadowMapSize"], [data-key="softShadows"]',
    );
    for (const el of shadowDeps) el.disabled = !o.shadows;
    document
      .getElementById('fps-metric')
      ?.classList.toggle('hidden', !o.showFps);
  }
}
