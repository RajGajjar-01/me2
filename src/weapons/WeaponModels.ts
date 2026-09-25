import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HAND_MODEL_PATH } from '../constants/assets';
import { MUZZLE_FLASH } from '../constants/effects';
import { TextureGenerator } from '../utils/TextureGenerator';

export { HAND_MODEL_PATH };

export interface WeaponRig {
  root: THREE.Group;
  slideOrBolt?: THREE.Mesh | THREE.Group;
  muzzleFlash: THREE.Group;
  flashLight: THREE.PointLight;
  chamberPos: THREE.Vector3;
  muzzlePos: THREE.Vector3;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
}

export interface HandAsset {
  scene: THREE.Object3D;
  clip?: THREE.AnimationClip;
}

export class WeaponModels {
  private static akSteelMat = new THREE.MeshStandardMaterial({
    color: 0x1c1f24,
    roughness: 0.36,
    metalness: 0.88,
  });

  private static akReceiverSteelMat = new THREE.MeshStandardMaterial({
    color: 0x22262d,
    roughness: 0.42,
    metalness: 0.82,
  });

  private static akWoodMat = new THREE.MeshStandardMaterial({
    color: 0x733816,
    roughness: 0.58,
    metalness: 0.08,
  });

  private static akDarkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x5a2b10,
    roughness: 0.65,
    metalness: 0.05,
  });

  private static gloveFabricMat = new THREE.MeshStandardMaterial({
    color: 0x2a3328,
    roughness: 0.85,
    metalness: 0.05,
  });

  private static gloveArmorMat = new THREE.MeshStandardMaterial({
    color: 0x121416,
    roughness: 0.22,
    metalness: 0.75,
  });

  private static sleeveMat = new THREE.MeshStandardMaterial({
    color: 0x3d4738,
    roughness: 0.92,
    metalness: 0.02,
  });

  private static sightTritiumMat = new THREE.MeshBasicMaterial({
    color: 0x22ff55,
  });

  private static handSkinMat = new THREE.MeshStandardMaterial({
    color: 0xc9906c,
    roughness: 0.55,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  public static createRealAKRig(
    akScene: THREE.Group,
    handAsset?: HandAsset,
  ): WeaponRig {
    const root = new THREE.Group();

    akScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.castShadow = false;
        m.receiveShadow = true;
        if (m.material) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.roughness = 0.42;
          mat.metalness = 0.68;
          mat.envMapIntensity = 1.2;
          mat.needsUpdate = true;
        }
      }
    });

    akScene.scale.setScalar(0.88);
    akScene.position.z = -0.53;
    root.add(akScene);

    let leftArm: THREE.Group;
    let rightArm: THREE.Group;
    if (handAsset) {
      leftArm = new THREE.Group();
      rightArm = new THREE.Group();

      this.attachHand(
        rightArm,
        handAsset,
        false,
        new THREE.Vector3(0.03, -0.14, -0.34),
        new THREE.Euler(0, Math.PI / 2, 0.25),
      );
      this.attachHand(
        leftArm,
        handAsset,
        true,
        new THREE.Vector3(0.0, -0.085, -0.6),
        new THREE.Euler(0, -Math.PI / 2 - 0.1, -0.55),
      );
    } else {
      const arms = this.createAKArms();
      leftArm = arms.leftArm;
      rightArm = arms.rightArm;
      leftArm.visible = false;
      rightArm.visible = false;
    }
    root.add(leftArm);
    root.add(rightArm);

    const muzzlePos = new THREE.Vector3(0, 0.07, -0.97);
    const { muzzleFlash, flashLight } = this.createMuzzleFlash(muzzlePos);
    root.add(muzzleFlash);

    return {
      root,
      muzzleFlash,
      flashLight,
      chamberPos: new THREE.Vector3(0.035, 0.05, -0.02),
      muzzlePos,
      leftArm,
      rightArm,
    };
  }

  public static createRealPistolRig(
    pistolScene: THREE.Group,
    handAsset?: HandAsset,
  ): WeaponRig {
    const root = new THREE.Group();

    const toRemove: THREE.Object3D[] = [];
    pistolScene.traverse((child) => {
      if ((child as any).isLight || (child as any).isCamera) {
        toRemove.push(child);
      }
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.castShadow = false;
        m.receiveShadow = true;
        if (m.material) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.emissive.set(0x000000);
          mat.roughness = 0.38;
          mat.metalness = 0.85;
          mat.envMapIntensity = 1.0;
          mat.needsUpdate = true;
        }
      }
    });
    toRemove.forEach((c) => {
      c.parent?.remove(c);
    });

    pistolScene.position.set(0, -0.038, -0.03);
    root.add(pistolScene);

    let leftArm: THREE.Group;
    let rightArm: THREE.Group;
    if (handAsset) {
      leftArm = new THREE.Group();
      rightArm = new THREE.Group();
      this.attachHand(
        rightArm,
        handAsset,
        false,
        new THREE.Vector3(0.012, -0.06, 0.045),
        new THREE.Euler(0, Math.PI / 2, 0.2),
      );
      this.attachHand(
        leftArm,
        handAsset,
        true,
        new THREE.Vector3(-0.022, -0.07, 0.02),
        new THREE.Euler(0, -Math.PI / 2, -0.2),
      );
    } else {
      const arms = this.createPistolArms();
      leftArm = arms.leftArm;
      rightArm = arms.rightArm;
    }
    root.add(leftArm);
    root.add(rightArm);

    const muzzlePos = new THREE.Vector3(0, 0.032, -0.29);
    const { muzzleFlash, flashLight } = this.createPistolMuzzleFlash(muzzlePos);
    root.add(muzzleFlash);

    return {
      root,
      muzzleFlash,
      flashLight,
      chamberPos: new THREE.Vector3(0.015, 0.035, -0.04),
      muzzlePos,
      leftArm,
      rightArm,
    };
  }

  public static createRealShotgunRig(
    shotgunScene: THREE.Group,
    handAsset?: HandAsset,
  ): WeaponRig {
    const root = new THREE.Group();

    shotgunScene.traverse((child) => {
      const m = child as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat) {
        mat.roughness = 0.46;
        mat.metalness = 0.62;
        mat.envMapIntensity = 1.1;
        mat.needsUpdate = true;
      }
    });

    const holder = new THREE.Group();
    holder.add(shotgunScene);
    holder.scale.setScalar(0.38);
    holder.rotation.set(0, 0, -Math.PI / 2);
    holder.position.set(-0.011, 0.03, -0.36);
    root.add(holder);

    let leftArm: THREE.Group;
    let rightArm: THREE.Group;
    if (handAsset) {
      leftArm = new THREE.Group();
      rightArm = new THREE.Group();
      this.attachHand(
        rightArm,
        handAsset,
        false,
        new THREE.Vector3(0.028, -0.09, -0.386),
        new THREE.Euler(0, Math.PI / 2, 0.25),
      );
      this.attachHand(
        leftArm,
        handAsset,
        true,
        new THREE.Vector3(-0.03, -0.062, -0.64),
        new THREE.Euler(0, -Math.PI / 2, -0.25),
      );
    } else {
      const arms = this.createAKArms();
      leftArm = arms.leftArm;
      rightArm = arms.rightArm;
      leftArm.visible = false;
      rightArm.visible = false;
    }
    root.add(leftArm);
    root.add(rightArm);

    const muzzlePos = new THREE.Vector3(0, 0.045, -0.815);
    const { muzzleFlash, flashLight } = this.createMuzzleFlash(muzzlePos);
    muzzleFlash.scale.setScalar(1.35);
    root.add(muzzleFlash);

    return {
      root,
      muzzleFlash,
      flashLight,
      chamberPos: new THREE.Vector3(0.03, 0.03, -0.02),
      muzzlePos,
      leftArm,
      rightArm,
    };
  }

  public static createRifleRig(): WeaponRig {
    const root = new THREE.Group();
    const akGroup = new THREE.Group();

    const receiverGeo = new THREE.BoxGeometry(0.046, 0.075, 0.26);
    const receiver = new THREE.Mesh(receiverGeo, this.akReceiverSteelMat);
    receiver.position.set(0, 0, 0);
    akGroup.add(receiver);

    const dustCoverGeo = new THREE.CylinderGeometry(
      0.024,
      0.024,
      0.24,
      12,
      1,
      false,
      0,
      Math.PI,
    );
    dustCoverGeo.rotateZ(Math.PI / 2);
    dustCoverGeo.rotateX(Math.PI / 2);
    const dustCover = new THREE.Mesh(dustCoverGeo, this.akSteelMat);
    dustCover.position.set(0, 0.038, -0.01);
    akGroup.add(dustCover);

    const portGeo = new THREE.BoxGeometry(0.005, 0.024, 0.065);
    const port = new THREE.Mesh(portGeo, this.akSteelMat);
    port.position.set(0.024, 0.026, -0.02);
    akGroup.add(port);

    const boltCarrier = new THREE.Group();
    const handleGeo = new THREE.CylinderGeometry(0.005, 0.006, 0.038, 8);
    handleGeo.rotateZ(-Math.PI / 2.5);
    const handle = new THREE.Mesh(handleGeo, this.akSteelMat);
    handle.position.set(0.038, 0.026, -0.01);
    boltCarrier.add(handle);
    akGroup.add(boltCarrier);

    const selectorGeo = new THREE.BoxGeometry(0.004, 0.014, 0.08);
    selectorGeo.rotateX(-0.15);
    const selector = new THREE.Mesh(selectorGeo, this.akSteelMat);
    selector.position.set(0.025, -0.005, 0.04);
    akGroup.add(selector);

    const barrelGeo = new THREE.CylinderGeometry(0.011, 0.012, 0.44, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, this.akSteelMat);
    barrel.position.set(0, 0.012, -0.34);
    akGroup.add(barrel);

    const gasTubeGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 12);
    gasTubeGeo.rotateX(Math.PI / 2);
    const gasTube = new THREE.Mesh(gasTubeGeo, this.akSteelMat);
    gasTube.position.set(0, 0.036, -0.26);
    akGroup.add(gasTube);

    const gasBlockGeo = new THREE.BoxGeometry(0.026, 0.042, 0.035);
    const gasBlock = new THREE.Mesh(gasBlockGeo, this.akSteelMat);
    gasBlock.position.set(0, 0.024, -0.38);
    akGroup.add(gasBlock);

    const rodGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.38, 6);
    rodGeo.rotateX(Math.PI / 2);
    const rod = new THREE.Mesh(rodGeo, this.akSteelMat);
    rod.position.set(0, -0.005, -0.32);
    akGroup.add(rod);

    const compGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.042, 10);
    compGeo.rotateX(Math.PI / 2.3);
    const comp = new THREE.Mesh(compGeo, this.akSteelMat);
    comp.position.set(0, 0.012, -0.57);
    akGroup.add(comp);

    const lowerHgGeo = new THREE.BoxGeometry(0.044, 0.048, 0.18);
    const lowerHg = new THREE.Mesh(lowerHgGeo, this.akWoodMat);
    lowerHg.position.set(0, 0.008, -0.21);
    akGroup.add(lowerHg);

    const upperHgGeo = new THREE.CylinderGeometry(
      0.018,
      0.018,
      0.16,
      12,
      1,
      false,
      0,
      Math.PI,
    );
    upperHgGeo.rotateZ(Math.PI / 2);
    upperHgGeo.rotateX(Math.PI / 2);
    const upperHg = new THREE.Mesh(upperHgGeo, this.akWoodMat);
    upperHg.position.set(0, 0.038, -0.21);
    akGroup.add(upperHg);

    const stockGeo = new THREE.BoxGeometry(0.038, 0.11, 0.28);
    stockGeo.rotateX(-0.1);
    const stock = new THREE.Mesh(stockGeo, this.akWoodMat);
    stock.position.set(0, -0.02, 0.25);
    akGroup.add(stock);

    const buttplateGeo = new THREE.BoxGeometry(0.04, 0.115, 0.015);
    buttplateGeo.rotateX(-0.1);
    const buttplate = new THREE.Mesh(buttplateGeo, this.akSteelMat);
    buttplate.position.set(0, -0.035, 0.38);
    akGroup.add(buttplate);

    const gripGeo = new THREE.BoxGeometry(0.032, 0.11, 0.045);
    gripGeo.rotateX(-0.35);
    const grip = new THREE.Mesh(gripGeo, this.akDarkWoodMat);
    grip.position.set(0, -0.08, 0.06);
    akGroup.add(grip);

    const guardGeo = new THREE.TorusGeometry(0.022, 0.0035, 8, 12, Math.PI);
    guardGeo.rotateZ(Math.PI / 2);
    guardGeo.rotateX(Math.PI / 2);
    const guard = new THREE.Mesh(guardGeo, this.akSteelMat);
    guard.position.set(0, -0.038, 0.015);
    akGroup.add(guard);

    const trigGeo = new THREE.BoxGeometry(0.005, 0.018, 0.008);
    trigGeo.rotateX(-0.25);
    const trig = new THREE.Mesh(trigGeo, this.akSteelMat);
    trig.position.set(0, -0.035, 0.025);
    akGroup.add(trig);

    const magGroup = new THREE.Group();

    const mag1Geo = new THREE.BoxGeometry(0.03, 0.08, 0.065);
    mag1Geo.rotateX(0.12);
    const mag1 = new THREE.Mesh(mag1Geo, this.akSteelMat);
    mag1.position.set(0, -0.07, -0.04);
    magGroup.add(mag1);

    const mag2Geo = new THREE.BoxGeometry(0.03, 0.09, 0.065);
    mag2Geo.rotateX(0.32);
    const mag2 = new THREE.Mesh(mag2Geo, this.akSteelMat);
    mag2.position.set(0, -0.14, -0.065);
    magGroup.add(mag2);

    const mag3Geo = new THREE.BoxGeometry(0.03, 0.06, 0.065);
    mag3Geo.rotateX(0.5);
    const mag3 = new THREE.Mesh(mag3Geo, this.akSteelMat);
    mag3.position.set(0, -0.2, -0.1);
    magGroup.add(mag3);

    akGroup.add(magGroup);

    const rearSightGeo = new THREE.BoxGeometry(0.024, 0.018, 0.045);
    const rearSight = new THREE.Mesh(rearSightGeo, this.akSteelMat);
    rearSight.position.set(0, 0.052, -0.11);
    akGroup.add(rearSight);

    const frontTowerGeo = new THREE.BoxGeometry(0.026, 0.05, 0.025);
    const frontTower = new THREE.Mesh(frontTowerGeo, this.akSteelMat);
    frontTower.position.set(0, 0.042, -0.52);
    akGroup.add(frontTower);

    const frontBeadGeo = new THREE.SphereGeometry(0.0025, 8, 8);
    const frontBead = new THREE.Mesh(frontBeadGeo, this.sightTritiumMat);
    frontBead.position.set(0, 0.062, -0.52);
    akGroup.add(frontBead);

    root.add(akGroup);

    const { leftArm, rightArm } = this.createAKArms();
    root.add(leftArm);
    root.add(rightArm);

    const muzzlePos = new THREE.Vector3(0, 0.012, -0.6);
    const { muzzleFlash, flashLight } = this.createMuzzleFlash(muzzlePos);
    root.add(muzzleFlash);

    return {
      root,
      slideOrBolt: boltCarrier,
      muzzleFlash,
      flashLight,
      chamberPos: new THREE.Vector3(0.03, 0.026, -0.02),
      muzzlePos,
      leftArm,
      rightArm,
    };
  }

  public static createPistolRig(): WeaponRig {
    const root = new THREE.Group();
    const pistolGroup = new THREE.Group();

    const frameGeo = new THREE.BoxGeometry(0.032, 0.045, 0.185);
    const frame = new THREE.Mesh(frameGeo, this.akReceiverSteelMat);
    frame.position.set(0, 0, 0.01);
    pistolGroup.add(frame);

    const btGeo = new THREE.BoxGeometry(0.03, 0.03, 0.04);
    btGeo.rotateX(0.4);
    const bt = new THREE.Mesh(btGeo, this.akReceiverSteelMat);
    bt.position.set(0, 0.012, 0.095);
    pistolGroup.add(bt);

    const gripGeo = new THREE.BoxGeometry(0.03, 0.13, 0.048);
    gripGeo.rotateX(-0.28);
    const grip = new THREE.Mesh(gripGeo, this.akDarkWoodMat);
    grip.position.set(0, -0.075, 0.05);
    pistolGroup.add(grip);

    const guardGeo = new THREE.TorusGeometry(0.02, 0.0035, 8, 14, Math.PI);
    guardGeo.rotateZ(Math.PI / 2);
    guardGeo.rotateX(Math.PI / 2);
    const guard = new THREE.Mesh(guardGeo, this.akSteelMat);
    guard.position.set(0, -0.026, -0.01);
    pistolGroup.add(guard);

    const slideGroup = new THREE.Group();
    const slideGeo = new THREE.BoxGeometry(0.034, 0.038, 0.19);
    const slide = new THREE.Mesh(slideGeo, this.akSteelMat);
    slide.position.set(0, 0.03, 0.005);
    slideGroup.add(slide);

    const barrelGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.05, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, this.akSteelMat);
    barrel.position.set(0, 0.03, -0.1);
    slideGroup.add(barrel);

    const frontSightGeo = new THREE.BoxGeometry(0.004, 0.009, 0.008);
    const frontSight = new THREE.Mesh(frontSightGeo, this.sightTritiumMat);
    frontSight.position.set(0, 0.052, -0.08);
    slideGroup.add(frontSight);

    const rearSightL = new THREE.Mesh(frontSightGeo, this.sightTritiumMat);
    rearSightL.position.set(-0.01, 0.052, 0.088);
    slideGroup.add(rearSightL);

    const rearSightR = new THREE.Mesh(frontSightGeo, this.sightTritiumMat);
    rearSightR.position.set(0.01, 0.052, 0.088);
    slideGroup.add(rearSightR);

    pistolGroup.add(slideGroup);
    root.add(pistolGroup);

    const { leftArm, rightArm } = this.createPistolArms();
    root.add(leftArm);
    root.add(rightArm);

    const muzzlePos = new THREE.Vector3(0, 0.03, -0.13);
    const { muzzleFlash, flashLight } = this.createMuzzleFlash(muzzlePos);
    root.add(muzzleFlash);

    return {
      root,
      slideOrBolt: slideGroup,
      muzzleFlash,
      flashLight,
      chamberPos: new THREE.Vector3(0.02, 0.03, 0.01),
      muzzlePos,
      leftArm,
      rightArm,
    };
  }

  private static readonly HAND_BONE_LENGTH = 2.6131;

  private static readonly HAND_TARGET_LENGTH = 0.17;

  private static createHandInstance(
    hand: HandAsset,
    mirror: boolean,
  ): THREE.Object3D {
    const inst = cloneSkinned(hand.scene) as THREE.Object3D;
    inst.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh) {
        m.material = this.handSkinMat;
        m.castShadow = false;
        m.receiveShadow = true;
      }
    });

    inst.scale.setScalar(this.HAND_TARGET_LENGTH / this.HAND_BONE_LENGTH);

    if (hand.clip) {
      const mixer = new THREE.AnimationMixer(inst);
      mixer.clipAction(hand.clip).play();
      mixer.update(hand.clip.duration * 0.75);
    }

    inst.rotation.y = -Math.PI / 2;

    const wrapper = new THREE.Group();
    wrapper.add(inst);
    if (mirror) wrapper.rotation.z = Math.PI;

    return wrapper;
  }

  private static attachHand(
    armGroup: THREE.Group,
    hand: HandAsset,
    mirror: boolean,
    position: THREE.Vector3,
    rotation: THREE.Euler,
  ): void {
    const handInst = this.createHandInstance(hand, mirror);
    handInst.position.copy(position);

    handInst.rotation.x += rotation.x;
    handInst.rotation.y += rotation.y;
    handInst.rotation.z += rotation.z;
    armGroup.add(handInst);
  }

  private static createAKArms(): {
    leftArm: THREE.Group;
    rightArm: THREE.Group;
  } {
    const leftArm = new THREE.Group();
    const rightArm = new THREE.Group();

    const rSleeveGeo = new THREE.CylinderGeometry(0.048, 0.042, 0.34, 12);
    rSleeveGeo.rotateX(Math.PI / 2.3);
    rSleeveGeo.rotateY(0.18);
    const rSleeve = new THREE.Mesh(rSleeveGeo, this.sleeveMat);
    rSleeve.position.set(0.13, -0.18, 0.25);
    rightArm.add(rSleeve);

    const rHandGeo = new THREE.BoxGeometry(0.052, 0.065, 0.095);
    rHandGeo.rotateX(-0.35);
    const rHand = new THREE.Mesh(rHandGeo, this.gloveFabricMat);
    rHand.position.set(0.02, -0.07, 0.08);
    rightArm.add(rHand);

    const rKnuckleGeo = new THREE.BoxGeometry(0.05, 0.025, 0.04);
    rKnuckleGeo.rotateX(-0.35);
    const rKnuckle = new THREE.Mesh(rKnuckleGeo, this.gloveArmorMat);
    rKnuckle.position.set(0.025, -0.055, 0.085);
    rightArm.add(rKnuckle);

    const lSleeveGeo = new THREE.CylinderGeometry(0.048, 0.042, 0.38, 12);
    lSleeveGeo.rotateX(Math.PI / 2.6);
    lSleeveGeo.rotateY(-0.32);
    const lSleeve = new THREE.Mesh(lSleeveGeo, this.sleeveMat);
    lSleeve.position.set(-0.16, -0.16, 0.02);
    leftArm.add(lSleeve);

    const lHandGeo = new THREE.BoxGeometry(0.06, 0.055, 0.085);
    lHandGeo.rotateZ(0.3);
    const lHand = new THREE.Mesh(lHandGeo, this.gloveFabricMat);
    lHand.position.set(-0.02, -0.03, -0.21);
    leftArm.add(lHand);

    const lKnuckle = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.022, 0.045),
      this.gloveArmorMat,
    );
    lKnuckle.position.set(-0.035, -0.038, -0.21);
    leftArm.add(lKnuckle);

    return { leftArm, rightArm };
  }

  private static createPistolArms(): {
    leftArm: THREE.Group;
    rightArm: THREE.Group;
  } {
    const leftArm = new THREE.Group();
    const rightArm = new THREE.Group();

    const rSleeveGeo = new THREE.CylinderGeometry(0.046, 0.04, 0.32, 12);
    rSleeveGeo.rotateX(Math.PI / 2.2);
    rSleeveGeo.rotateY(0.12);
    const rSleeve = new THREE.Mesh(rSleeveGeo, this.sleeveMat);
    rSleeve.position.set(0.11, -0.18, 0.22);
    rightArm.add(rSleeve);

    const rHandGeo = new THREE.BoxGeometry(0.048, 0.062, 0.085);
    rHandGeo.rotateX(-0.28);
    const rHand = new THREE.Mesh(rHandGeo, this.gloveFabricMat);
    rHand.position.set(0.01, -0.06, 0.06);
    rightArm.add(rHand);

    const lSleeveGeo = new THREE.CylinderGeometry(0.046, 0.04, 0.32, 12);
    lSleeveGeo.rotateX(Math.PI / 2.3);
    lSleeveGeo.rotateY(-0.18);
    const lSleeve = new THREE.Mesh(lSleeveGeo, this.sleeveMat);
    lSleeve.position.set(-0.1, -0.19, 0.2);
    leftArm.add(lSleeve);

    const lHandGeo = new THREE.BoxGeometry(0.052, 0.062, 0.075);
    lHandGeo.rotateZ(0.2);
    const lHand = new THREE.Mesh(lHandGeo, this.gloveFabricMat);
    lHand.position.set(-0.02, -0.068, 0.05);
    leftArm.add(lHand);

    return { leftArm, rightArm };
  }

  private static createMuzzleFlash(muzzlePos: THREE.Vector3): {
    muzzleFlash: THREE.Group;
    flashLight: THREE.PointLight;
  } {
    const muzzleFlash = new THREE.Group();
    muzzleFlash.position.copy(muzzlePos);

    const flashTex = TextureGenerator.createMuzzleFlashTexture(
      MUZZLE_FLASH.FLASH_TEXTURE_RIFLE,
    );
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTex,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const p1Geo = new THREE.PlaneGeometry(
      MUZZLE_FLASH.RIFLE_PLANE,
      MUZZLE_FLASH.RIFLE_PLANE,
    );
    const p1 = new THREE.Mesh(p1Geo, flashMat);
    muzzleFlash.add(p1);

    const p2 = new THREE.Mesh(p1Geo, flashMat);
    p2.rotation.z = Math.PI / 3;
    muzzleFlash.add(p2);

    const coneGeo = new THREE.PlaneGeometry(
      MUZZLE_FLASH.RIFLE_CONE_W,
      MUZZLE_FLASH.RIFLE_CONE_H,
    );
    const p3 = new THREE.Mesh(coneGeo, flashMat);
    p3.rotation.y = Math.PI / 2;
    p3.position.z = MUZZLE_FLASH.RIFLE_CONE_Z;
    muzzleFlash.add(p3);

    const p4 = new THREE.Mesh(coneGeo, flashMat);
    p4.rotation.x = Math.PI / 2;
    p4.position.z = MUZZLE_FLASH.RIFLE_CONE_Z;
    muzzleFlash.add(p4);

    const flashLight = new THREE.PointLight(
      MUZZLE_FLASH.LIGHT_RIFLE_COLOR,
      0,
      MUZZLE_FLASH.LIGHT_RIFLE_DISTANCE,
      2,
    );
    muzzleFlash.add(flashLight);

    muzzleFlash.visible = false;
    return { muzzleFlash, flashLight };
  }

  private static createPistolMuzzleFlash(muzzlePos: THREE.Vector3): {
    muzzleFlash: THREE.Group;
    flashLight: THREE.PointLight;
  } {
    const muzzleFlash = new THREE.Group();
    muzzleFlash.position.copy(muzzlePos);

    const flashTex = TextureGenerator.createMuzzleFlashTexture(
      MUZZLE_FLASH.FLASH_TEXTURE_PISTOL,
    );
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const pGeo = new THREE.PlaneGeometry(
      MUZZLE_FLASH.PISTOL_PLANE,
      MUZZLE_FLASH.PISTOL_PLANE,
    );
    const p1 = new THREE.Mesh(pGeo, flashMat);
    muzzleFlash.add(p1);

    const p2 = new THREE.Mesh(pGeo, flashMat);
    p2.rotation.z = Math.PI / 4;
    muzzleFlash.add(p2);

    const flashLight = new THREE.PointLight(
      MUZZLE_FLASH.LIGHT_PISTOL_COLOR,
      0,
      MUZZLE_FLASH.LIGHT_PISTOL_DISTANCE,
      2,
    );
    muzzleFlash.add(flashLight);

    muzzleFlash.visible = false;
    return { muzzleFlash, flashLight };
  }
}
