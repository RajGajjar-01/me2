import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { TextureGenerator } from '../utils/TextureGenerator';

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

/**
 * A loaded hand GLB, handed in from WeaponManager once so every rig can clone it
 * rather than re-fetching. `clip` is the model's own grasp animation, if it has one.
 */
export interface HandAsset {
  scene: THREE.Object3D;
  clip?: THREE.AnimationClip;
}

// TODO: move to src/assets.ts — off-limits for this change (owned by another agent).
// Source: https://www.get3dmodels.com/anatomy/rigged-hand/ (mirrors J-Toastie's
// "Rigged Fps Arms" hand, also listed on poly.pizza). CC-BY licence — credit J-Toastie.
// Rigged (20 finger joints), 1 grasp animation clip, ~89KB, no textures (flat PBR).
export const HAND_MODEL_PATH = '/models/hands/rigged_hand.glb';

export class WeaponModels {
  // Advanced PBR Materials
  private static akSteelMat = new THREE.MeshStandardMaterial({
    color: 0x1c1f24, // Stamped Russian blued steel
    roughness: 0.36,
    metalness: 0.88
  });

  private static akReceiverSteelMat = new THREE.MeshStandardMaterial({
    color: 0x22262d,
    roughness: 0.42,
    metalness: 0.82
  });

  private static akWoodMat = new THREE.MeshStandardMaterial({
    color: 0x733816, // Soviet Russian laminated birch / cherry wood
    roughness: 0.58,
    metalness: 0.08
  });

  private static akDarkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x5a2b10,
    roughness: 0.65,
    metalness: 0.05
  });

  private static gloveFabricMat = new THREE.MeshStandardMaterial({
    color: 0x2a3328, // Tactical olive
    roughness: 0.85,
    metalness: 0.05
  });

  private static gloveArmorMat = new THREE.MeshStandardMaterial({
    color: 0x121416, // Carbon-fiber knuckle plates
    roughness: 0.22,
    metalness: 0.75
  });

  private static sleeveMat = new THREE.MeshStandardMaterial({
    color: 0x3d4738, // Multicam combat sleeve
    roughness: 0.92,
    metalness: 0.02
  });

  private static sightTritiumMat = new THREE.MeshBasicMaterial({
    color: 0x22ff55
  });

  // The source hand GLB ships untextured (flat grey) — tint it a plausible skin
  // tone. DoubleSide because the mirrored (left) hand instance flips triangle
  // winding via a negative X scale.
  private static handSkinMat = new THREE.MeshStandardMaterial({
    color: 0xc9906c,
    roughness: 0.55,
    metalness: 0.0,
    side: THREE.DoubleSide
  });

  /**
   * Builds the Authentic 3D Real AK-47 Rig using imported photorealistic GLB asset.
   * Seamlessly binds tactical operator hands, calibrated ADS sightline, and muzzle VFX.
   */
  public static createRealAKRig(akScene: THREE.Group, handAsset?: HandAsset): WeaponRig {
    const root = new THREE.Group();

    // Enable high-definition shadows and refine PBR material response
    akScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.castShadow = true;
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

    // The GLB is a full-size 1m rifle whose origin is its centre, so the stock butt
    // sits at +0.5 on Z. Left there it ends up behind the camera at ADS and the mesh
    // gets sliced open by the near plane; shifted forward at full size it clears the
    // plane but the stock then fills half the screen at hipfire. So it is scaled up
    // for a tighter, more-in-frame FPV hipfire read and set back further than before
    // to compensate — the bigger scale is what makes it read as "zoomed in", not
    // proximity to the eye, which keeps the near-plane margin intact.
    akScene.scale.setScalar(0.88);
    akScene.position.z = -0.53;
    root.add(akScene);

    // Real hands wrap the grip and handguard when the hand GLB loaded; otherwise
    // fall back to the old procedural block-glove arms (built either way so the
    // reload animation always has something to drive).
    let leftArm: THREE.Group;
    let rightArm: THREE.Group;
    if (handAsset) {
      leftArm = new THREE.Group();
      rightArm = new THREE.Group();
      // Right hand on the pistol grip (just behind the magwell); left hand under
      // the handguard/forend. Estimated from the AK's raw bounding box and typical
      // AK layout (this GLB has no named sub-parts to anchor to directly).
      this.attachHand(rightArm, handAsset, false, new THREE.Vector3(0.011, -0.066, -0.477), 0, 0.16);
      this.attachHand(leftArm, handAsset, true, new THREE.Vector3(-0.004, -0.026, -0.776), Math.PI / 2, 0.18);
    } else {
      const arms = this.createAKArms();
      leftArm = arms.leftArm;
      rightArm = arms.rightArm;
      leftArm.visible = false;
      rightArm.visible = false;
    }
    root.add(leftArm);
    root.add(rightArm);

    // Muzzle flash positioned at barrel tip
    const muzzlePos = new THREE.Vector3(0, 0.070, -0.97); // barrel tip after scale + shift
    const { muzzleFlash, flashLight } = this.createMuzzleFlash(muzzlePos);
    root.add(muzzleFlash);

    return {
      root,
      muzzleFlash,
      flashLight,
      chamberPos: new THREE.Vector3(0.035, 0.05, -0.02),
      muzzlePos,
      leftArm,
      rightArm
    };
  }

  /**
   * Builds the Authentic 3D Real Tactical Silenced Ghost Sidearm Rig using imported GLB asset.
   * Calibrates tactical two-handed grip, suppressed muzzle alignment, and matte PBR finishes.
   */
  public static createRealPistolRig(pistolScene: THREE.Group, handAsset?: HandAsset): WeaponRig {
    const root = new THREE.Group();

    // Clean up Blender camera and light nodes
    const toRemove: THREE.Object3D[] = [];
    pistolScene.traverse((child) => {
      if ((child as any).isLight || (child as any).isCamera) {
        toRemove.push(child);
      }
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        if (m.material) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.emissive.set(0x000000); // disable Blender 1,1,1 emissive
          mat.roughness = 0.38;
          mat.metalness = 0.85;
          mat.envMapIntensity = 1.0;
          mat.needsUpdate = true;
        }
      }
    });
    toRemove.forEach((c) => c.parent?.remove(c));

    // Align pistol model in operator grip (pointing forward along -Z)
    pistolScene.position.set(0, -0.038, -0.03);
    root.add(pistolScene);

    // Real hands, or the procedural block-glove fallback at the same anchor points.
    let leftArm: THREE.Group;
    let rightArm: THREE.Group;
    if (handAsset) {
      leftArm = new THREE.Group();
      rightArm = new THREE.Group();
      this.attachHand(rightArm, handAsset, false, new THREE.Vector3(0.01, -0.06, 0.06), 0, 0.15);
      this.attachHand(leftArm, handAsset, true, new THREE.Vector3(-0.02, -0.068, 0.05), Math.PI / 2, 0.16);
    } else {
      const arms = this.createPistolArms();
      leftArm = arms.leftArm;
      rightArm = arms.rightArm;
    }
    root.add(leftArm);
    root.add(rightArm);

    // Suppressed Muzzle tip position at the end of the barrel silencer
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
      rightArm
    };
  }

  /**
   * Builds the Authentic 3D Double-Barrel Breaching Shotgun Rig from the imported GLB asset.
   * The source model ships ~2.07m long on its local Z, so it is scaled and re-oriented
   * inside a holder group to sit in the operator's two-handed grip pointing down -Z.
   */
  public static createRealShotgunRig(shotgunScene: THREE.Group, handAsset?: HandAsset): WeaponRig {
    const root = new THREE.Group();

    shotgunScene.traverse((child) => {
      const m = child as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat) {
        mat.roughness = 0.46;
        mat.metalness = 0.62;
        mat.envMapIntensity = 1.1;
        mat.needsUpdate = true;
      }
    });

    // Holder normalizes the asset. The source model is authored lying on its side —
    // its local +X is the gun's "up" and its barrels already run down -Z — so a single
    // -90° roll about Z stands it upright without disturbing the barrel axis.
    const holder = new THREE.Group();
    holder.add(shotgunScene);
    holder.scale.setScalar(0.38);
    holder.rotation.set(0, 0, -Math.PI / 2);
    holder.position.set(-0.011, 0.03, -0.36); // keeps the butt in front of the near plane
    root.add(holder);

    // Real hands at the same grip/forend anchors used for the AK (both rigs share
    // similar proportions), or the procedural fallback hidden as before.
    let leftArm: THREE.Group;
    let rightArm: THREE.Group;
    if (handAsset) {
      leftArm = new THREE.Group();
      rightArm = new THREE.Group();
      this.attachHand(rightArm, handAsset, false, new THREE.Vector3(0.011, -0.066, -0.477), 0, 0.16);
      this.attachHand(leftArm, handAsset, true, new THREE.Vector3(-0.004, -0.026, -0.776), Math.PI / 2, 0.18);
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
    muzzleFlash.scale.setScalar(1.35); // 12ga blast is noticeably fatter than 7.62
    root.add(muzzleFlash);

    return {
      root,
      muzzleFlash,
      flashLight,
      chamberPos: new THREE.Vector3(0.03, 0.03, -0.02),
      muzzlePos,
      leftArm,
      rightArm
    };
  }

  /**
   * Procedural fallback rig for AK-47
   */
  public static createRifleRig(): WeaponRig {
    const root = new THREE.Group();
    const akGroup = new THREE.Group();

    // 1. Stamped Steel Receiver (Square box with distinct profile)
    const receiverGeo = new THREE.BoxGeometry(0.046, 0.075, 0.26);
    const receiver = new THREE.Mesh(receiverGeo, this.akReceiverSteelMat);
    receiver.position.set(0, 0, 0);
    akGroup.add(receiver);

    // Ribbed Dust Cover on Top of Receiver
    const dustCoverGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.24, 12, 1, false, 0, Math.PI);
    dustCoverGeo.rotateZ(Math.PI / 2);
    dustCoverGeo.rotateX(Math.PI / 2);
    const dustCover = new THREE.Mesh(dustCoverGeo, this.akSteelMat);
    dustCover.position.set(0, 0.038, -0.01);
    akGroup.add(dustCover);

    // Ejection Port & Bolt Carrier on Right Side
    const portGeo = new THREE.BoxGeometry(0.005, 0.024, 0.065);
    const port = new THREE.Mesh(portGeo, this.akSteelMat);
    port.position.set(0.024, 0.026, -0.02);
    akGroup.add(port);

    // Reciprocating Curved Charging Handle
    const boltCarrier = new THREE.Group();
    const handleGeo = new THREE.CylinderGeometry(0.005, 0.006, 0.038, 8);
    handleGeo.rotateZ(-Math.PI / 2.5);
    const handle = new THREE.Mesh(handleGeo, this.akSteelMat);
    handle.position.set(0.038, 0.026, -0.01);
    boltCarrier.add(handle);
    akGroup.add(boltCarrier);

    // Fire Selector Lever (Right side)
    const selectorGeo = new THREE.BoxGeometry(0.004, 0.014, 0.08);
    selectorGeo.rotateX(-0.15);
    const selector = new THREE.Mesh(selectorGeo, this.akSteelMat);
    selector.position.set(0.025, -0.005, 0.04);
    akGroup.add(selector);

    // 2. Main Barrel & Gas Tube
    // Main Barrel (Lower)
    const barrelGeo = new THREE.CylinderGeometry(0.011, 0.012, 0.44, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, this.akSteelMat);
    barrel.position.set(0, 0.012, -0.34);
    akGroup.add(barrel);

    // Gas Piston Tube (Upper cylinder above barrel)
    const gasTubeGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 12);
    gasTubeGeo.rotateX(Math.PI / 2);
    const gasTube = new THREE.Mesh(gasTubeGeo, this.akSteelMat);
    gasTube.position.set(0, 0.036, -0.26);
    akGroup.add(gasTube);

    // Gas Block (Angled collar joining barrel and gas tube)
    const gasBlockGeo = new THREE.BoxGeometry(0.026, 0.042, 0.035);
    const gasBlock = new THREE.Mesh(gasBlockGeo, this.akSteelMat);
    gasBlock.position.set(0, 0.024, -0.38);
    akGroup.add(gasBlock);

    // Cleaning Rod (mounted under barrel)
    const rodGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.38, 6);
    rodGeo.rotateX(Math.PI / 2);
    const rod = new THREE.Mesh(rodGeo, this.akSteelMat);
    rod.position.set(0, -0.005, -0.32);
    akGroup.add(rod);

    // Slanted AKM Muzzle Compensator
    const compGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.042, 10);
    compGeo.rotateX(Math.PI / 2.3); // Characteristic slash cut!
    const comp = new THREE.Mesh(compGeo, this.akSteelMat);
    comp.position.set(0, 0.012, -0.57);
    akGroup.add(comp);

    // 3. Wooden Handguard & Upper Handguard
    // Lower Wooden Handguard
    const lowerHgGeo = new THREE.BoxGeometry(0.044, 0.048, 0.18);
    const lowerHg = new THREE.Mesh(lowerHgGeo, this.akWoodMat);
    lowerHg.position.set(0, 0.008, -0.21);
    akGroup.add(lowerHg);

    // Upper Wooden Handguard (Cylindrical cover over gas tube)
    const upperHgGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.16, 12, 1, false, 0, Math.PI);
    upperHgGeo.rotateZ(Math.PI / 2);
    upperHgGeo.rotateX(Math.PI / 2);
    const upperHg = new THREE.Mesh(upperHgGeo, this.akWoodMat);
    upperHg.position.set(0, 0.038, -0.21);
    akGroup.add(upperHg);

    // 4. Iconic Fixed Wooden Buttstock
    const stockGeo = new THREE.BoxGeometry(0.038, 0.11, 0.28);
    stockGeo.rotateX(-0.1); // Angled downward stock line
    const stock = new THREE.Mesh(stockGeo, this.akWoodMat);
    stock.position.set(0, -0.02, 0.25);
    akGroup.add(stock);

    // Steel Buttplate
    const buttplateGeo = new THREE.BoxGeometry(0.04, 0.115, 0.015);
    buttplateGeo.rotateX(-0.1);
    const buttplate = new THREE.Mesh(buttplateGeo, this.akSteelMat);
    buttplate.position.set(0, -0.035, 0.38);
    akGroup.add(buttplate);

    // 5. Wooden Pistol Grip
    const gripGeo = new THREE.BoxGeometry(0.032, 0.11, 0.045);
    gripGeo.rotateX(-0.35);
    const grip = new THREE.Mesh(gripGeo, this.akDarkWoodMat);
    grip.position.set(0, -0.08, 0.06);
    akGroup.add(grip);

    // Steel Trigger Guard & Curved Trigger
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

    // 6. Iconic Curved 30-Round Steel "Banana" Magazine
    const magGroup = new THREE.Group();
    // Segment 1 (Top)
    const mag1Geo = new THREE.BoxGeometry(0.03, 0.08, 0.065);
    mag1Geo.rotateX(0.12);
    const mag1 = new THREE.Mesh(mag1Geo, this.akSteelMat);
    mag1.position.set(0, -0.07, -0.04);
    magGroup.add(mag1);

    // Segment 2 (Curved mid)
    const mag2Geo = new THREE.BoxGeometry(0.03, 0.09, 0.065);
    mag2Geo.rotateX(0.32);
    const mag2 = new THREE.Mesh(mag2Geo, this.akSteelMat);
    mag2.position.set(0, -0.14, -0.065);
    magGroup.add(mag2);

    // Segment 3 (Bottom tip)
    const mag3Geo = new THREE.BoxGeometry(0.03, 0.06, 0.065);
    mag3Geo.rotateX(0.5);
    const mag3 = new THREE.Mesh(mag3Geo, this.akSteelMat);
    mag3.position.set(0, -0.2, -0.1);
    magGroup.add(mag3);

    akGroup.add(magGroup);

    // 7. Iron Sights (Rear Tangent Leaf & Front Hooded Post)
    // Rear Sight Base & Notch
    const rearSightGeo = new THREE.BoxGeometry(0.024, 0.018, 0.045);
    const rearSight = new THREE.Mesh(rearSightGeo, this.akSteelMat);
    rearSight.position.set(0, 0.052, -0.11);
    akGroup.add(rearSight);

    // Front Sight Post & Protective Wings
    const frontTowerGeo = new THREE.BoxGeometry(0.026, 0.05, 0.025);
    const frontTower = new THREE.Mesh(frontTowerGeo, this.akSteelMat);
    frontTower.position.set(0, 0.042, -0.52);
    akGroup.add(frontTower);

    // Glowing Tritium Front Bead for crisp target acquisition
    const frontBeadGeo = new THREE.SphereGeometry(0.0025, 8, 8);
    const frontBead = new THREE.Mesh(frontBeadGeo, this.sightTritiumMat);
    frontBead.position.set(0, 0.062, -0.52);
    akGroup.add(frontBead);

    root.add(akGroup);

    // --- Operator Arms & Hands ---
    const { leftArm, rightArm } = this.createAKArms();
    root.add(leftArm);
    root.add(rightArm);

    // --- Muzzle Flash System ---
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
      rightArm
    };
  }

  /**
   * Tactical Sidearm (Custom Combat Master)
   */
  public static createPistolRig(): WeaponRig {
    const root = new THREE.Group();
    const pistolGroup = new THREE.Group();

    // 1. Polymer Lower Frame
    const frameGeo = new THREE.BoxGeometry(0.032, 0.045, 0.185);
    const frame = new THREE.Mesh(frameGeo, this.akReceiverSteelMat);
    frame.position.set(0, 0, 0.01);
    pistolGroup.add(frame);

    // Beavertail backstrap
    const btGeo = new THREE.BoxGeometry(0.03, 0.03, 0.04);
    btGeo.rotateX(0.4);
    const bt = new THREE.Mesh(btGeo, this.akReceiverSteelMat);
    bt.position.set(0, 0.012, 0.095);
    pistolGroup.add(bt);

    // Ergonomic Grip
    const gripGeo = new THREE.BoxGeometry(0.03, 0.13, 0.048);
    gripGeo.rotateX(-0.28);
    const grip = new THREE.Mesh(gripGeo, this.akDarkWoodMat);
    grip.position.set(0, -0.075, 0.05);
    pistolGroup.add(grip);

    // Trigger Guard & Trigger
    const guardGeo = new THREE.TorusGeometry(0.02, 0.0035, 8, 14, Math.PI);
    guardGeo.rotateZ(Math.PI / 2);
    guardGeo.rotateX(Math.PI / 2);
    const guard = new THREE.Mesh(guardGeo, this.akSteelMat);
    guard.position.set(0, -0.026, -0.01);
    pistolGroup.add(guard);

    // 2. Animated Steel Slide
    const slideGroup = new THREE.Group();
    const slideGeo = new THREE.BoxGeometry(0.034, 0.038, 0.19);
    const slide = new THREE.Mesh(slideGeo, this.akSteelMat);
    slide.position.set(0, 0.03, 0.005);
    slideGroup.add(slide);

    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.05, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, this.akSteelMat);
    barrel.position.set(0, 0.03, -0.1);
    slideGroup.add(barrel);

    // Tritium 3-Dot Sights
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

    // Operator Arms
    const { leftArm, rightArm } = this.createPistolArms();
    root.add(leftArm);
    root.add(rightArm);

    // Muzzle Flash
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
      rightArm
    };
  }

  /**
   * Clones the shared hand GLB (skinned meshes need SkeletonUtils.clone, a plain
   * Object3D.clone breaks the skeleton binding) and normalizes it to a real hand
   * size — the source file's units don't come out to meters directly, so this
   * measures the actual rendered bounding box and scales to a target length
   * instead of trusting a guessed constant.
   */
  private static createHandInstance(hand: HandAsset, mirror: boolean): THREE.Object3D {
    const inst = cloneSkinned(hand.scene) as THREE.Object3D;
    inst.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh) {
        m.material = this.handSkinMat;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });

    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(inst).getSize(size);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const HAND_LENGTH = 0.17; // average adult hand, wrist to fingertip, in metres
    const s = HAND_LENGTH / longest;
    inst.scale.setScalar(s);
    if (mirror) inst.scale.x *= -1; // right-hand asset -> left hand

    // Bake a partial grip pose from the model's own grasp clip (if it shipped one)
    // instead of leaving fingers flat open, then discard the mixer — the hands
    // are posed once at rig-build time, not animated live every frame.
    if (hand.clip) {
      const mixer = new THREE.AnimationMixer(inst);
      const action = mixer.clipAction(hand.clip);
      action.play();
      mixer.update(hand.clip.duration * 0.35);
      mixer.stopAllAction();
    }

    // Measured from the source file's raw POSITION accessor: local +X runs along
    // the fingers. Point that down the barrel (-Z) so the hand reads as wrapped
    // around the gun rather than lying flat across it.
    inst.rotation.y = Math.PI / 2;

    return inst;
  }

  /**
   * Adds a hand at `position` (in the owning arm group's local space) plus a short
   * tapered forearm bridging the wrist back toward the player's body, so the hand
   * doesn't read as a disembodied glove floating next to the gun.
   */
  private static attachHand(
    armGroup: THREE.Group,
    hand: HandAsset,
    mirror: boolean,
    position: THREE.Vector3,
    extraRotY: number,
    sleeveLength: number
  ): void {
    const handInst = this.createHandInstance(hand, mirror);
    handInst.position.copy(position);
    handInst.rotation.y += extraRotY;
    armGroup.add(handInst);

    const sleeveGeo = new THREE.CylinderGeometry(0.036, 0.048, sleeveLength, 10);
    sleeveGeo.rotateX(Math.PI / 2);
    const sleeve = new THREE.Mesh(sleeveGeo, this.sleeveMat);
    sleeve.position.copy(position);
    sleeve.position.z += sleeveLength * 0.5 + 0.015; // extends back toward the eye
    sleeve.castShadow = true;
    armGroup.add(sleeve);
  }

  private static createAKArms(): { leftArm: THREE.Group; rightArm: THREE.Group } {
    const leftArm = new THREE.Group();
    const rightArm = new THREE.Group();

    // Right Arm (Pistol Grip)
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

    // Left Arm (Gripping Wooden Handguard from beneath)
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
      this.gloveArmorMat
    );
    lKnuckle.position.set(-0.035, -0.038, -0.21);
    leftArm.add(lKnuckle);

    return { leftArm, rightArm };
  }

  private static createPistolArms(): { leftArm: THREE.Group; rightArm: THREE.Group } {
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

  private static createMuzzleFlash(muzzlePos: THREE.Vector3): { muzzleFlash: THREE.Group; flashLight: THREE.PointLight } {
    const muzzleFlash = new THREE.Group();
    muzzleFlash.position.copy(muzzlePos);

    const flashTex = TextureGenerator.createMuzzleFlashTexture(256);
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTex,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // 1. Front starburst cross quads
    const p1Geo = new THREE.PlaneGeometry(0.34, 0.34);
    const p1 = new THREE.Mesh(p1Geo, flashMat);
    muzzleFlash.add(p1);

    const p2 = new THREE.Mesh(p1Geo, flashMat);
    p2.rotation.z = Math.PI / 3;
    muzzleFlash.add(p2);

    // 2. Axial side flame quads along barrel axis (forward flame expansion)
    const coneGeo = new THREE.PlaneGeometry(0.38, 0.24);
    const p3 = new THREE.Mesh(coneGeo, flashMat);
    p3.rotation.y = Math.PI / 2;
    p3.position.z = -0.07;
    muzzleFlash.add(p3);

    const p4 = new THREE.Mesh(coneGeo, flashMat);
    p4.rotation.x = Math.PI / 2;
    p4.position.z = -0.07;
    muzzleFlash.add(p4);

    // 3. High-intensity dynamic warm flash light illuminating the weapon & hands
    const flashLight = new THREE.PointLight(0xffb74d, 0, 12, 2);
    muzzleFlash.add(flashLight);

    muzzleFlash.visible = false;
    return { muzzleFlash, flashLight };
  }

  private static createPistolMuzzleFlash(muzzlePos: THREE.Vector3): { muzzleFlash: THREE.Group; flashLight: THREE.PointLight } {
    const muzzleFlash = new THREE.Group();
    muzzleFlash.position.copy(muzzlePos);

    const flashTex = TextureGenerator.createMuzzleFlashTexture(128);
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // Suppressed subtle starburst (smaller 12cm diameter)
    const pGeo = new THREE.PlaneGeometry(0.12, 0.12);
    const p1 = new THREE.Mesh(pGeo, flashMat);
    muzzleFlash.add(p1);

    const p2 = new THREE.Mesh(pGeo, flashMat);
    p2.rotation.z = Math.PI / 4;
    muzzleFlash.add(p2);

    // Muted light
    const flashLight = new THREE.PointLight(0xff9944, 0, 5, 2);
    muzzleFlash.add(flashLight);

    muzzleFlash.visible = false;
    return { muzzleFlash, flashLight };
  }
}
