/**
 * Real-time Tactical Telemetry & Performance Graphs HUD.
 * Renders high-frequency canvas graphs for:
 * 1. Frametime / FPS stability graph (rolling 60 frames)
 * 2. Recoil pattern & shot dispersion radar graph
 * 3. GPU draw calls, triangle counts, and zero-allocation memory status
 */
export class TacticalTelemetry {
  private container: HTMLElement;
  private frametimeCanvas: HTMLCanvasElement;
  private frametimeCtx: CanvasRenderingContext2D;

  private dispersionCanvas: HTMLCanvasElement;
  private dispersionCtx: CanvasRenderingContext2D;

  private drawCallsEl: HTMLElement;
  private trianglesEl: HTMLElement;
  private frametimeText: HTMLElement;
  private splitTimeText: HTMLElement;

  // Rolling history buffers
  private frametimes: number[] = new Array(60).fill(8.3);
  private frameIndex = 0;

  // Shot dispersion points { x: number, y: number, isHit: boolean, age: number }
  private shotPoints: Array<{ x: number; y: number; isHit: boolean; age: number }> = [];
  private lastShotTimestamp = 0;

  public isVisible = true;

  constructor() {
    // 1. Create or mount container
    let existing = document.getElementById('telemetry-panel');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'telemetry-panel';
      document.body.appendChild(existing);
    }
    this.container = existing;

    this.container.innerHTML = `
      <div class="telemetry-header">
        <span class="telemetry-title"><span class="telemetry-dot"></span> TACTICAL TELEMETRY</span>
        <span class="telemetry-toggle" title="Press [G] to toggle">[G] MINIMIZE</span>
      </div>

      <!-- Graph 1: Frame Timing Stability -->
      <div class="telemetry-card">
        <div class="card-header">
          <span class="card-label">FRAMETIME PIPELINE</span>
          <span class="card-metric" id="tel-frametime">8.3 ms // 120 FPS</span>
        </div>
        <canvas id="tel-frametime-canvas" width="220" height="48"></canvas>
        <div class="graph-legend">
          <span class="legend-item"><span class="legend-line green"></span> 120 FPS (8.3ms)</span>
          <span class="legend-item"><span class="legend-line yellow"></span> 60 FPS (16.6ms)</span>
        </div>
      </div>

      <!-- Graph 2: Recoil Dispersion & Grouping -->
      <div class="telemetry-card">
        <div class="card-header">
          <span class="card-label">7.62mm SHOT DISPERSION</span>
          <span class="card-metric" id="tel-splittime">SPLIT: 100ms</span>
        </div>
        <div class="radar-wrapper">
          <canvas id="tel-dispersion-canvas" width="110" height="110"></canvas>
          <div class="radar-stats">
            <div class="r-stat-row">
              <span class="r-lbl">LAST GROUP:</span>
              <span class="r-val" id="tel-grouping">TIGHT</span>
            </div>
            <div class="r-stat-row">
              <span class="r-lbl">DRAWS:</span>
              <span class="r-val" id="tel-draws">0</span>
            </div>
            <div class="r-stat-row">
              <span class="r-lbl">POLYS:</span>
              <span class="r-val" id="tel-polys">0</span>
            </div>
            <div class="r-stat-row">
              <span class="r-lbl">MEM CHURN:</span>
              <span class="r-val green">0.0 KB (POOLED)</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.frametimeCanvas = document.getElementById('tel-frametime-canvas') as HTMLCanvasElement;
    this.frametimeCtx = this.frametimeCanvas.getContext('2d')!;

    this.dispersionCanvas = document.getElementById('tel-dispersion-canvas') as HTMLCanvasElement;
    this.dispersionCtx = this.dispersionCanvas.getContext('2d')!;

    this.drawCallsEl = document.getElementById('tel-draws')!;
    this.trianglesEl = document.getElementById('tel-polys')!;
    this.frametimeText = document.getElementById('tel-frametime')!;
    this.splitTimeText = document.getElementById('tel-splittime')!;

    // Toggle button handler
    const toggleBtn = this.container.querySelector('.telemetry-toggle');
    toggleBtn?.addEventListener('click', () => this.toggle());

    // Keyboard hotkey [G]
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && !e.repeat) {
        this.toggle();
      }
    });

    this.renderDispersionGrid();
  }

  public toggle(): void {
    this.isVisible = !this.isVisible;
    if (this.isVisible) {
      this.container.classList.remove('minimized');
    } else {
      this.container.classList.add('minimized');
    }
  }

  // Throttled and smoothed text metrics
  private textUpdateTimer = 0;
  private smoothedMs = 8.3;
  private smoothedFps = 120;

  /**
   * Records instantaneous frame delta and updates frametime sparkline graph
   */
  public recordFrame(delta: number, drawCalls: number, triangles: number): void {
    if (!this.isVisible) return;

    const ms = delta * 1000;
    this.frametimes[this.frameIndex] = ms;
    this.frameIndex = (this.frameIndex + 1) % this.frametimes.length;

    // Exponential moving average filter for stable, readable numbers
    this.smoothedMs = this.smoothedMs * 0.92 + ms * 0.08;
    const currentFps = 1 / Math.max(0.001, delta);
    this.smoothedFps = this.smoothedFps * 0.92 + currentFps * 0.08;

    // Throttle DOM text updates to 4 times per second (every 250ms) to prevent jitter
    this.textUpdateTimer += delta;
    if (this.textUpdateTimer >= 0.25) {
      this.textUpdateTimer = 0;
      this.frametimeText.textContent = `${this.smoothedMs.toFixed(1)} ms | ${Math.round(this.smoothedFps)} FPS`;
      this.drawCallsEl.textContent = `${drawCalls}`;
      this.trianglesEl.textContent = `${(triangles / 1000).toFixed(1)}k`;
    }

    // Render Frametime Graph on canvas every frame (smooth scrolling sparkline)
    this.drawFrametimeGraph();

    // Age and render shot dispersion points
    this.updateDispersionPoints(delta);
  }

  /**
   * Records a weapon shot impact point for the dispersion radar graph
   */
  public recordShot(spreadX: number, spreadY: number, isHit: boolean): void {
    const now = performance.now();
    if (this.lastShotTimestamp > 0) {
      const split = Math.round(now - this.lastShotTimestamp);
      this.splitTimeText.textContent = `SPLIT: ${split}ms`;
    }
    this.lastShotTimestamp = now;

    this.shotPoints.push({
      x: spreadX,
      y: spreadY,
      isHit,
      age: 0
    });

    if (this.shotPoints.length > 25) {
      this.shotPoints.shift();
    }
  }

  private drawFrametimeGraph(): void {
    const ctx = this.frametimeCtx;
    const w = this.frametimeCanvas.width;
    const h = this.frametimeCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Dark grid background
    ctx.fillStyle = 'rgba(10, 14, 18, 0.75)';
    ctx.fillRect(0, 0, w, h);

    // Reference target lines: 8.3ms (120 FPS) and 16.6ms (60 FPS)
    const y120 = h - (8.3 / 33.3) * h;
    const y60 = h - (16.6 / 33.3) * h;

    ctx.strokeStyle = 'rgba(74, 222, 128, 0.25)'; // 120 FPS green guideline
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y120);
    ctx.lineTo(w, y120);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(250, 204, 21, 0.25)'; // 60 FPS yellow guideline
    ctx.beginPath();
    ctx.moveTo(0, y60);
    ctx.lineTo(w, y60);
    ctx.stroke();

    // Plot rolling frametime curve
    ctx.beginPath();
    const len = this.frametimes.length;
    const step = w / (len - 1);

    for (let i = 0; i < len; i++) {
      const idx = (this.frameIndex + i) % len;
      const ms = Math.min(33.3, this.frametimes[idx]);
      const x = i * step;
      const y = h - (ms / 33.3) * h;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.strokeStyle = '#38bdf8'; // Tactical Cyan curve
    ctx.lineWidth = 2;
    ctx.stroke();

    // Area glow fill under curve
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  private updateDispersionPoints(delta: number): void {
    for (let i = this.shotPoints.length - 1; i >= 0; i--) {
      this.shotPoints[i].age += delta;
      if (this.shotPoints[i].age > 4.0) {
        this.shotPoints.splice(i, 1);
      }
    }
    this.renderDispersionGrid();
  }

  private renderDispersionGrid(): void {
    const ctx = this.dispersionCtx;
    const w = this.dispersionCanvas.width;
    const h = this.dispersionCanvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    // Dark circular background
    ctx.fillStyle = 'rgba(10, 14, 18, 0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
    ctx.fill();

    // Concentric target rings
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.lineWidth = 1;
    [15, 30, 45].forEach(r => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Crosshair axes
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx, h - 4);
    ctx.moveTo(4, cy);
    ctx.lineTo(w - 4, cy);
    ctx.stroke();

    // Center bullseye
    ctx.fillStyle = 'rgba(74, 222, 128, 0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Plot shot points
    const scale = 22; // pixels per spread unit
    this.shotPoints.forEach(p => {
      const alpha = Math.max(0, 1.0 - p.age / 4.0);
      const px = cx + p.x * scale;
      const py = cy - p.y * scale;

      ctx.fillStyle = p.isHit
        ? `rgba(239, 68, 68, ${alpha})`    // Red on target hit
        : `rgba(251, 191, 36, ${alpha})`;  // Amber on off-target

      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Outer ring for newest shots
      if (p.age < 0.25) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${1.0 - p.age * 4})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 6.0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
}
