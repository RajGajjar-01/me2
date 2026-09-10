import * as THREE from 'three';

export class CombatHUD {
  private container: HTMLElement;
  private textLayer: HTMLElement;
  private targetCard: HTMLElement;
  private targetNameEl: HTMLElement;
  private targetBarFill: HTMLElement;
  private targetHpText: HTMLElement;
  private killBanner: HTMLElement;

  private targetCardTimer: number | null = null;
  private readonly projVec = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'combat-hud';

    this.container.innerHTML = `
      <div id="combat-text-layer"></div>

      <!-- Sleek Tactical Target Health Analyzer (Top Center) -->
      <div id="target-analyzer" class="analyzer-hidden">
        <div class="analyzer-header">
          <span class="analyzer-scanner-dot"></span>
          <span id="analyzer-target-name">TARGET ACQUIRED</span>
          <span id="analyzer-hp-text">100 / 100 HP</span>
        </div>
        <div class="analyzer-bar-track">
          <div id="analyzer-bar-fill" style="width: 100%;"></div>
        </div>
      </div>

      <!-- Valorant-Style Kill Banner Popup -->
      <div id="kill-banner" class="kill-banner-hidden">
        <div class="kill-skull">☠</div>
        <div class="kill-title">TARGET ELIMINATED</div>
        <div class="kill-sub">SECTOR 07 // THREAT NEUTRALIZED</div>
      </div>
    `;

    parent.appendChild(this.container);

    this.textLayer = this.container.querySelector('#combat-text-layer')!;
    this.targetCard = this.container.querySelector('#target-analyzer')!;
    this.targetNameEl = this.container.querySelector('#analyzer-target-name')!;
    this.targetBarFill = this.container.querySelector('#analyzer-bar-fill')!;
    this.targetHpText = this.container.querySelector('#analyzer-hp-text')!;
    this.killBanner = this.container.querySelector('#kill-banner')!;
  }

  public registerHit(
    damage: number,
    isHeadshot: boolean,
    isKill: boolean,
    hitPoint: THREE.Vector3,
    camera: THREE.Camera,
    dummyId: number,
    currentHp: number,
    maxHp: number,
  ): void {
    this.projVec.copy(hitPoint);
    this.projVec.project(camera);

    if (this.projVec.z < 1.0) {
      const screenX = (this.projVec.x * 0.5 + 0.5) * window.innerWidth;
      const screenY = (-(this.projVec.y * 0.5) + 0.5) * window.innerHeight;

      const spreadX = (Math.random() - 0.5) * 24;
      const spreadY = (Math.random() - 0.5) * 16;

      const numEl = document.createElement('div');
      numEl.className = `combat-float-num ${isHeadshot ? 'headshot' : 'body'}`;
      numEl.style.left = `${screenX + spreadX}px`;
      numEl.style.top = `${screenY + spreadY}px`;

      if (isHeadshot) {
        numEl.innerHTML = `<span class="crit-tag">HEADSHOT</span> <span class="dmg-val">-${damage}</span>`;
      } else {
        numEl.innerHTML = `<span class="dmg-val">-${damage}</span>`;
      }

      this.textLayer.appendChild(numEl);

      setTimeout(() => {
        if (numEl.parentNode) {
          numEl.parentNode.removeChild(numEl);
        }
      }, 750);
    }

    const targetNames = [
      'CQB FRONT DUMMY',
      'RED CONTAINER PEEK',
      'SANDBAG BUNKER GUNNER',
      'LATERAL PATROL RUNNER',
      'RIGHT FLANK SENTRY',
      'OBSERVATION TOWER SNIPER',
    ];
    const name = targetNames[dummyId] || `TACTICAL COMBATANT #${dummyId + 1}`;
    this.targetNameEl.textContent = name;

    const pct = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
    this.targetBarFill.style.width = `${pct}%`;

    if (isKill) {
      this.targetHpText.textContent = `ELIMINATED // RESPAWNING`;
      this.targetHpText.classList.add('dead');
      this.targetBarFill.style.background = '#ef4444';
      this.showKillBanner();
    } else {
      this.targetHpText.textContent = `${currentHp} / ${maxHp} HP`;
      this.targetHpText.classList.remove('dead');
      if (pct < 35) {
        this.targetBarFill.style.background = '#ef4444';
      } else if (pct < 65) {
        this.targetBarFill.style.background = '#facc15';
      } else {
        this.targetBarFill.style.background = '#00ff88';
      }
    }

    this.targetCard.classList.remove('analyzer-hidden');

    if (this.targetCardTimer) {
      window.clearTimeout(this.targetCardTimer);
    }
    this.targetCardTimer = window.setTimeout(() => {
      this.targetCard.classList.add('analyzer-hidden');
    }, 2800);
  }

  private showKillBanner(): void {
    this.killBanner.classList.remove('kill-banner-hidden');
    this.killBanner.classList.remove('animate-kill');

    void this.killBanner.offsetWidth;
    this.killBanner.classList.add('animate-kill');

    setTimeout(() => {
      this.killBanner.classList.add('kill-banner-hidden');
      this.killBanner.classList.remove('animate-kill');
    }, 1600);
  }
}
