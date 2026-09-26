import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import animsUrl from '../assets/character/anims.json?url';
import bodyColorUrl from '../assets/character/bodyColor.jpg';
import bodyNormalUrl from '../assets/character/bodyNormal.jpg';
import bodyRoughUrl from '../assets/character/bodyRough.jpg';
import eyeColorUrl from '../assets/character/eyeColor.jpg';
import eyeNormalUrl from '../assets/character/eyeNormal.jpg';
import femaleGlbUrl from '../assets/character/female.glb?url';
import hairLongGlbUrl from '../assets/character/hair-long.glb?url';
import hairColorUrl from '../assets/character/hairColor.jpg';
import hairNormalUrl from '../assets/character/hairNormal.jpg';
import heroGlbUrl from '../assets/character/hero.glb?url';
import {
  HERO,
  HERO_CLIPS,
  HERO_ONE_SHOTS,
  HERO_UPPER_CLIPS,
  type HeroClip,
  type HeroUpperClip,
} from '../constants/character';
import { GRAPHICS } from '../constants/graphics';

export interface HeroAssets {
  template: THREE.Group;
  clips: Record<HeroClip, THREE.AnimationClip>;
  /** HERO_UPPER_CLIPS masked to the upper body (see HERO.UPPER_BODY_BONE). */
  upperClips: Record<HeroUpperClip, THREE.AnimationClip>;
}

let assetsPromise: Promise<HeroAssets> | null = null;
let femalePromise: Promise<HeroAssets> | null = null;
let animsPromise: Promise<Record<string, THREE.AnimationClipJSON>> | null =
  null;

/** Loads the hero once; every Hero instance clones from the same template. */
export function loadHeroAssets(): Promise<HeroAssets> {
  assetsPromise ??= loadAssets();
  return assetsPromise;
}

/** Female body + long hair on the same UE skeleton, so the same clips play. */
export function loadFemaleAssets(): Promise<HeroAssets> {
  femalePromise ??= loadFemale();
  return femalePromise;
}

function loadAnims(): Promise<Record<string, THREE.AnimationClipJSON>> {
  animsPromise ??= fetch(animsUrl).then((r) => r.json());
  return animsPromise;
}

function texture(url: string, srgb: boolean): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = GRAPHICS.TEXTURE_ANISOTROPY;
  // glTF UVs have their origin top-left, so textures must not be flipped.
  t.flipY = false;
  return t;
}

async function loadAssets(): Promise<HeroAssets> {
  // hero.glb has no embedded textures (scripts/fbx-to-glb.py); materials are
  // assigned by name below.
  const [glbBuf, animJson] = await Promise.all([
    fetch(heroGlbUrl).then((r) => r.arrayBuffer()),
    loadAnims(),
  ]);
  const obj = (await new GLTFLoader().parseAsync(glbBuf, '')).scene;

  const normalScale = new THREE.Vector2(...HERO.NORMAL_SCALE);
  const materials: Record<string, THREE.Material> = {
    MI_Superhero_Male: new THREE.MeshStandardMaterial({
      map: texture(bodyColorUrl, true),
      normalMap: texture(bodyNormalUrl, false),
      normalScale,
      roughnessMap: texture(bodyRoughUrl, false),
      roughness: 1,
      metalness: 0,
    }),
    MI_Eyes: new THREE.MeshStandardMaterial({
      map: texture(eyeColorUrl, true),
      normalMap: texture(eyeNormalUrl, false),
      normalScale,
      roughness: 0.15,
    }),
    MI_Hair_1: new THREE.MeshStandardMaterial({
      map: texture(hairColorUrl, true),
      normalMap: texture(hairNormalUrl, false),
      normalScale,
      color: 0x5a4030,
      roughness: 0.55,
      side: THREE.DoubleSide,
    }),
  };

  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = (
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    ).name;
    mesh.material = materials[name] ?? materials.MI_Superhero_Male;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned bounds don't follow the animation; never cull the body.
    mesh.frustumCulled = false;
  });

  // Hand bones (fingers follow) scaled down; clips never animate scale.
  for (const side of ['l', 'r']) {
    obj.getObjectByName(`hand_${side}`)?.scale.setScalar(HERO.HAND_SCALE);
  }
  return finishAssets(obj, animJson);
}

async function loadFemale(): Promise<HeroAssets> {
  const loader = new GLTFLoader();
  const [body, hair, animJson] = await Promise.all([
    loader.loadAsync(femaleGlbUrl),
    loader.loadAsync(hairLongGlbUrl),
    loadAnims(),
  ]);
  const obj = body.scene;
  // The hair ships with its own copy of the skeleton; bind it to the body's.
  const hairMeshes: THREE.SkinnedMesh[] = [];
  hair.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh)
      hairMeshes.push(o as THREE.SkinnedMesh);
  });
  for (const m of hairMeshes) {
    const bones = m.skeleton.bones.map((b) => obj.getObjectByName(b.name));
    m.bind(
      new THREE.Skeleton(bones as THREE.Bone[], m.skeleton.boneInverses),
      m.bindMatrix,
    );
    obj.add(m);
  }
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  });
  return finishAssets(obj, animJson);
}

function finishAssets(
  obj: THREE.Object3D,
  animJson: Record<string, THREE.AnimationClipJSON>,
): HeroAssets {
  // Face -Z (three's forward, same as the camera).
  obj.updateMatrixWorld(true);
  const template = new THREE.Group();
  template.add(obj);
  // Facing from bones only (toes point forward), not mesh bounds: skinned
  // bounds depend on how the skeleton was evaluated and can disagree.
  // hero.glb already faces -Z; the erangel-run female still needs the turn.
  const at = (n: string) =>
    obj.getObjectByName(n)?.getWorldPosition(new THREE.Vector3());
  const foot = at('foot_l');
  const toe = at('ball_l');
  if (foot && toe && toe.z > foot.z) template.rotation.y = Math.PI;

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

  const upperBones = new Set<string>();
  obj
    .getObjectByName(HERO.UPPER_BODY_BONE)
    ?.traverse((b) => upperBones.add(b.name));
  const upperClips = {} as Record<HeroUpperClip, THREE.AnimationClip>;
  for (const name of HERO_UPPER_CLIPS) {
    const clip = clips[name].clone();
    clip.tracks = clip.tracks.filter((t) =>
      upperBones.has(t.name.slice(0, t.name.lastIndexOf('.'))),
    );
    upperClips[name] = clip;
  }

  // Stand on the ground: the idle pose's lowest vertex (the soles) at y = 0.
  // Measured per body, since each rig's clips sit its feet differently.
  const probe = SkeletonUtils.clone(obj);
  new THREE.AnimationMixer(probe)
    .clipAction(clips.Idle_Loop)
    .play()
    .getMixer()
    .update(0);
  obj.position.y = -lowestPoint(probe);

  return { template, clips, upperClips };
}

function lowestPoint(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let min = Number.POSITIVE_INFINITY;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      m.applyBoneTransform(i, v.fromBufferAttribute(pos, i));
      min = Math.min(min, v.applyMatrix4(m.matrixWorld).y);
    }
  });
  return min;
}

/** One animated character: its own skeleton, mixer and actions. */
export class Hero {
  public readonly root = new THREE.Group();
  /**
   * Whole-body pose layer between root and model (e.g. lying prone). Never
   * rotate `model` itself: its clone stores the facing flip as Euler
   * (-PI, 0, -PI), so overwriting one axis flips the body upside down.
   */
  public readonly body = new THREE.Group();
  public readonly model: THREE.Object3D;
  public readonly mixer: THREE.AnimationMixer;
  public readonly actions: Record<HeroClip, THREE.AnimationAction>;
  public current: THREE.AnimationAction | null = null;
  /** Upper-body layer over `current` (arm actions while the legs move). */
  public readonly upperActions: Record<HeroUpperClip, THREE.AnimationAction>;
  public upper: THREE.AnimationAction | null = null;

  constructor(assets: HeroAssets) {
    this.model = SkeletonUtils.clone(assets.template);
    this.root.add(this.body);
    this.body.add(this.model);

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
    this.upperActions = {} as Record<HeroUpperClip, THREE.AnimationAction>;
    for (const name of HERO_UPPER_CLIPS) {
      const action = this.mixer.clipAction(assets.upperClips[name]);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.weight = HERO.UPPER_LAYER_WEIGHT;
      this.upperActions[name] = action;
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

  /** Play an arm action on the upper body; `restart` replays it if current. */
  public playUpper(
    name: HeroUpperClip,
    fade: number = HERO.FADE_FAST_S,
    restart = false,
  ): void {
    const next = this.upperActions[name];
    if (next === this.upper) {
      if (restart) next.reset().play();
      return;
    }
    this.upper?.fadeOut(fade);
    next.reset().setEffectiveTimeScale(1).fadeIn(fade).play();
    this.upper = next;
  }

  public stopUpper(fade: number = HERO.FADE_FAST_S): void {
    this.upper?.fadeOut(fade);
    this.upper = null;
  }

  public isUpperRunning(name: HeroUpperClip): boolean {
    const a = this.upperActions[name];
    return a === this.upper && a.isRunning();
  }

  /**
   * Hand a running full-body arm action over to the upper layer at the same
   * time, so the legs can switch to locomotion without cutting it short.
   */
  public carryToUpper(): void {
    const c = this.current;
    const name = c?.getClip().name as HeroUpperClip;
    if (!c?.isRunning() || !(name in this.upperActions)) return;
    this.playUpper(name, 0, true);
    this.upperActions[name].time = c.time;
  }

  public update(delta: number): void {
    this.mixer.update(delta);
  }
}
