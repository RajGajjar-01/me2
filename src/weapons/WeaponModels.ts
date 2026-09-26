import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MUZZLE_FLASH } from '../constants/effects';
import { GUN_MATERIAL, GUN_MODELS, SCOPE_GLASS } from '../constants/weapons';
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
  /** Rest position of each anchor (= its grip); reload offsets add to it. */
  leftArmBase: THREE.Vector3;
  /** Scoped guns: height of the scope's optical axis in rig space (m). */
  scopeSightY?: number;
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
    if ('FISTS' in def) return WeaponModels.emptyRig();
    const gun = await WeaponModels.loadObj(def.FILE);

    // Barrel +X -> -Z, real-world length, bore muzzle onto the rig muzzle.
    const box = new THREE.Box3().setFromObject(gun);
    const s = def.LENGTH_M / (box.max.x - box.min.x);
    // OBJ +Z is the gun's width (it becomes rig X after the turn below).
    gun.scale.set(s, s, s * def.WIDTH_SCALE);
    gun.rotation.y = Math.PI / 2;
    gun.updateMatrix();
    const muzzlePos = tuple(def.RIG_MUZZLE);
    const muzzleNow = tuple(def.MUZZLE_MODEL).applyMatrix4(gun.matrix);
    gun.position.copy(muzzlePos).sub(muzzleNow);
    gun.updateMatrix();

    const root = new THREE.Group();
    root.add(gun);

    // Scope rides the gun (recoil, sway, reload); undo the gun's width
    // stretch so the tube stays round.
    let scopeSightY: number | undefined;
    if (def.SCOPE) {
      const scope = await WeaponModels.loadObj(def.SCOPE.FILE);
      scope.position.copy(tuple(def.SCOPE.MOUNT_MODEL));
      scope.scale.z = 1 / def.WIDTH_SCALE;
      gun.add(scope);
      root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(scope);
      scopeSightY = (b.min.y + b.max.y) / 2; // tube centre = optical axis
    }

    // Each anchor pivots at its own grip, so reload rotations turn the hand
    // in place instead of swinging it around the gun's origin.
    const anchor = (gripModel: readonly number[]) => {
      const arm = new THREE.Group();
      arm.position.copy(tuple(gripModel).applyMatrix4(gun.matrix));
      const grip = new THREE.Object3D();
      grip.name = 'grip';
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
      leftArmBase: leftArm.position.clone(),
      scopeSightY,
    };
  }

  /** Fists: same rig shape (anchors, flash) but no model, flash or light. */
  private static emptyRig(): WeaponRig {
    const root = new THREE.Group();
    const arm = () => {
      const g = new THREE.Group();
      g.add(new THREE.Object3D());
      root.add(g);
      return g;
    };
    const rightArm = arm();
    const leftArm = arm();
    const muzzleFlash = new THREE.Group();
    muzzleFlash.visible = false;
    root.add(muzzleFlash);
    return {
      root,
      muzzleFlash,
      flashLight: new THREE.PointLight(0, 0),
      chamberPos: new THREE.Vector3(),
      muzzlePos: new THREE.Vector3(),
      leftArm,
      rightArm,
      leftArmBase: new THREE.Vector3(),
    };
  }

  /** One OBJ + MTL from the synced guns folder, with PBR materials. */
  private static async loadObj(name: string): Promise<THREE.Group> {
    const file = (ext: string) => {
      const load = GUN_FILES[`../assets/character/guns/${name}.${ext}`];
      if (!load)
        throw new Error(
          `${name}.${ext} missing: run python3 scripts/sync-quaternius.py`,
        );
      return load();
    };
    const [objText, mtlText] = await Promise.all([file('obj'), file('mtl')]);
    const materials = WeaponModels.parseMtl(mtlText);
    const obj = new OBJLoader().parse(objText);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const swap = (mat: THREE.Material) => materials.get(mat.name) ?? mat;
      m.material = Array.isArray(m.material)
        ? m.material.map(swap)
        : swap(m.material);
      m.castShadow = false;
      m.receiveShadow = true;
    });
    return obj;
  }

  /**
   * MTL -> PBR. Blender writes Kd in linear space; MTLLoader reads it as
   * sRGB (turning wood near-black) and adds harsh Phong specular.
   */
  private static parseMtl(text: string): Map<string, THREE.Material> {
    const out = new Map<string, THREE.Material>();
    let name = '';
    for (const line of text.split('\n')) {
      const [key, ...v] = line.trim().split(/\s+/);
      if (key === 'newmtl') name = v[0];
      if (key !== 'Kd' || !name) continue;
      if (/glass/i.test(name)) {
        out.set(
          name,
          new THREE.MeshStandardMaterial({
            name,
            color: SCOPE_GLASS.COLOR,
            transparent: true,
            opacity: SCOPE_GLASS.OPACITY,
            roughness: SCOPE_GLASS.ROUGHNESS,
            metalness: 0,
          }),
        );
        continue;
      }
      const metal = /metal/i.test(name);
      out.set(
        name,
        new THREE.MeshStandardMaterial({
          name,
          color: new THREE.Color().setRGB(
            +v[0],
            +v[1],
            +v[2],
            THREE.LinearSRGBColorSpace,
          ),
          metalness: metal ? GUN_MATERIAL.METALNESS : 0,
          roughness: metal
            ? GUN_MATERIAL.METAL_ROUGHNESS
            : GUN_MATERIAL.ROUGHNESS,
        }),
      );
    }
    return out;
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
