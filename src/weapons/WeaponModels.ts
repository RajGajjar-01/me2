import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MUZZLE_FLASH } from '../constants/effects';
import { GUN_MODELS } from '../constants/weapons';
import { TextureGenerator } from '../utils/TextureGenerator';

export interface WeaponRig {
  root: THREE.Group;
  slideOrBolt?: THREE.Mesh | THREE.Group;
  muzzleFlash: THREE.Group;
  flashLight: THREE.PointLight;
  chamberPos: THREE.Vector3;
  muzzlePos: THREE.Vector3;
  /**
   * Hand anchors, not hand meshes: each holds one `grip` child where the
   * hero's wrist goes. Reload choreography moves these groups and the IK'd
   * hands follow.
   */
  leftArm: THREE.Group;
  rightArm: THREE.Group;
}

/** The point inside a hand anchor the hero's wrist is pulled to. */
export function gripOf(arm: THREE.Group): THREE.Object3D {
  return arm.children[0];
}

// Gun files live in the gitignored synced folder (scripts/sync-quaternius.py).
const GUN_FILES = import.meta.glob('../assets/character/guns/*.{obj,mtl}', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const tuple = (t: readonly number[]) => new THREE.Vector3(t[0], t[1], t[2]);

export class WeaponModels {
  /** Builds the viewmodel rig for WEAPON_DEFS[index] from its OBJ gun. */
  public static async loadGunRig(index: number): Promise<WeaponRig> {
    const def = GUN_MODELS[index];
    const file = (ext: string) => {
      const load = GUN_FILES[`../assets/character/guns/${def.FILE}.${ext}`];
      if (!load)
        throw new Error(
          `${def.FILE}.${ext} missing: run python3 scripts/sync-quaternius.py`,
        );
      return load();
    };
    const [objText, mtlText] = await Promise.all([file('obj'), file('mtl')]);

    const materials = new MTLLoader().parse(mtlText, '');
    materials.preload();
    const gun = new OBJLoader().setMaterials(materials).parse(objText);
    gun.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = true;
      }
    });

    // Barrel +X -> -Z, real-world length, bore muzzle onto the rig muzzle.
    const box = new THREE.Box3().setFromObject(gun);
    const s = def.LENGTH_M / (box.max.x - box.min.x);
    gun.scale.setScalar(s);
    gun.rotation.y = Math.PI / 2;
    gun.updateMatrix();
    const muzzlePos = tuple(def.RIG_MUZZLE);
    const muzzleNow = tuple(def.MUZZLE_MODEL).applyMatrix4(gun.matrix);
    gun.position.copy(muzzlePos).sub(muzzleNow);
    gun.updateMatrix();

    const root = new THREE.Group();
    root.add(gun);

    const anchor = (gripModel: readonly number[]) => {
      const arm = new THREE.Group();
      const grip = new THREE.Object3D();
      grip.name = 'grip';
      grip.position.copy(tuple(gripModel).applyMatrix4(gun.matrix));
      arm.add(grip);
      root.add(arm);
      return arm;
    };
    const rightArm = anchor(def.RIGHT_GRIP_MODEL);
    const leftArm = anchor(def.LEFT_GRIP_MODEL);

    const { muzzleFlash, flashLight } =
      def.FLASH === 'pistol'
        ? WeaponModels.createPistolMuzzleFlash(muzzlePos)
        : WeaponModels.createMuzzleFlash(muzzlePos);
    root.add(muzzleFlash);

    return {
      root,
      muzzleFlash,
      flashLight,
      chamberPos: tuple(def.CHAMBER),
      muzzlePos,
      leftArm,
      rightArm,
    };
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
