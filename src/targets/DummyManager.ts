import * as THREE from 'three';
import type { SoundEngine } from '../audio/SoundEngine';
import { Hero, loadHeroAssets } from '../character/HeroModel';
import { HERO } from '../constants/character';
import { TARGETS } from '../constants/world';

export interface DummyEntity {
  id: number;
  root: THREE.Group;
  hero: Hero | null;
  headHitbox: THREE.Mesh;
  bodyHitbox: THREE.Mesh;
  legsHitbox: THREE.Mesh;

  basePos: THREE.Vector3;
  patrolSpeed?: number;
  patrolMinX?: number;
  patrolMaxX?: number;
  patrolDir?: number;

  health: number;
  maxHealth: number;
  isDead: boolean;
  respawnTimer: number;
}

// Enemies face the player spawn (+Z); patrollers face their walk direction.
const FACE_PLAYER_YAW = Math.PI;
const FACE_RIGHT_YAW = -Math.PI / 2;
const FACE_LEFT_YAW = Math.PI / 2;

export class DummyManager {
  public dummies: DummyEntity[] = [];
  public hitboxMeshes: THREE.Mesh[] = [];

  private hitMat = new THREE.MeshBasicMaterial({
    visible: false,
    side: THREE.DoubleSide,
  });

  public onDummyHit?: (
    damage: number,
    isHeadshot: boolean,
    isKill: boolean,
    hitPoint: THREE.Vector3,
    dummyId: number,
    currentHealth: number,
    maxHealth: number,
  ) => void;

  constructor(
    private scene: THREE.Scene,
    private sound: SoundEngine,
  ) {
    this.initDummies();
  }

  private initDummies(): void {
    const dummyConfigs = [
      { pos: new THREE.Vector3(3, 0, 8), name: 'CQB Front' },
      { pos: new THREE.Vector3(-6, 0, 1), name: 'Red Container Peek' },
      { pos: new THREE.Vector3(8, 0, -8), name: 'Sandbag Gunner' },
      {
        pos: new THREE.Vector3(0, 0, -20),
        name: 'Lateral Runner',
        patrol: {
          minX: -7,
          maxX: 7,
          speed: TARGETS.DUMMY_PATROL_SPEED,
        },
      },
      { pos: new THREE.Vector3(-14, 0, -18), name: 'Flank Sentry' },
      { pos: new THREE.Vector3(26, 4.2, -26), name: 'Tower Sniper' },
    ];

    dummyConfigs.forEach((cfg, idx) => {
      this.createDummy(idx, cfg.pos, cfg.patrol);
    });
  }

  private createDummy(
    id: number,
    pos: THREE.Vector3,
    patrol?: { minX: number; maxX: number; speed: number },
  ): void {
    const root = new THREE.Group();
    root.position.copy(pos);

    const headGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const headHitbox = new THREE.Mesh(headGeo, this.hitMat);
    headHitbox.position.set(0, 1.62, 0);
    headHitbox.userData = { dummyId: id, zone: 'head' };
    root.add(headHitbox);

    const bodyGeo = new THREE.BoxGeometry(0.55, 0.65, 0.32);
    const bodyHitbox = new THREE.Mesh(bodyGeo, this.hitMat);
    bodyHitbox.position.set(0, 1.1, 0);
    bodyHitbox.userData = { dummyId: id, zone: 'torso' };
    root.add(bodyHitbox);

    const legsGeo = new THREE.BoxGeometry(0.48, 0.72, 0.3);
    const legsHitbox = new THREE.Mesh(legsGeo, this.hitMat);
    legsHitbox.position.set(0, 0.42, 0);
    legsHitbox.userData = { dummyId: id, zone: 'legs' };
    root.add(legsHitbox);

    this.hitboxMeshes.push(headHitbox, bodyHitbox, legsHitbox);
    this.scene.add(root);

    this.dummies.push({
      id,
      root,
      hero: null,
      headHitbox,
      bodyHitbox,
      legsHitbox,
      basePos: pos.clone(),
      patrolSpeed: patrol?.speed,
      patrolMinX: patrol?.minX,
      patrolMaxX: patrol?.maxX,
      patrolDir: 1,
      health: TARGETS.DUMMY_MAX_HEALTH,
      maxHealth: TARGETS.DUMMY_MAX_HEALTH,
      isDead: false,
      respawnTimer: 0,
    });
  }

  public async loadCharacterModel(): Promise<void> {
    const assets = await loadHeroAssets();
    for (const dummy of this.dummies) {
      const hero = new Hero(assets);
      dummy.hero = hero;
      dummy.root.add(hero.root);
      if (dummy.patrolSpeed) {
        hero.play('Walk_Loop', 0);
      } else {
        hero.root.rotation.y = FACE_PLAYER_YAW;
        hero.play('Idle_Loop', 0);
      }
      // Desync idles so the squad doesn't breathe in lockstep.
      hero.current!.time = Math.random() * hero.current!.getClip().duration;
      hero.update(0);
    }
  }

  public registerHit(
    mesh: THREE.Mesh,
    hitPoint: THREE.Vector3,
    weaponDamage: number,
  ): {
    isHeadshot: boolean;
    isKill: boolean;
    damage: number;
  } {
    const data = mesh.userData;
    if (data.dummyId === undefined)
      return { isHeadshot: false, isKill: false, damage: 0 };

    const dummy = this.dummies[data.dummyId];
    if (dummy.isDead) return { isHeadshot: false, isKill: false, damage: 0 };

    const isHeadshot = data.zone === 'head';
    const isLegs = data.zone === 'legs';

    let damage = weaponDamage;
    if (isHeadshot) damage = TARGETS.DUMMY_HEADSHOT_DAMAGE;
    else if (isLegs)
      damage = Math.round(weaponDamage * TARGETS.DUMMY_LEGS_DAMAGE_MULT);

    dummy.health = Math.max(0, dummy.health - damage);
    const isKill = dummy.health <= 0;

    if (isKill) {
      dummy.isDead = true;
      dummy.respawnTimer = TARGETS.DUMMY_RESPAWN_S;
      // Headshots throw the body backwards; other kills collapse.
      dummy.hero?.play(
        isHeadshot ? 'Hit_Knockback' : 'Death01',
        HERO.FADE_FAST_S,
      );
      if (isHeadshot) {
        this.sound.playHeadshotHit();
      } else {
        this.sound.playBodyImpact();
      }
    } else {
      dummy.hero?.playOnce('Hit_Head');
      this.sound.playBodyImpact();
    }

    if (this.onDummyHit) {
      this.onDummyHit(
        damage,
        isHeadshot,
        isKill,
        hitPoint,
        dummy.id,
        dummy.health,
        dummy.maxHealth,
      );
    }

    return { isHeadshot, isKill, damage };
  }

  public update(delta: number): void {
    for (const dummy of this.dummies) {
      const hero = dummy.hero;
      const patrols =
        dummy.patrolSpeed !== undefined &&
        dummy.patrolMinX !== undefined &&
        dummy.patrolMaxX !== undefined;

      if (dummy.isDead) {
        dummy.respawnTimer -= delta;
        if (dummy.respawnTimer <= 0) {
          dummy.isDead = false;
          dummy.health = dummy.maxHealth;
          hero?.play(patrols ? 'Walk_Loop' : 'Idle_Loop');
          this.sound.playDummyReset();
        }
      } else if (hero) {
        // Hit reactions are one-shots; resume the base loop once they end.
        const reacting = hero.isRunning('Hit_Head');
        if (!reacting) {
          hero.play(patrols ? 'Walk_Loop' : 'Idle_Loop');
        }
        if (patrols && !reacting) {
          const dir = dummy.patrolDir ?? 1;
          dummy.root.position.x += dir * dummy.patrolSpeed! * delta;
          if (dummy.root.position.x >= dummy.patrolMaxX!) dummy.patrolDir = -1;
          else if (dummy.root.position.x <= dummy.patrolMinX!)
            dummy.patrolDir = 1;
          hero.root.rotation.y =
            dummy.patrolDir === 1 ? FACE_RIGHT_YAW : FACE_LEFT_YAW;
        }
      }

      hero?.update(delta);
    }
  }
}
