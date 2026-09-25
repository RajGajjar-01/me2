import * as THREE from 'three';
import { EFFECTS, MUZZLE_FLASH } from '../constants/effects';
import { TextureGenerator } from '../utils/TextureGenerator';

interface PooledTracer {
  mesh: THREE.Group;
  start: THREE.Vector3;
  end: THREE.Vector3;
  current: THREE.Vector3;
  dir: THREE.Vector3;
  life: number;
  speed: number;
  totalDist: number;
  active: boolean;
}

interface PooledSmoke {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  scale: number;
  life: number;
  maxLife: number;
  active: boolean;
}

interface PooledShell {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  rotVelocity: THREE.Vector3;
  life: number;
  active: boolean;
  landed: boolean;
}

export class BulletTracerManager {
  private tracerPool: PooledTracer[] = [];
  private tracerIndex = 0;
  private readonly MAX_TRACERS = EFFECTS.MAX_TRACERS;

  private smokePool: PooledSmoke[] = [];
  private smokeIndex = 0;
  private readonly MAX_SMOKE = EFFECTS.MAX_SMOKE;

  private shellPool: PooledShell[] = [];
  private shellIndex = 0;
  private readonly MAX_SHELLS = EFFECTS.MAX_SHELLS;

  private tracerTex = TextureGenerator.createTracerTexture(
    MUZZLE_FLASH.TRACER_TEXTURE,
  );
  private smokeTex = TextureGenerator.createMuzzleSmokeTexture(
    MUZZLE_FLASH.SMOKE_TEXTURE,
  );

  private tracerMat = new THREE.MeshBasicMaterial({
    map: this.tracerTex,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  private brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    roughness: 0.22,
    metalness: 0.92,
  });

  private casingGeo = new THREE.CylinderGeometry(0.006, 0.007, 0.024, 8);
  private smokeGeo = new THREE.PlaneGeometry(1, 1);
  private tracerBeamGeo = new THREE.PlaneGeometry(1.6, 0.045);

  private readonly _forward = new THREE.Vector3(0, 0, -1);
  private readonly _ejectDir = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private onShellLand?: () => void,
  ) {
    this.casingGeo.rotateZ(Math.PI / 2);
    this.tracerBeamGeo.rotateY(Math.PI / 2);

    this.initTracerPool();
    this.initSmokePool();
    this.initShellPool();
  }

  private initTracerPool(): void {
    for (let i = 0; i < this.MAX_TRACERS; i++) {
      const group = new THREE.Group();
      const q1 = new THREE.Mesh(this.tracerBeamGeo, this.tracerMat);
      const q2 = new THREE.Mesh(this.tracerBeamGeo, this.tracerMat);
      q2.rotation.z = Math.PI / 2;
      group.add(q1, q2);
      group.visible = false;
      this.scene.add(group);

      this.tracerPool.push({
        mesh: group,
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        current: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        life: 0,
        speed: EFFECTS.TRACER_SPEED,
        totalDist: 0,
        active: false,
      });
    }
  }

  private initSmokePool(): void {
    for (let i = 0; i < this.MAX_SMOKE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.smokeTex,
        transparent: true,
        opacity: EFFECTS.SMOKE_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.smokeGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);

      this.smokePool.push({
        mesh,
        material: mat,
        velocity: new THREE.Vector3(),
        scale: EFFECTS.SMOKE_SCALE,
        life: 0,
        maxLife: EFFECTS.SMOKE_LIFE_S,
        active: false,
      });
    }
  }

  private initShellPool(): void {
    for (let i = 0; i < this.MAX_SHELLS; i++) {
      const mesh = new THREE.Mesh(this.casingGeo, this.brassMat);
      mesh.visible = false;
      this.scene.add(mesh);

      this.shellPool.push({
        mesh,
        velocity: new THREE.Vector3(),
        rotVelocity: new THREE.Vector3(),
        life: 0,
        active: false,
        landed: false,
      });
    }
  }

  public spawnTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracerPool[this.tracerIndex];
    this.tracerIndex = (this.tracerIndex + 1) % this.MAX_TRACERS;

    t.start.copy(from);
    t.end.copy(to);
    t.current.copy(from);

    t.dir.subVectors(to, from);
    t.totalDist = t.dir.length();
    if (t.totalDist < EFFECTS.TRACER_MIN_DIST) return;
    t.dir.normalize();

    t.mesh.position.copy(from);
    t.mesh.quaternion.setFromUnitVectors(this._forward, t.dir);
    t.mesh.visible = true;

    t.life = EFFECTS.TRACER_LIFE_S;
    t.speed = EFFECTS.TRACER_SPEED;
    t.active = true;
  }

  public spawnMuzzleSmoke(pos: THREE.Vector3, cameraRot: THREE.Euler): void {
    const s = this.smokePool[this.smokeIndex];
    this.smokeIndex = (this.smokeIndex + 1) % this.MAX_SMOKE;

    s.mesh.position.copy(pos);
    s.mesh.rotation.copy(cameraRot);
    s.scale = EFFECTS.SMOKE_SCALE;
    s.mesh.scale.set(
      EFFECTS.SMOKE_SCALE,
      EFFECTS.SMOKE_SCALE,
      EFFECTS.SMOKE_SCALE,
    );
    s.material.opacity = EFFECTS.SMOKE_OPACITY;
    s.mesh.visible = true;

    s.velocity.set(
      (Math.random() - 0.5) * EFFECTS.SMOKE_SPREAD,
      EFFECTS.SMOKE_RISE_BASE + Math.random() * EFFECTS.SMOKE_RISE_RANDOM,
      (Math.random() - 0.5) * EFFECTS.SMOKE_SPREAD,
    );

    s.life = EFFECTS.SMOKE_LIFE_S;
    s.maxLife = EFFECTS.SMOKE_LIFE_S;
    s.active = true;
  }

  public spawnShell(chamberPos: THREE.Vector3, cameraRot: THREE.Euler): void {
    const s = this.shellPool[this.shellIndex];
    this.shellIndex = (this.shellIndex + 1) % this.MAX_SHELLS;

    s.mesh.position.copy(chamberPos);
    s.mesh.visible = true;

    this._ejectDir
      .set(
        2.0 + Math.random() * 0.9,
        1.4 + Math.random() * 0.8,
        -0.6 + Math.random() * 0.4,
      )
      .applyEuler(cameraRot);

    s.velocity.copy(this._ejectDir);
    s.rotVelocity.set(
      (Math.random() - 0.5) * 45,
      (Math.random() - 0.5) * 45,
      (Math.random() - 0.5) * 45,
    );

    s.life = 0.85;
    s.active = true;
    s.landed = false;
  }

  public getActiveCount(): { tracers: number; smoke: number; shells: number } {
    let tracers = 0,
      smoke = 0,
      shells = 0;
    for (let i = 0; i < this.MAX_TRACERS; i++)
      if (this.tracerPool[i].active) tracers++;
    for (let i = 0; i < this.MAX_SMOKE; i++)
      if (this.smokePool[i].active) smoke++;
    for (let i = 0; i < this.MAX_SHELLS; i++)
      if (this.shellPool[i].active) shells++;
    return { tracers, smoke, shells };
  }

  public update(delta: number): void {
    for (let i = 0; i < this.MAX_TRACERS; i++) {
      const t = this.tracerPool[i];
      if (!t.active) continue;

      t.life -= delta;
      t.current.addScaledVector(t.dir, t.speed * delta);
      t.mesh.position.copy(t.current);

      const traveled = t.current.distanceTo(t.start);

      if (t.life <= 0 || traveled >= t.totalDist) {
        t.active = false;
        t.mesh.visible = false;
      }
    }

    for (let i = 0; i < this.MAX_SMOKE; i++) {
      const s = this.smokePool[i];
      if (!s.active) continue;

      s.life -= delta;
      s.mesh.position.addScaledVector(s.velocity, delta);
      s.velocity.multiplyScalar(0.92);

      const progress = 1.0 - s.life / s.maxLife;
      const currentScale = s.scale + progress * 0.35;
      s.mesh.scale.set(currentScale, currentScale, currentScale);
      s.material.opacity = (1.0 - progress) * 0.45;

      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
      }
    }

    for (let i = 0; i < this.MAX_SHELLS; i++) {
      const s = this.shellPool[i];
      if (!s.active) continue;

      s.life -= delta;
      s.velocity.y -= 14.0 * delta;
      s.mesh.position.addScaledVector(s.velocity, delta);

      s.mesh.rotation.x += s.rotVelocity.x * delta;
      s.mesh.rotation.y += s.rotVelocity.y * delta;
      s.mesh.rotation.z += s.rotVelocity.z * delta;

      if (s.mesh.position.y < 0.02) {
        s.mesh.position.y = 0.02;
        s.velocity.y = -s.velocity.y * 0.35;
        s.velocity.x *= 0.6;
        s.velocity.z *= 0.6;
        s.rotVelocity.multiplyScalar(0.5);

        if (!s.landed) {
          s.landed = true;
          this.onShellLand?.();
        }
      }

      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }
}
