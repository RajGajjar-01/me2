import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  MeshBVH,
} from 'three-mesh-bvh';
import { TextureGenerator } from '../utils/TextureGenerator';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class OutdoorRange {
  public group: THREE.Group = new THREE.Group();
  public colliderMesh!: THREE.Mesh;
  public bvh!: MeshBVH;
  public sunLight!: THREE.DirectionalLight;
  public sky!: Sky;

  private tarmacTex!: THREE.CanvasTexture;
  private hazardTex!: THREE.CanvasTexture;
  private metalTex!: THREE.CanvasTexture;

  private tarmacMat!: THREE.MeshStandardMaterial;
  private metalMat!: THREE.MeshStandardMaterial;
  private containerRedMat!: THREE.MeshStandardMaterial;
  private containerBlueMat!: THREE.MeshStandardMaterial;
  private containerGreenMat!: THREE.MeshStandardMaterial;
  private woodMat!: THREE.MeshStandardMaterial;
  private sandbagMat!: THREE.MeshStandardMaterial;
  private barrierMat!: THREE.MeshStandardMaterial;

  private colliders: THREE.BufferGeometry[] = [];

  constructor(private scene: THREE.Scene) {
    this.scene.add(this.group);
  }

  public async buildWithProgress(
    onProgress: (percent: number, status: string) => void,
  ): Promise<void> {
    onProgress(15, 'GENERATING HIGH-RES SURFACE TEXTURES...');
    await this.yieldFrame();
    this.initTextures();
    this.initMaterials();

    onProgress(35, 'CALIBRATING ATMOSPHERIC SKY & SUNLIGHT...');
    await this.yieldFrame();
    this.setupSkyAndSun();

    onProgress(60, 'CONSTRUCTING OUTDOOR TACTICAL COMPOUND...');
    await this.yieldFrame();
    this.buildGroundAndPerimeter();
    this.buildTacticalCover();
    this.buildObservationTower();
    this.buildHorizonMountains();

    onProgress(85, 'COMPUTING BVH COLLISION MATRIX...');
    await this.yieldFrame();
    this.buildCollisionMesh();

    onProgress(100, 'OUTDOOR RANGE READY');
  }

  private yieldFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  private initTextures(): void {
    this.tarmacTex = TextureGenerator.createTarmacTexture(512);
    this.tarmacTex.repeat.set(16, 16);
  }

  private initMaterials(): void {
    const tarmacBump = TextureGenerator.createTarmacBumpMap(256);
    tarmacBump.repeat.set(16, 16);

    this.tarmacMat = new THREE.MeshStandardMaterial({
      map: this.tarmacTex,
      bumpMap: tarmacBump,
      bumpScale: 0.035,
      roughness: 0.82,
      metalness: 0.08,
    });

    this.barrierMat = new THREE.MeshStandardMaterial({
      map: this.tarmacTex,
      bumpMap: tarmacBump,
      bumpScale: 0.04,
      roughness: 0.88,
      metalness: 0.05,
    });

    this.metalMat = new THREE.MeshStandardMaterial({
      color: 0x222830,
      roughness: 0.35,
      metalness: 0.9,
    });

    const containerRedTex = TextureGenerator.createContainerTexture(
      '#8a2820',
      'CR-4091',
      512,
    );
    const containerBlueTex = TextureGenerator.createContainerTexture(
      '#204565',
      'NB-8820',
      512,
    );
    const containerGreenTex = TextureGenerator.createContainerTexture(
      '#2e422a',
      'OD-1044',
      512,
    );

    this.containerRedMat = new THREE.MeshStandardMaterial({
      map: containerRedTex,
      roughness: 0.55,
      metalness: 0.4,
    });

    this.containerBlueMat = new THREE.MeshStandardMaterial({
      map: containerBlueTex,
      roughness: 0.55,
      metalness: 0.4,
    });

    this.containerGreenMat = new THREE.MeshStandardMaterial({
      map: containerGreenTex,
      roughness: 0.55,
      metalness: 0.4,
    });

    const woodTex = TextureGenerator.createWoodTexture(512);
    this.woodMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.85,
      metalness: 0.02,
    });

    const burlapTex = TextureGenerator.createBurlapTexture(256);
    this.sandbagMat = new THREE.MeshStandardMaterial({
      map: burlapTex,
      roughness: 0.95,
      metalness: 0.0,
    });
  }

  private setupSkyAndSun(): void {
    const sky = new Sky();
    this.sky = sky;
    sky.scale.setScalar(450000);
    this.group.add(sky);

    const sun = new THREE.Vector3();
    const uniforms = sky.material.uniforms;
    uniforms['turbidity'].value = 8;
    uniforms['rayleigh'].value = 1.6;
    uniforms['mieCoefficient'].value = 0.005;
    uniforms['mieDirectionalG'].value = 0.8;

    const phi = THREE.MathUtils.degToRad(90 - 38);
    const theta = THREE.MathUtils.degToRad(195);
    sun.setFromSphericalCoords(1, phi, theta);
    uniforms['sunPosition'].value.copy(sun);

    const hemiLight = new THREE.HemisphereLight(0xddefff, 0x5a6350, 1.4);
    hemiLight.position.set(0, 50, 0);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff7e6, 2.8);
    this.sunLight.position.copy(sun).multiplyScalar(60);
    this.sunLight.castShadow = true;

    this.sunLight.shadow.mapSize.width = 4096;
    this.sunLight.shadow.mapSize.height = 4096;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 130;
    const d = 42;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
  }

  private buildGroundAndPerimeter(): void {
    const groundGeo = new THREE.BoxGeometry(80, 0.4, 80);
    const groundMesh = new THREE.Mesh(groundGeo, this.tarmacMat);
    groundMesh.position.set(0, -0.2, 0);
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);

    this.addCollider(groundGeo, groundMesh);

    const wallHeight = 4.0;
    const perimeterConfigs = [
      { size: [80, wallHeight, 1.0], pos: [0, wallHeight / 2, -40] },
      { size: [80, wallHeight, 1.0], pos: [0, wallHeight / 2, 40] },
      { size: [1.0, wallHeight, 80], pos: [-40, wallHeight / 2, 0] },
      { size: [1.0, wallHeight, 80], pos: [40, wallHeight / 2, 0] },
    ];

    perimeterConfigs.forEach((w) => {
      const geo = new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]);
      const mesh = new THREE.Mesh(geo, this.barrierMat);
      mesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.group.add(mesh);

      this.addCollider(geo, mesh);
    });

    const markerLines = [-15, 0, 15, 25];
    markerLines.forEach((z) => {
      const stripeGeo = new THREE.PlaneGeometry(60, 0.5);
      stripeGeo.rotateX(-Math.PI / 2);
      const stripeMat = new THREE.MeshBasicMaterial({
        color: 0xdfa010,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(0, 0.01, z);
      this.group.add(stripe);
    });
  }

  private buildTacticalCover(): void {
    const containerLayouts = [
      {
        pos: [-12, 1.3, 16],
        rot: 0.15,
        size: [2.5, 2.6, 6.0],
        mat: this.containerRedMat,
      },
      {
        pos: [14, 1.3, 14],
        rot: -0.25,
        size: [2.5, 2.6, 6.0],
        mat: this.containerBlueMat,
      },

      {
        pos: [-8, 1.3, -2],
        rot: 0.4,
        size: [2.5, 2.6, 6.0],
        mat: this.containerGreenMat,
      },
      {
        pos: [9, 1.3, 2],
        rot: -0.5,
        size: [2.5, 2.6, 6.0],
        mat: this.containerRedMat,
      },

      {
        pos: [-8, 3.9, -2],
        rot: 0.4,
        size: [2.5, 2.6, 6.0],
        mat: this.containerBlueMat,
      },

      {
        pos: [0, 1.3, -20],
        rot: 1.57,
        size: [2.5, 2.6, 8.0],
        mat: this.containerGreenMat,
      },
      {
        pos: [-18, 1.3, -16],
        rot: 0.0,
        size: [2.5, 2.6, 6.0],
        mat: this.containerRedMat,
      },
    ];

    containerLayouts.forEach((c) => {
      const geo = new THREE.BoxGeometry(c.size[0], c.size[1], c.size[2]);
      const mesh = new THREE.Mesh(geo, c.mat);
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.rotation.y = c.rot;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      this.addCollider(geo, mesh);
    });

    const barricades = [
      { pos: [-8, 1.1, 24], size: [5.0, 2.2, 0.2], rot: 0 },
      { pos: [8, 1.1, 24], size: [5.0, 2.2, 0.2], rot: 0 },
      { pos: [-6, 1.1, 8], size: [4.5, 2.2, 0.2], rot: 0.3 },
      { pos: [6, 1.1, 9], size: [4.5, 2.2, 0.2], rot: -0.3 },
      { pos: [-14, 1.1, 0], size: [5.0, 2.2, 0.2], rot: 1.57 },
      { pos: [16, 1.1, -8], size: [6.0, 2.2, 0.2], rot: -0.8 },
    ];

    barricades.forEach((b) => {
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
      const mesh = new THREE.Mesh(geo, this.woodMat);
      mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      mesh.rotation.y = b.rot;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      this.addCollider(geo, mesh);
    });

    const sandbags = [
      { pos: [0, 0.5, 12], size: [4.0, 1.0, 1.2], rot: 0 },
      { pos: [-10, 0.5, 22], size: [3.5, 1.0, 1.2], rot: 0.4 },
      { pos: [11, 0.5, 21], size: [3.5, 1.0, 1.2], rot: -0.4 },
      { pos: [0, 0.5, -8], size: [5.0, 1.0, 1.2], rot: 0 },
    ];

    sandbags.forEach((s) => {
      const geo = new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]);
      const mesh = new THREE.Mesh(geo, this.sandbagMat);
      mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
      mesh.rotation.y = s.rot;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      this.addCollider(geo, mesh);
    });
  }

  private buildObservationTower(): void {
    const towerX = 26;
    const towerZ = -26;
    const platformY = 4.5;

    const platGeo = new THREE.BoxGeometry(6, 0.3, 6);
    const platMesh = new THREE.Mesh(platGeo, this.metalMat);
    platMesh.position.set(towerX, platformY, towerZ);
    platMesh.receiveShadow = true;
    this.group.add(platMesh);

    this.addCollider(platGeo, platMesh);

    const pillars = [
      [-2.6, -2.6],
      [2.6, -2.6],
      [-2.6, 2.6],
      [2.6, 2.6],
    ];
    pillars.forEach(([px, pz]) => {
      const pillarGeo = new THREE.BoxGeometry(0.3, platformY, 0.3);
      const pillarMesh = new THREE.Mesh(pillarGeo, this.metalMat);
      pillarMesh.position.set(towerX + px, platformY / 2, towerZ + pz);
      pillarMesh.castShadow = true;
      this.group.add(pillarMesh);

      this.addCollider(pillarGeo, pillarMesh);
    });

    const rampLength = 12;
    const rampGeo = new THREE.BoxGeometry(2.2, 0.2, rampLength);
    const rampMesh = new THREE.Mesh(rampGeo, this.metalMat);
    rampMesh.position.set(
      towerX - 4.1,
      platformY / 2,
      towerZ + rampLength / 2 - 3,
    );
    rampMesh.rotation.x = Math.atan2(platformY, rampLength);
    rampMesh.receiveShadow = true;
    this.group.add(rampMesh);

    this.addCollider(rampGeo, rampMesh);

    const roofGeo = new THREE.BoxGeometry(7, 0.2, 7);
    const roofMesh = new THREE.Mesh(roofGeo, this.metalMat);
    roofMesh.position.set(towerX, platformY + 3.0, towerZ);
    roofMesh.castShadow = true;
    this.group.add(roofMesh);
  }

  private buildHorizonMountains(): void {
    const mountainMat = new THREE.MeshBasicMaterial({
      color: 0x6e7885,
    });

    const mConfigs = [
      { pos: [0, 20, -180], size: [320, 60, 40] },
      { pos: [-180, 25, 0], size: [40, 70, 320] },
      { pos: [180, 25, 0], size: [40, 70, 320] },
      { pos: [0, 15, 180], size: [320, 50, 40] },
    ];

    mConfigs.forEach((m) => {
      const geo = new THREE.ConeGeometry(m.size[0] / 2, m.size[1], 8);
      const mesh = new THREE.Mesh(geo, mountainMat);
      mesh.position.set(m.pos[0], m.pos[1], m.pos[2]);
      this.group.add(mesh);
    });
  }

  private addCollider(geo: THREE.BufferGeometry, mesh: THREE.Object3D): void {
    mesh.updateMatrixWorld(true);
    const col = geo.clone();
    col.applyMatrix4(mesh.matrixWorld);
    this.colliders.push(col);
  }

  private buildCollisionMesh(): void {
    if (this.colliders.length === 0) return;

    const mergedGeometry = BufferGeometryUtils.mergeGeometries(
      this.colliders,
      false,
    );

    this.bvh = new MeshBVH(mergedGeometry, {
      targetLeafSize: 8,
      verbose: false,
    });

    this.colliderMesh = new THREE.Mesh(
      mergedGeometry,
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
    );
    this.colliderMesh.visible = true;
    (this.colliderMesh.geometry as any).boundsTree = this.bvh;
    this.scene.add(this.colliderMesh);

    this.colliders.forEach((geo) => {
      geo.dispose();
    });
    this.colliders = [];
  }
}
