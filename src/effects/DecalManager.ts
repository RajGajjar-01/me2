import * as THREE from 'three';

interface PooledDecal {
  group: THREE.Group;
  active: boolean;
}

interface PooledSpark {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  active: boolean;
}

/**
 * High-performance, zero-allocation impact decal and ricochet spark system.
 * Uses circular pre-allocated GPU object pools.
 */
export class DecalManager {
  private decalPool: PooledDecal[] = [];
  private decalIndex = 0;
  private readonly MAX_DECALS = 40;

  private sparkPool: PooledSpark[] = [];
  private sparkIndex = 0;
  private readonly MAX_SPARKS = 60;

  private decalMat = new THREE.MeshBasicMaterial({
    color: 0x111111,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false
  });

  private ringMat = new THREE.MeshBasicMaterial({
    color: 0x3d3530, // Scorch rim
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    depthWrite: false
  });

  private sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  private decalGeo = new THREE.CircleGeometry(0.026, 8);
  private ringGeo = new THREE.RingGeometry(0.026, 0.052, 8);
  private sparkGeo = new THREE.BoxGeometry(0.015, 0.015, 0.015);

  private readonly _up = new THREE.Vector3(0, 0, 1);

  constructor(private scene: THREE.Scene) {
    this.initPools();
  }

  private initPools(): void {
    // 1. Decal pool
    for (let i = 0; i < this.MAX_DECALS; i++) {
      const group = new THREE.Group();
      const center = new THREE.Mesh(this.decalGeo, this.decalMat);
      const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
      group.add(center, ring);
      group.visible = false;
      this.scene.add(group);

      this.decalPool.push({ group, active: false });
    }

    // 2. Spark pool
    for (let i = 0; i < this.MAX_SPARKS; i++) {
      const mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      mesh.visible = false;
      this.scene.add(mesh);

      this.sparkPool.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        active: false
      });
    }
  }

  public spawnBulletHole(point: THREE.Vector3, normal: THREE.Vector3): void {
    // 1. Place pooled Decal
    const d = this.decalPool[this.decalIndex];
    this.decalIndex = (this.decalIndex + 1) % this.MAX_DECALS;

    d.group.position.copy(point).addScaledVector(normal, 0.002);
    d.group.quaternion.setFromUnitVectors(this._up, normal);
    d.group.visible = true;
    d.active = true;

    // 2. Burst 5 pooled ricochet sparks
    for (let i = 0; i < 5; i++) {
      const s = this.sparkPool[this.sparkIndex];
      this.sparkIndex = (this.sparkIndex + 1) % this.MAX_SPARKS;

      s.mesh.position.copy(point);
      s.mesh.visible = true;

      s.velocity.set(
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4
      ).addScaledVector(normal, 3.8);

      s.life = 0.22;
      s.active = true;
    }
  }

  public update(delta: number): void {
    for (let i = 0; i < this.MAX_SPARKS; i++) {
      const s = this.sparkPool[i];
      if (!s.active) continue;

      s.life -= delta;
      s.velocity.y -= 13.0 * delta;
      s.mesh.position.addScaledVector(s.velocity, delta);

      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }
}
