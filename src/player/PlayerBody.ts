import * as THREE from 'three';
import type { PlayerController } from './PlayerController';

// Invisible humanoid: casts the player's shadow but never renders to screen
// (colorWrite off), since it sits at/near the first-person camera.
const SHADOW_MAT = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: false,
});

// Proportions match DummyManager's proven procedural humanoid (src/targets/DummyManager.ts).
const TORSO_Y = 1.15;
const HEAD_Y = 1.62;
const ARM_Y = 1.12;
const HIP_Y = 0.825; // top of legs
const LEG_LEN = 0.75;
const CROUCH_DROP = 0.42; // how far hips sink at full crouch

function part(geo: THREE.BufferGeometry): THREE.Mesh {
  const m = new THREE.Mesh(geo, SHADOW_MAT);
  m.castShadow = true;
  m.receiveShadow = false;
  m.frustumCulled = false;
  return m;
}

export class PlayerBody {
  private group = new THREE.Group();
  private upperBody = new THREE.Group();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private leftLegMesh: THREE.Mesh;
  private rightLegMesh: THREE.Mesh;

  constructor(
    scene: THREE.Scene,
    private player: PlayerController,
  ) {
    const torso = part(new THREE.BoxGeometry(0.44, 0.58, 0.24));
    torso.position.set(0, TORSO_Y - HIP_Y, 0);
    this.upperBody.add(torso);

    const head = part(new THREE.SphereGeometry(0.14, 12, 12));
    head.position.set(0, HEAD_Y - HIP_Y, 0);
    this.upperBody.add(head);

    // Arms held forward (rifle raised), not hanging at the sides.
    const armTilt = -1.1;
    this.leftArm.position.set(-0.16, ARM_Y - HIP_Y + 0.1, 0);
    this.leftArm.rotation.x = armTilt;
    const leftArmMesh = part(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 8));
    leftArmMesh.position.set(0, -0.25, 0);
    this.leftArm.add(leftArmMesh);
    this.upperBody.add(this.leftArm);

    this.rightArm.position.set(0.16, ARM_Y - HIP_Y + 0.1, 0);
    this.rightArm.rotation.x = armTilt;
    const rightArmMesh = part(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 8));
    rightArmMesh.position.set(0, -0.25, 0);
    this.rightArm.add(rightArmMesh);
    this.upperBody.add(this.rightArm);

    const rifleProxy = part(new THREE.BoxGeometry(0.07, 0.07, 0.75));
    rifleProxy.position.set(0, ARM_Y - HIP_Y + 0.05, -0.55);
    this.upperBody.add(rifleProxy);

    this.group.add(this.upperBody);

    this.leftLeg.position.set(-0.16, HIP_Y, 0);
    this.leftLegMesh = part(
      new THREE.CylinderGeometry(0.08, 0.065, LEG_LEN, 8),
    );
    this.leftLeg.add(this.leftLegMesh);
    this.group.add(this.leftLeg);

    this.rightLeg.position.set(0.16, HIP_Y, 0);
    this.rightLegMesh = part(
      new THREE.CylinderGeometry(0.08, 0.065, LEG_LEN, 8),
    );
    this.rightLeg.add(this.rightLegMesh);
    this.group.add(this.rightLeg);

    scene.add(this.group);
  }

  public update(): void {
    const player = this.player;
    const feetY = player.capsulePosition.y - player.radius;

    if (player.stance === 'prone') {
      this.group.position.set(
        player.capsulePosition.x,
        feetY + 0.15,
        player.capsulePosition.z,
      );
      this.group.rotation.set(-Math.PI / 2, player.yaw, 0);
      this.setHipDrop(CROUCH_DROP);
      return;
    }

    this.group.position.set(
      player.capsulePosition.x,
      feetY,
      player.capsulePosition.z,
    );
    this.group.rotation.set(0, player.yaw, -player.lean * 0.4);
    this.group.translateX(player.leanLateral);

    const crouchT = THREE.MathUtils.clamp(
      (1.35 - player.height) / (1.35 - 0.35),
      0,
      1,
    );
    this.setHipDrop(crouchT * CROUCH_DROP);
    this.leftLeg.rotation.x = crouchT * 0.3;
    this.rightLeg.rotation.x = crouchT * 0.3;
    this.upperBody.rotation.x = crouchT * 0.15;

    const speedSq = player.velocity.x ** 2 + player.velocity.z ** 2;
    const swing = speedSq > 0.01 ? Math.sin(player.bobTimer) * 0.5 : 0;
    this.leftLeg.rotation.x += swing;
    this.rightLeg.rotation.x -= swing;
  }

  private setHipDrop(drop: number): void {
    const legLen = LEG_LEN - drop;
    const hipY = HIP_Y - drop;

    this.upperBody.position.y = hipY;

    this.leftLeg.position.y = hipY;
    this.rightLeg.position.y = hipY;
    this.leftLegMesh.scale.y = legLen / LEG_LEN;
    this.rightLegMesh.scale.y = legLen / LEG_LEN;
    this.leftLegMesh.position.y = -legLen / 2;
    this.rightLegMesh.position.y = -legLen / 2;
  }
}
