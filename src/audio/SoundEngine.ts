import { AUDIO, REVERB_REFLECTIONS } from '../constants/audio';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted = false;

  private samples: Map<string, AudioBuffer> = new Map();

  private voices: Map<
    string,
    { src: AudioBufferSourceNode; gain: GainNode }[]
  > = new Map();

  private static readonly MAX_VOICES = AUDIO.MAX_VOICES;

  private reverbBus: GainNode | null = null;

  private static readonly REVERB_SECONDS = AUDIO.REVERB_SECONDS;

  private static readonly REVERB_WET = AUDIO.REVERB_WET;

  private static readonly REVERB_PREDELAY = AUDIO.REVERB_PREDELAY;

  private static readonly REVERB_DECAY_EXP = AUDIO.REVERB_DECAY_EXP;

  // [ms, amplitude] — first four are the compound, last three distant terrain.
  private static readonly REVERB_REFLECTIONS = REVERB_REFLECTIONS;

  constructor() {}

  public async loadSamples(
    manifest: Record<string, string>,
    onProgress?: (status: string) => void,
  ): Promise<void> {
    const ctx = this.initContext();
    onProgress?.('LOADING LIVE-FIRE AUDIO SAMPLES...');

    await Promise.all(
      Object.entries(manifest).map(async ([name, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.samples.set(name, buf);
        } catch (err) {
          console.warn(
            `Sound sample "${name}" unavailable, using synthesized fallback:`,
            err,
          );
        }
      }),
    );
  }

  private playSample(
    name: string,
    opts: {
      gain?: number;
      rate?: number;
      detune?: number;
      levelJitter?: number;
      duckOlder?: number;
      reverb?: number;
      maxDuration?: number;
    } = {},
  ): boolean {
    const buf = this.samples.get(name);
    if (!buf) return false;

    const {
      gain = 1.0,
      rate = 1.0,
      detune = 0.0,
      levelJitter = 0.0,
      duckOlder,
      reverb = 0,
      maxDuration,
    } = opts;

    const ctx = this.initContext();
    const now = ctx.currentTime;

    const active = this.voices.get(name) ?? [];

    if (duckOlder !== undefined) {
      for (const v of active) {
        const g = v.gain;
        const current = g.gain.value;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(current, now);
        g.gain.linearRampToValueAtTime(
          Math.max(0.0001, current * duckOlder),
          now + 0.05,
        );
      }
    }

    while (active.length >= SoundEngine.MAX_VOICES) {
      const oldest = active.shift();
      try {
        oldest?.src.stop();
      } catch {}
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate + (Math.random() - 0.5) * detune;

    const g = ctx.createGain();
    g.gain.setValueAtTime(
      gain * (1 + (Math.random() - 0.5) * levelJitter),
      now,
    );

    src.connect(g);
    g.connect(ctx.destination);

    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = gain * reverb;
      src.connect(send);
      send.connect(this.getReverbBus());
    }

    src.start(now);

    if (maxDuration !== undefined) {
      const fadeStart = now + Math.max(0, maxDuration - 0.02);
      g.gain.setValueAtTime(g.gain.value, fadeStart);
      g.gain.linearRampToValueAtTime(0.0001, fadeStart + 0.02);
      src.stop(fadeStart + 0.02);
    }

    const voice = { src, gain: g };
    active.push(voice);
    this.voices.set(name, active);

    src.onended = () => {
      const list = this.voices.get(name);
      if (!list) return;
      const i = list.indexOf(voice);
      if (i !== -1) list.splice(i, 1);
    };
    return true;
  }

  public hasSample(name: string): boolean {
    return this.samples.has(name);
  }

  private getReverbBus(): GainNode {
    if (this.reverbBus) return this.reverbBus;
    const ctx = this.initContext();

    const rate = ctx.sampleRate;
    const size = Math.floor(rate * SoundEngine.REVERB_SECONDS);
    const preDelay = Math.floor(rate * SoundEngine.REVERB_PREDELAY);
    const ir = ctx.createBuffer(2, size, ctx.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;

      for (let i = preDelay; i < size; i++) {
        const t = (i - preDelay) / (size - preDelay);

        // One-pole lowpass, cutoff falling as the tail ages; /sqrt(a) restores level.
        const a = 0.72 - 0.67 * t;
        lp += (Math.random() * 2 - 1 - lp) * a;

        const build = Math.min(1, (i - preDelay) / (rate * 0.04));

        d[i] =
          (lp / Math.sqrt(a)) * build * (1 - t) ** SoundEngine.REVERB_DECAY_EXP;
      }

      for (const [ms, amp] of SoundEngine.REVERB_REFLECTIONS) {
        const at = Math.floor((rate * ms) / 1000);
        if (at < size) d[at] += amp * (ch === 0 ? 1 : -0.85);
      }
    }

    let peak = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    if (peak > 0) {
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < size; i++) d[i] /= peak;
      }
    }

    const convolver = ctx.createConvolver();
    convolver.buffer = ir;

    const wet = ctx.createGain();
    wet.gain.value = SoundEngine.REVERB_WET;

    const bus = ctx.createGain();
    bus.connect(convolver);
    convolver.connect(wet);
    wet.connect(ctx.destination);

    this.reverbBus = bus;
    return bus;
  }

  private initContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private layerSubThump(
    gain: number,
    fromHz: number,
    toHz: number,
    dur: number,
  ): void {
    const ctx = this.initContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(fromHz, now);
    osc.frequency.exponentialRampToValueAtTime(toHz, now + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur * 1.15);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur * 1.2);
  }

  private layerOutdoorTail(gain: number, dur: number, cutoffHz = 780): void {
    const ctx = this.initContext();
    const now = ctx.currentTime;

    const size = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) {
      d[i] =
        (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * dur * 0.24));
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, now);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.045);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    src.start(now);
  }

  public playRifleShot(): void {
    if (this.isMuted) return;

    if (
      this.playSample('ak47', {
        gain: 0.95,
        detune: 0.03,
        duckOlder: 0.34,
        reverb: 0.62,
      })
    )
      return;

    const ctx = this.initContext();
    const now = ctx.currentTime;

    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(155, now);
    subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.22);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(1.35, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.28);

    const crackSize = ctx.sampleRate * 0.14;
    const crackBuffer = ctx.createBuffer(1, crackSize, ctx.sampleRate);
    const crackData = crackBuffer.getChannelData(0);
    for (let i = 0; i < crackSize; i++) {
      crackData[i] =
        (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.024));
    }

    const crack = ctx.createBufferSource();
    crack.buffer = crackBuffer;

    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.setValueAtTime(1900, now);
    crackFilter.Q.setValueAtTime(1.6, now);

    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(1.15, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(ctx.destination);
    crack.start(now);

    const echoSize = ctx.sampleRate * 0.38;
    const echoBuffer = ctx.createBuffer(1, echoSize, ctx.sampleRate);
    const echoData = echoBuffer.getChannelData(0);
    for (let i = 0; i < echoSize; i++) {
      echoData[i] =
        (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.09));
    }

    const echoSource = ctx.createBufferSource();
    echoSource.buffer = echoBuffer;

    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.setValueAtTime(750, now);

    const echoGain = ctx.createGain();
    echoGain.gain.setValueAtTime(0.45, now + 0.02);
    echoGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    echoSource.connect(echoFilter);
    echoFilter.connect(echoGain);
    echoGain.connect(ctx.destination);
    echoSource.start(now + 0.02);

    this.playMechanicalClick(now + 0.012, 2800, 0.5);
    this.playMechanicalClick(now + 0.042, 950, 0.4);
  }

  public playPistolShot(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    const subOsc = ctx.createOscillator();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(140, now);
    subOsc.frequency.exponentialRampToValueAtTime(32, now + 0.1);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.75, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.12);

    const bufferSize = ctx.sampleRate * 0.06;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] =
        (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.009));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(2600, now);
    noiseFilter.Q.setValueAtTime(2.2, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.9, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);

    this.playMechanicalClick(now + 0.012, 3400, 0.4);
    this.playMechanicalClick(now + 0.038, 1800, 0.3);
  }

  private playMechanicalClick(
    time: number,
    freq: number,
    volume: number,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(200, time + 0.02);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.02);
  }

  public playWeaponEquip(weaponIndex: number): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    if (weaponIndex === 0) {
      this.playMechanicalClick(now + 0.02, 1100, 0.45);
      this.playMechanicalClick(now + 0.08, 1600, 0.6);
      this.playMechanicalClick(now + 0.18, 2400, 0.7);

      const sweepOsc = ctx.createOscillator();
      sweepOsc.type = 'sawtooth';
      sweepOsc.frequency.setValueAtTime(320, now + 0.06);
      sweepOsc.frequency.exponentialRampToValueAtTime(80, now + 0.16);

      const sweepFilter = ctx.createBiquadFilter();
      sweepFilter.type = 'bandpass';
      sweepFilter.frequency.setValueAtTime(900, now + 0.06);
      sweepFilter.Q.setValueAtTime(3.0, now + 0.06);

      const sweepGain = ctx.createGain();
      sweepGain.gain.setValueAtTime(0.28, now + 0.06);
      sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      sweepOsc.connect(sweepFilter);
      sweepFilter.connect(sweepGain);
      sweepGain.connect(ctx.destination);
      sweepOsc.start(now + 0.06);
      sweepOsc.stop(now + 0.19);
    } else {
      this.playMechanicalClick(now + 0.02, 2800, 0.4);
      this.playMechanicalClick(now + 0.1, 3600, 0.65);
      this.playMechanicalClick(now + 0.12, 1400, 0.5);

      const bell = ctx.createOscillator();
      bell.type = 'sine';
      bell.frequency.setValueAtTime(1850, now + 0.1);
      bell.frequency.exponentialRampToValueAtTime(900, now + 0.22);

      const bellGain = ctx.createGain();
      bellGain.gain.setValueAtTime(0.2, now + 0.1);
      bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      bell.connect(bellGain);
      bellGain.connect(ctx.destination);
      bell.start(now + 0.1);
      bell.stop(now + 0.23);
    }
  }

  public playShotgunShot(): void {
    if (this.isMuted) return;
    if (
      this.playSample('shotgun', {
        gain: 1.0,
        detune: 0.05,
        levelJitter: 0.16,
        duckOlder: 0.5,
        reverb: 0.58,
      })
    ) {
      this.layerSubThump(0.95, 115, 20, 0.32);
      this.layerOutdoorTail(0.38, 0.62, 620);
      return;
    }

    const ctx = this.initContext();
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, now);
    sub.frequency.exponentialRampToValueAtTime(22, now + 0.34);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(1.6, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.4);

    const size = ctx.sampleRate * 0.4;
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.055));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }

  public playMagRelease(): void {
    if (this.isMuted) return;
    const now = this.initContext().currentTime;
    this.playMechanicalClick(now, 2400, 0.35);
  }

  public playMagOut(): void {
    if (this.isMuted) return;
    const now = this.initContext().currentTime;
    this.playMechanicalClick(now, 900, 0.4);
    this.playMechanicalClick(now + 0.07, 1300, 0.22);
  }

  public playMagIn(): void {
    if (this.isMuted) return;
    const now = this.initContext().currentTime;
    this.playMechanicalClick(now, 700, 0.55);
    this.playMechanicalClick(now + 0.05, 480, 0.5);
    this.playMechanicalClick(now + 0.12, 1500, 0.3);
  }

  public playReloadCycle(): boolean {
    if (this.isMuted) return true;
    return this.playSample('reload', { gain: 0.9 });
  }

  public playFootstep(gain: number, rate = 1.0): void {
    if (this.isMuted) return;
    if (
      this.playSample('footstep', {
        gain,
        rate,
        detune: 0.12,
        levelJitter: 0.3,
      })
    )
      return;

    const ctx = this.initContext();
    const now = ctx.currentTime;

    const size = ctx.sampleRate * 0.09;
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.016));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900 * rate, now);

    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * (0.85 + Math.random() * 0.3), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    src.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    src.start(now);
  }

  public playShellDrop(): void {
    if (this.isMuted) return;
    this.playSample('shellDrop', {
      gain: 0.3 + Math.random() * 0.15,
      rate: 0.9 + Math.random() * 0.2,
      detune: 0.1,
      maxDuration: AUDIO.SHELL_DROP_MAX_DURATION_S,
    });
  }

  public playBoltRack(): void {
    if (this.isMuted) return;
    const now = this.initContext().currentTime;
    this.playMechanicalClick(now, 1500, 0.45);
    this.playMechanicalClick(now + 0.11, 2600, 0.6);
  }

  public playShellInsert(): void {
    if (this.isMuted) return;
    const now = this.initContext().currentTime;
    this.playMechanicalClick(now, 1150, 0.3);
    this.playMechanicalClick(now + 0.06, 820, 0.22);
  }

  public playPumpRack(): void {
    if (this.isMuted) return;
    const now = this.initContext().currentTime;
    this.playMechanicalClick(now, 780, 0.5);
    this.playMechanicalClick(now + 0.14, 1050, 0.62);
  }

  public playSwapSound(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;
    this.playMechanicalClick(now, 1400, 0.35);
    this.playMechanicalClick(now + 0.09, 1800, 0.4);
  }

  public playDryFire(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    this.playMechanicalClick(ctx.currentTime, 2600, 0.5);
  }

  public playTargetHit(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2800, now);
    osc.frequency.exponentialRampToValueAtTime(1900, now + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  public playBodyImpact(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.14);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.9, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);

    const size = ctx.sampleRate * 0.05;
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1200, now);
    src.connect(f);
    f.connect(ctx.destination);
    src.start(now);
  }

  public playHeadshotHit(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    [3200, 4800].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.02);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + 0.25);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.65, now + idx * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.02);
      osc.stop(now + 0.3);
    });
  }

  public playDummyReset(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    const size = ctx.sampleRate * 0.2;
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, now);
    filter.frequency.linearRampToValueAtTime(800, now + 0.2);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }
}
