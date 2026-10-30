/** 俯瞰の周回カメラ、追従、複眼視点。 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FlyPerson } from '../sim/flyperson.ts';
import type { CharacterRig } from './character.ts';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly eyeCamera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  follow = -1;
  eyeView = false;
  private tmp = new THREE.Vector3();
  private head = new THREE.Vector3();
  private wantDist = -1;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.3, 3000);
    this.camera.position.set(190, 150, 190);
    this.eyeCamera = new THREE.PerspectiveCamera(115, aspect, 0.05, 1500);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 420;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.screenSpacePanning = false;
    this.controls.update();
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.eyeCamera.aspect = w / h;
    this.eyeCamera.updateProjectionMatrix();
  }

  setFollow(i: number): void {
    this.follow = i;
    this.hasLast = false;
    if (i >= 0) this.wantDist = 9;
  }

  private lastGoal = new THREE.Vector3();
  private hasLast = false;

  /** 毎フレーム呼ぶ。補間済みの位置を使う。 */
  update(flies: FlyPerson[], rigs: CharacterRig[], dt: number): void {
    if (this.follow >= 0 && flies[this.follow]) {
      const rig = rigs[this.follow];
      const goal = this.tmp.copy(rig.group.position);
      goal.y += 1.1;
      const from = this.hasLast ? this.lastGoal : this.controls.target;
      const k = this.hasLast ? 1 : Math.min(1, dt * 6);
      const delta = goal.clone().sub(from).multiplyScalar(k);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      if (this.hasLast) this.lastGoal.copy(goal);
      else if (goal.distanceTo(this.controls.target) < 0.05) {
        this.hasLast = true;
        this.lastGoal.copy(goal);
      }
      if (this.wantDist > 0) {
        const off = this.camera.position.clone().sub(this.controls.target);
        const cur = off.length();
        const nd = cur + (this.wantDist - cur) * Math.min(1, dt * 4);
        off.setLength(nd);
        this.camera.position.copy(this.controls.target).add(off);
        if (Math.abs(nd - this.wantDist) < 0.2) this.wantDist = -1;
      }
      if (this.eyeView) {
        rig.headWorld(this.head);
        this.eyeCamera.position.copy(this.head);
        this.eyeCamera.rotation.set(-0.12, rig.group.rotation.y + Math.PI, 0, 'YXZ');
      }
    } else {
      this.hasLast = false;
    }
    this.controls.update();
  }

  get active(): THREE.PerspectiveCamera {
    return this.eyeView && this.follow >= 0 ? this.eyeCamera : this.camera;
  }
}
