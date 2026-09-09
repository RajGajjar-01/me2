import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SoundEngine } from '../audio/SoundEngine';
import { MODELS } from '../assets';

export interface DummyEntity {
  id: number;
  root: THREE.Group;
  modelGroup: THREE.Group;
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

  // Ragdoll & Flinch physics
  flinchAngle: number;
  flinchVelocity: number;
  collapseProgress: number;
}

export class DummyManager {
  public dummies: DummyEntity[] = [];
  public hitboxMeshes: THREE.Mesh[] = [];

  private hitMat = new THREE.MeshBasicMaterial({
    visible: false,
    side: THREE.DoubleSide
  });

  private fallbackDummyMat = new THREE.MeshStandardMaterial({
    color: 0x3b4252, // Dark tactical urban camo
    roughness: 0.6,
    metalness: 0.2
  });

  private vestMat = new THREE.MeshStandardMaterial({
    color: 0x2e3440, // Tactical armor vest
    roughness: 0.4,
    metalness: 0.3
  });

  private helmetMat = new THREE.MeshStandardMaterial({
    color: 0x434c5e, // Ballistic helmet
    roughness: 0.3,
    metalness: 0.5
  });

  public onDummyHit?: (
    damage: number,
    isHeadshot: boolean,
    isKill: boolean,
    hitPoint: THREE.Vector3,
    dummyId: number,
    currentHealth: number,
    maxHealth: number
  ) => void;

  constructor(private scene: THREE.Scene, private sound: SoundEngine) {
    this.initDummies();
  }

  private initDummies(): void {
    const dummyConfigs = [
      { pos: new THREE.Vector3(3, 0, 8), name: 'CQB Front' },
      { pos: new THREE.Vector3(-6, 0, 1), name: 'Red Container Peek' },
      { pos: new THREE.Vector3(8, 0, -8), name: 'Sandbag Gunner' },
      { pos: new THREE.Vector3(0, 0, -20), name: 'Lateral Runner', patrol: { minX: -7, maxX: 7, speed: 2.2 } },
      { pos: new THREE.Vector3(-14, 0, -18), name: 'Flank Sentry' },
      { pos: new THREE.Vector3(26, 4.2, -26), name: 'Tower Sniper' }
    ];

    dummyConfigs.forEach((cfg, idx) => {
      this.createDummy(idx, cfg.pos, cfg.patrol);
    });
  }

  private createDummy(id: number, pos: THREE.Vector3, patrol?: { minX: number; maxX: number; speed: number }): void {
    const root = new THREE.Group();
    root.position.copy(pos);

    const modelGroup = new THREE.Group();
    root.add(modelGroup);

    // 1. Procedural Human Mannequin Geometry (initial crisp high-poly rig)
    this.buildProceduralDummy(modelGroup);

    // 2. Head Hitbox (Sphere around head at y = 1.62)
    const headGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const headHitbox = new THREE.Mesh(headGeo, this.hitMat);
    headHitbox.position.set(0, 1.62, 0);
    headHitbox.userData = { dummyId: id, zone: 'head' };
    root.add(headHitbox);

    // 3. Body / Torso Hitbox (Box around center mass at y = 1.1)
    const bodyGeo = new THREE.BoxGeometry(0.55, 0.65, 0.32);
    const bodyHitbox = new THREE.Mesh(bodyGeo, this.hitMat);
    bodyHitbox.position.set(0, 1.1, 0);
    bodyHitbox.userData = { dummyId: id, zone: 'torso' };
    root.add(bodyHitbox);

    // 4. Legs Hitbox (Box around lower limbs at y = 0.42)
    const legsGeo = new THREE.BoxGeometry(0.48, 0.72, 0.3);
    const legsHitbox = new THREE.Mesh(legsGeo, this.hitMat);
    legsHitbox.position.set(0, 0.42, 0);
    legsHitbox.userData = { dummyId: id, zone: 'legs' };
    root.add(legsHitbox);

    this.hitboxMeshes.push(headHitbox, bodyHitbox, legsHitbox);
    this.scene.add(root);

    const dummy: DummyEntity = {
      id,
      root,
      modelGroup,
      headHitbox,
      bodyHitbox,
      legsHitbox,
      basePos: pos.clone(),
      patrolSpeed: patrol?.speed,
      patrolMinX: patrol?.minX,
      patrolMaxX: patrol?.maxX,
      patrolDir: 1,
      health: 100,
      maxHealth: 100,
      isDead: false,
      respawnTimer: 0,
      flinchAngle: 0,
      flinchVelocity: 0,
      collapseProgress: 0
    };

    this.dummies.push(dummy);
  }

  private buildProceduralDummy(group: THREE.Group): void {
    // Torso (Camouflage BDU)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.58, 0.24), this.fallbackDummyMat);
    torso.position.set(0, 1.15, 0);
    torso.castShadow = true;
    group.add(torso);

    // Tactical Kevlar Vest over chest
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.28), this.vestMat);
    vest.position.set(0, 1.2, 0);
    vest.castShadow = true;
    group.add(vest);

    // Head / Balaclava
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), this.fallbackDummyMat);
    head.position.set(0, 1.62, 0);
    head.castShadow = true;
    group.add(head);

    // Ballistic Combat Helmet
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.7),
      this.helmetMat
    );
    helmet.position.set(0, 1.66, 0);
    helmet.castShadow = true;
    group.add(helmet);

    // Goggles / Visor
    const goggles = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.05, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 })
    );
    goggles.position.set(0, 1.63, 0.12);
    group.add(goggles);

    // Arms
    const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.55, 8), this.fallbackDummyMat);
    lArm.position.set(-0.28, 1.12, 0);
    lArm.castShadow = true;
    group.add(lArm);

    const rArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.55, 8), this.fallbackDummyMat);
    rArm.position.set(0.28, 1.12, 0);
    rArm.castShadow = true;
    group.add(rArm);

    // Legs & Combat Boots
    const lLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.065, 0.75, 8), this.fallbackDummyMat);
    lLeg.position.set(-0.13, 0.45, 0);
    lLeg.castShadow = true;
    group.add(lLeg);

    const rLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.065, 0.75, 8), this.fallbackDummyMat);
    rLeg.position.set(0.13, 0.45, 0);
    rLeg.castShadow = true;
    group.add(rLeg);
  }

  /**
   * Asynchronously loads imported 3D human character GLB and upgrades dummy models
   */
  public async loadCharacterModel(): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(MODELS.character);

      // Compute bounding box and normalize scale to 1.8m
      const bbox = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const targetHeight = 1.8;
      const scale = targetHeight / Math.max(0.1, size.y);

      // Enhance material response & shadows
      gltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });

      // Replace procedural dummies with high-detail 3D characters
      this.dummies.forEach((dummy) => {
        const cloned = SkeletonUtils.clone(gltf.scene);
        cloned.scale.set(scale, scale, scale);
        cloned.position.set(0, -bbox.min.y * scale, 0);

        // Clear procedural meshes and add 3D character model
        while (dummy.modelGroup.children.length > 0) {
          dummy.modelGroup.remove(dummy.modelGroup.children[0]);
        }
        dummy.modelGroup.add(cloned);
      });
    } catch (err) {
      console.warn('Using procedural tactical combat dummies fallback:', err);
    }
  }

  /**
   * Registers bullet impact on human combat dummy with hitzone damage and reactions
   */
  public registerHit(mesh: THREE.Mesh, hitPoint: THREE.Vector3, weaponDamage: number): {
    isHeadshot: boolean;
    isKill: boolean;
    damage: number;
  } {
    const data = mesh.userData;
    if (data.dummyId === undefined) return { isHeadshot: false, isKill: false, damage: 0 };

    const dummy = this.dummies[data.dummyId];
    if (dummy.isDead) return { isHeadshot: false, isKill: false, damage: 0 };

    const isHeadshot = data.zone === 'head';
    const isLegs = data.zone === 'legs';

    let damage = weaponDamage;
    if (isHeadshot) damage = 100; // Instant headshot elimination
    else if (isLegs) damage = Math.round(weaponDamage * 0.6);

    dummy.health = Math.max(0, dummy.health - damage);
    const isKill = dummy.health <= 0;

    // Flinch impulse
    dummy.flinchVelocity = -8.0;

    if (isKill) {
      dummy.isDead = true;
      dummy.respawnTimer = 3.5;
      if (isHeadshot) {
        this.sound.playHeadshotHit();
      } else {
        this.sound.playBodyImpact();
      }
    } else {
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
        dummy.maxHealth
      );
    }

    return { isHeadshot, isKill, damage };
  }

  public update(delta: number): void {
    const springStiffness = 95;
    const damping = 12;

    this.dummies.forEach((dummy) => {
      // 1. Lateral Patrol Movement
      if (dummy.patrolSpeed && dummy.patrolMinX !== undefined && dummy.patrolMaxX !== undefined && !dummy.isDead) {
        dummy.root.position.x += (dummy.patrolDir || 1) * dummy.patrolSpeed * delta;
        if (dummy.root.position.x >= dummy.patrolMaxX) {
          dummy.patrolDir = -1;
        } else if (dummy.root.position.x <= dummy.patrolMinX) {
          dummy.patrolDir = 1;
        }
      }

      // 2. Dead / Collapse Physics & Respawn
      if (dummy.isDead) {
        dummy.respawnTimer -= delta;

        // Smoothly collapse backwards to the ground
        dummy.collapseProgress = Math.min(1.0, dummy.collapseProgress + delta * 3.5);
        dummy.modelGroup.rotation.x = -dummy.collapseProgress * (Math.PI / 2.1);
        dummy.modelGroup.position.y = -dummy.collapseProgress * 0.45;

        if (dummy.respawnTimer <= 0) {
          // Pneumatic Reset
          dummy.isDead = false;
          dummy.health = dummy.maxHealth;
          dummy.collapseProgress = 0;
          dummy.modelGroup.rotation.x = 0;
          dummy.modelGroup.position.y = 0;
          dummy.flinchAngle = 0;
          dummy.flinchVelocity = 0;
          this.sound.playDummyReset();
        }
      } else {
        // 3. Flinch spring recovery
        dummy.flinchVelocity += (-dummy.flinchAngle * springStiffness - dummy.flinchVelocity * damping) * delta;
        dummy.flinchAngle += dummy.flinchVelocity * delta;
        dummy.modelGroup.rotation.x = dummy.flinchAngle;
      }
    });
  }
}
