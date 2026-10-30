/** 複眼視点の後処理: 広い視野を六角のファセットに分け、縁を少し暗くする。 */
import * as THREE from 'three';

export class CompoundEyePost {
  private target: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        res: { value: new THREE.Vector2(1, 1) },
        cell: { value: 15 },
        strength: { value: 0.32 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform vec2 res; uniform float cell; uniform float strength;
        varying vec2 vUv;
        const vec2 S = vec2(1.7320508, 1.0);
        vec4 hexOf(vec2 p){
          vec4 hC = floor(vec4(p, p - vec2(1.0, 0.5)) / S.xyxy) + 0.5;
          vec4 h = vec4(p - hC.xy * S, p - (hC.zw + 0.5) * S);
          return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
        }
        void main(){
          vec2 px = vUv * res;
          vec2 p = px / cell;
          vec4 hx = hexOf(p);
          vec2 centerPx = (p - hx.xy) * cell;
          vec3 mosaic = texture2D(tDiffuse, centerPx / res).rgb;
          vec3 orig = texture2D(tDiffuse, vUv).rgb;
          float d = max(dot(abs(hx.xy), vec2(0.5, 0.866)) * 1.0, abs(hx.x) * 0.866 * 0.0 + abs(hx.x));
          float edge = smoothstep(0.38, 0.5, d);
          vec3 c = mix(orig, mosaic, strength);
          c *= 1.0 - 0.14 * edge;
          c *= vec3(1.04, 0.97, 0.97);
          vec2 q = vUv - 0.5;
          c *= 1.0 - 0.55 * smoothstep(0.35, 0.85, length(q * vec2(1.0, 1.1)));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (this.target.width !== size.x || this.target.height !== size.y) {
      this.target.setSize(size.x, size.y);
      this.mat.uniforms.res.value.copy(size);
      this.mat.uniforms.cell.value = Math.max(9, Math.round(size.y / 52));
    }
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
