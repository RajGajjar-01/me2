import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import animsUrl from '../assets/character/anims.json?url';
import bodyColorUrl from '../assets/character/bodyColor.jpg';
import bodyNormalUrl from '../assets/character/bodyNormal.jpg';
import bodyRoughUrl from '../assets/character/bodyRough.jpg';
import eyeColorUrl from '../assets/character/eyeColor.jpg';
import eyeNormalUrl from '../assets/character/eyeNormal.jpg';
import hairColorUrl from '../assets/character/hairColor.jpg';
import hairNormalUrl from '../assets/character/hairNormal.jpg';
import heroFbxUrl from '../assets/character/hero.fbx?url';
import {
  HERO,
  HERO_CLIPS,
  HERO_ONE_SHOTS,
  type HeroClip,
} from '../constants/character';

// The FBX references its textures by absolute Windows paths; stub them out
// and assign our own materials by name below.
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export interface HeroAssets {
  template: THREE.Group;
  clips: Record<HeroClip, THREE.AnimationClip>;
}

let assetsPromise: Promise<HeroAssets> | null = null;

/** Loads the hero once; every Hero instance clones from the same template. */
export function loadHeroAssets(): Promise<HeroAssets> {
  assetsPromise ??= loadAssets();
  return assetsPromise;
}

function texture(url: string, srgb: boolean): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

async function loadAssets(): Promise<HeroAssets> {
  const [fbxBuf, animJson] = await Promise.all([
    fetch(heroFbxUrl).then((r) => r.arrayBuffer()),
    fetch(animsUrl).then((r) => r.json()),
  ]);

  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => BLANK_PNG);
  const obj = new FBXLoader(manager).parse(fbxBuf, '');

  const materials: Record<string, THREE.Material> = {
    MI_Superhero_Male: new THREE.MeshStandardMaterial({
      map: texture(bodyColorUrl, true),
      normalMap: texture(bodyNormalUrl, false),
      roughnessMap: texture(bodyRoughUrl, false),
      roughness: 1,
      metalness: 0,
    }),
    MI_Eyes: new THREE.MeshStandardMaterial({
      map: texture(eyeColorUrl, true),
      normalMap: texture(eyeNormalUrl, false),
      roughness: 0.15,
    }),
    MI_Hair_1: new THREE.MeshStandardMaterial({
      map: texture(hairColorUrl, true),
      normalMap: texture(hairNormalUrl, false),
      color: 0x5a4030,
      roughness: 0.55,
      side: THREE.DoubleSide,
    }),
  };

  let eyes: THREE.Object3D | null = null;
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    ).name;
    mesh.material = materials[name] ?? materials.MI_Superhero_Male;
    if (name === 'MI_Eyes') eyes = mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned bounds don't follow the animation; never cull the body.
    mesh.frustumCulled = false;
  });

  // Stand on the ground and face -Z (three's forward, same as the camera).
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y = -box.min.y + HERO.FOOT_LIFT_M;
  const template = new THREE.Group();
  template.add(obj);
  if (eyes) {
    const eyeBox = new THREE.Box3().setFromObject(eyes);
    const eyeZ = (eyeBox.min.z + eyeBox.max.z) / 2;
    // Flip the wrapper, not obj: obj already carries the FBX Z-up -> Y-up
    // X rotation, so a Y turn on obj spins it upside down.
    if (eyeZ > (box.min.z + box.max.z) / 2) template.rotation.y = Math.PI;
  }

  // UAL clips share UE bone names with the hero, so tracks bind by name.
  // Keep bone rotations + pelvis position (rescaled to this rig's units).
  const pelvis = obj.getObjectByName('pelvis');
  const k =
    (pelvis?.position.length() ?? HERO.UAL_PELVIS_REST_M) /
    HERO.UAL_PELVIS_REST_M;
  const clips = {} as Record<HeroClip, THREE.AnimationClip>;
  for (const name of HERO_CLIPS) {
    const clip = THREE.AnimationClip.parse(animJson[name]);
    clip.tracks = clip.tracks.filter(
      (t) =>
        t.name === 'pelvis.position' ||
        (t.name.endsWith('.quaternion') && !t.name.startsWith('root.')),
    );
    const pelvisTrack = clip.tracks.find((t) => t.name === 'pelvis.position');
    if (pelvisTrack) {
      for (let i = 0; i < pelvisTrack.values.length; i++) {
        pelvisTrack.values[i] *= k;
      }
    }
    clips[name] = clip;
  }

  return { template, clips };
}

/** One animated character: its own skeleton, mixer and actions. */
export class Hero {
  public readonly root = new THREE.Group();
  public readonly model: THREE.Object3D;
  public readonly mixer: THREE.AnimationMixer;
  public readonly actions: Record<HeroClip, THREE.AnimationAction>;
  public current: THREE.AnimationAction | null = null;

  constructor(assets: HeroAssets) {
    this.model = SkeletonUtils.clone(assets.template);
    this.root.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {} as Record<HeroClip, THREE.AnimationAction>;
    for (const name of HERO_CLIPS) {
      const action = this.mixer.clipAction(assets.clips[name]);
      if (HERO_ONE_SHOTS.includes(name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    }
  }

  public bone(name: string): THREE.Object3D {
    const b = this.model.getObjectByName(name);
    if (!b) throw new Error(`hero bone missing: ${name}`);
    return b;
  }

  /** Crossfade to a clip; no-op if it's already the current one. */
  public play(
    name: HeroClip,
    fade: number = HERO.FADE_S,
  ): THREE.AnimationAction {
    const next = this.actions[name];
    if (next === this.current) return next;
    this.current?.fadeOut(fade);
    next.reset().setEffectiveTimeScale(1).fadeIn(fade).play();
    this.current = next;
    return next;
  }

  /** Restart a one-shot even if it is already playing. */
  public playOnce(name: HeroClip, fade: number = HERO.FADE_FAST_S): void {
    if (this.current === this.actions[name]) this.current.reset().play();
    else this.play(name, fade);
  }

  public isRunning(name: HeroClip): boolean {
    const a = this.actions[name];
    return a === this.current && a.isRunning();
  }

  public update(delta: number): void {
    this.mixer.update(delta);
  }
}
