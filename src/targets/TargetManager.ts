import * as THREE from 'three';
import type { SoundEngine } from '../audio/SoundEngine';
import { TARGETS } from '../constants/world';

export interface TargetEntity {
  group: THREE.Group;
  plate: THREE.Mesh;
  stand: THREE.Mesh;
  hitbox: THREE.Box3;
  targetPos: THREE.Vector3;
  hingeAngle: number;
  hingeVelocity: number;
  isHit: boolean;
  score: number;
}

export class TargetManager {
  public targets: TargetEntity[] = [];
  public targetMeshes: THREE.Mesh[] = [];
  public totalHits = 0;

  private targetSteelMat = new THREE.MeshStandardMaterial({
    color: 0xdedede,
    roughness: 0.35,
    metalness: 0.85,
  });

  private bullseyeMat = new THREE.MeshStandardMaterial({
    color: 0xd62828,
    roughness: 0.4,
    metalness: 0.5,
  });

  private standMat = new THREE.MeshStandardMaterial({
    color: 0x1f2328,
    roughness: 0.6,
    metalness: 0.7,
  });

  public onScoreUpdate?: (hits: number, points: number) => void;

  constructor(
    private scene: THREE.Scene,
    private sound: SoundEngine,
  ) {
    this.spawnTargetCourse();
  }

  private spawnTargetCourse(): void {
    const positions = [
      new THREE.Vector3(-4, 0, 10),
      new THREE.Vector3(4, 0, 8),
      new THREE.Vector3(-10, 0, -4),
      new THREE.Vector3(12, 0, -6),
      new THREE.Vector3(0, 0, -18),
      new THREE.Vector3(-16, 0, -22),
      new THREE.Vector3(26, 4.5, -26),
    ];

    positions.forEach((pos, i) => {
      this.createSteelTarget(pos, i);
    });
  }

  private createSteelTarget(pos: THREE.Vector3, index: number): void {
    const group = new THREE.Group();
    group.position.copy(pos);

    const standGroup = new THREE.Group();
    const baseGeo = new THREE.BoxGeometry(0.8, 0.05, 0.6);
    const base = new THREE.Mesh(baseGeo, this.standMat);
    base.position.set(0, 0.025, 0);
    standGroup.add(base);

    const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8);
    const pole = new THREE.Mesh(poleGeo, this.standMat);
    pole.position.set(0, 0.6, 0);
    standGroup.add(pole);

    group.add(standGroup);

    const plateHinge = new THREE.Group();
    plateHinge.position.set(0, 1.2, 0);

    const torsoGeo = new THREE.BoxGeometry(0.45, 0.65, 0.02);
    const torso = new THREE.Mesh(torsoGeo, this.targetSteelMat);
    torso.position.set(0, 0.32, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;
    plateHinge.add(torso);

    const headGeo = new THREE.BoxGeometry(0.22, 0.22, 0.02);
    const head = new THREE.Mesh(headGeo, this.bullseyeMat);
    head.position.set(0, 0.74, 0);
    head.castShadow = true;
    plateHinge.add(head);

    const ringGeo = new THREE.RingGeometry(0.04, 0.1, 16);
    const ring = new THREE.Mesh(ringGeo, this.bullseyeMat);
    ring.position.set(0, 0.32, 0.012);
    plateHinge.add(ring);

    group.add(plateHinge);
    this.scene.add(group);

    torso.userData = { targetIndex: index, isHead: false };
    head.userData = { targetIndex: index, isHead: true };
    this.targetMeshes.push(torso, head);

    this.targets.push({
      group,
      plate: torso,
      stand: base,
      hitbox: new THREE.Box3().setFromObject(group),
      targetPos: pos,
      hingeAngle: 0,
      hingeVelocity: 0,
      isHit: false,
      score: 0,
    });
  }

  public registerHit(
    mesh: THREE.Mesh,
    hitPoint: THREE.Vector3,
  ): { isHead: boolean; points: number } {
    const data = mesh.userData;
    if (data.targetIndex === undefined) return { isHead: false, points: 0 };

    const target = this.targets[data.targetIndex];
    const isHead = !!data.isHead;
    const points = isHead ? TARGETS.HEAD_POINTS : TARGETS.BODY_POINTS;

    target.hingeVelocity = TARGETS.HINGE_VELOCITY_ON_HIT;
    this.totalHits++;

    this.sound.playTargetHit();

    if (this.onScoreUpdate) {
      this.onScoreUpdate(this.totalHits, points);
    }

    return { isHead, points };
  }

  public update(delta: number): void {
    const stiffness = TARGETS.HINGE_STIFFNESS;
    const damping = TARGETS.HINGE_DAMPING;

    this.targets.forEach((t) => {
      const hinge = t.group.children[1] as THREE.Group;
      if (hinge) {
        t.hingeVelocity +=
          (-t.hingeAngle * stiffness - t.hingeVelocity * damping) * delta;
        t.hingeAngle += t.hingeVelocity * delta;

        t.hingeAngle = Math.max(
          TARGETS.HINGE_MIN,
          Math.min(TARGETS.HINGE_MAX, t.hingeAngle),
        );
        hinge.rotation.x = t.hingeAngle;
      }
    });
  }
}
