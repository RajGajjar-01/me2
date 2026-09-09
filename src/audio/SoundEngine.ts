/**
 * Hyper-optimized, punchy tactical Web Audio engine.
 * Generates authentic Hollywood/AAA audio with deep sub-bass thump,
 * supersonic crack, mechanical action, and spatial stereo reverb.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted = false;

  constructor() {}

  private initContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Thunderous 7.62x39mm Soviet AK-47 Gunshot with Outdoor Echo Reverb
   */
  public playRifleShot(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    // 1. Visceral 7.62mm Sub-Bass Shockwave (150Hz -> 28Hz deep chest thud)
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

    // 2. High-Pressure Supersonic Muzzle Blast Crack
    const crackSize = ctx.sampleRate * 0.14;
    const crackBuffer = ctx.createBuffer(1, crackSize, ctx.sampleRate);
    const crackData = crackBuffer.getChannelData(0);
    for (let i = 0; i < crackSize; i++) {
      crackData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.024));
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

    // 3. Outdoor Open-Air Compound Echo / Reverb Tail
    const echoSize = ctx.sampleRate * 0.38;
    const echoBuffer = ctx.createBuffer(1, echoSize, ctx.sampleRate);
    const echoData = echoBuffer.getChannelData(0);
    for (let i = 0; i < echoSize; i++) {
      echoData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.09));
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

    // 4. Heavy AK-47 Steel Bolt Carrier Clack
    this.playMechanicalClick(now + 0.012, 2800, 0.5);
    this.playMechanicalClick(now + 0.042, 950, 0.4);
  }

  /**
   * Crisp 9mm Tactical Suppressed Ghost Gunshot (Valorant-style silenced pop)
   */
  public playPistolShot(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    // 1. Muted Sub Thump (Suppressed gas containment)
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

    // 2. High-frequency suppressed baffle pop & gas hiss
    const bufferSize = ctx.sampleRate * 0.06;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.009));
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

    // 3. Crisp mechanical slide blowback click
    this.playMechanicalClick(now + 0.012, 3400, 0.4);
    this.playMechanicalClick(now + 0.038, 1800, 0.3);
  }

  private playMechanicalClick(time: number, freq: number, volume: number): void {
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

  /**
   * Authentic Valorant-Style Weapon Equip Mechanical Flourish
   */
  public playWeaponEquip(weaponIndex: number): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    if (weaponIndex === 0) {
      // AK-47 Heavy Bolt Rack & Stock Lock (visceral metallic shhk-CLACK)
      this.playMechanicalClick(now + 0.02, 1100, 0.45);
      this.playMechanicalClick(now + 0.08, 1600, 0.6);
      this.playMechanicalClick(now + 0.18, 2400, 0.7);

      // Sub friction sweep
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
      // Tactical Pistol Rapid Slide Pull & Hammer Cock (snappy clik-SNAP)
      this.playMechanicalClick(now + 0.02, 2800, 0.4);
      this.playMechanicalClick(now + 0.10, 3600, 0.65);
      this.playMechanicalClick(now + 0.12, 1400, 0.5);

      // Light metallic chime
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

  public playReloadSound(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;
    this.playMechanicalClick(now, 1600, 0.4);
    this.playMechanicalClick(now + 0.5, 800, 0.6);
    this.playMechanicalClick(now + 0.55, 1200, 0.5);
    this.playMechanicalClick(now + 1.05, 2200, 0.55);
    this.playMechanicalClick(now + 1.15, 1600, 0.65);
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

  /**
   * Heavy kinetic body / ballistic dummy impact sound
   */
  public playBodyImpact(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    // 1. Low kinetic thud
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

    // 2. High-velocity impact slap
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

  /**
   * Crisp, rewarding Headshot critical elimination chime
   */
  public playHeadshotHit(): void {
    if (this.isMuted) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    // Dual high harmonic bell ping + skull crack
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

  /**
   * Mechanical pneumatic hiss when target dummy pops back up
   */
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
