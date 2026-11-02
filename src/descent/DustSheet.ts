import * as THREE from 'three'

/**
 * The landing dust (G2b): a MODELLED effect, not a reconstruction of the film. In a vacuum the exhaust lifts loose regolith and
 * every grain then flies on its own ballistic arc, so the dust leaves from under the engine as a low, flat sheet streaming radially
 * outward, with no billowing. Each streak below is one grain on such an arc (launch speed and a few degrees of elevation from a fixed
 * seed, lunar gravity 1.62 m/s2), re-launched when it lands, so its place is a pure function of the clock (scrubbing works).
 * How much is drawn grows with the track's dust index (0 to 1, a rendering scale interpolated over the crew's call altitudes, not a
 * density). Each grain is drawn as a short streak along its own velocity (radial in the ground plane, the motion the film shows), never a
 * round soft dot. Sunlit grains brighten when the camera looks toward the Sun (forward scatter, modelled). Depth-tested against the ground.
 */
const G_MOON = 1.62
/** How long a grain's tail is, seconds of its own flight (the streak length). */
const TAIL_S = 0.05

const VERT = /* glsl */ `
uniform float uT;
uniform float uIndex;
uniform vec2 uRes;
uniform vec3 uC;
uniform float uGY;
uniform vec3 uSun;
attribute vec2 aQ;
attribute vec4 aA;
attribute vec2 aB;
varying float vA;
varying float vSide;
vec3 grain(float speed, float vz, float ang, float age, float r0) {
  float r = r0 + speed * age;
  vec3 p = uC + vec3(cos(ang) * r, 0.0, -sin(ang) * r);
  p.y = max(uGY + 0.05 + vz * age - 0.5 * ${G_MOON.toFixed(2)} * age * age, uGY + 0.02);
  return p;
}
void main() {
  float idx = uIndex;
  float speed = mix(4.0, 40.0, aA.z * aA.z) * (0.3 + 0.7 * idx);
  float vz = speed * mix(0.010, 0.05, aA.w);
  float life = max(2.0 * vz / ${G_MOON.toFixed(2)}, 0.6);
  float cyc = life * 1.25;
  float age = fract(aA.x + uT / cyc) * cyc;
  float ang = aA.y * 6.2831853;
  float on = (age < life && aB.x < pow(idx, 0.85)) ? 1.0 : 0.0;
  float r0 = 1.0 + 6.0 * aB.y * aB.y;
  vec3 ph = grain(speed, vz, ang, age, r0);
  vec3 pt = grain(speed, vz, ang, max(age - ${TAIL_S.toFixed(3)}, 0.0), r0);
  vec4 ch = projectionMatrix * viewMatrix * vec4(ph, 1.0);
  vec4 ct = projectionMatrix * viewMatrix * vec4(pt, 1.0);
  vec2 sh = ch.xy / ch.w * 0.5 * uRes, st = ct.xy / ct.w * 0.5 * uRes;
  vec2 d = sh - st;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  float minLen = 2.0;
  vec2 tailPx = len < minLen ? sh - dir * minLen : st;
  float halfW = 0.5 + 0.4 * fract(aB.y * 7.31);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 px = mix(tailPx, sh, aQ.x) + nrm * aQ.y * halfW;
  vec4 c = ch.w > 0.0 ? ch : ct;
  vec2 ndc = px / (0.5 * uRes);
  gl_Position = vec4(ndc * c.w, c.z, c.w);
  vec3 view = normalize(ph - cameraPosition);
  float fwd = max(dot(view, normalize(uSun)), 0.0);
  float boost = 1.0 + 6.0 * pow(fwd, 6.0);
  float fadeIn = smoothstep(0.0, 0.15, age);
  vA = on * fadeIn * (1.0 - age / life) * (0.35 + 0.65 * idx) * boost;
  vSide = aQ.y;
  if (on < 0.5 || ch.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`
const FRAG = /* glsl */ `
uniform float uExp;
varying float vA;
varying float vSide;
void main() {
  float a = vA * (1.0 - vSide * vSide) * 0.16;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vec3(0.20, 0.185, 0.16) * uExp, min(a, 0.6));
}`

export class DustSheet {
  readonly mesh: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial

  constructor(n = 6000) {
    const geo = new THREE.InstancedBufferGeometry()
    // One quad: aQ.x 0 at the tail and 1 at the head, aQ.y -1 to 1 across.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3))
    geo.setAttribute('aQ', new THREE.BufferAttribute(new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]), 2))
    geo.setIndex([0, 1, 2, 0, 2, 3])
    // A fixed pseudo-random stream (mulberry32): the same grains every run.
    let s = 0x9e3779b9
    const rnd = (): number => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const a = new Float32Array(n * 4), b = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) { for (let k = 0; k < 4; k++) a[i * 4 + k] = rnd(); b[i * 2] = rnd(); b[i * 2 + 1] = rnd() }
    geo.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4))
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 2))
    geo.instanceCount = n
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
      uniforms: { uT: { value: 0 }, uIndex: { value: 0 }, uRes: { value: new THREE.Vector2(1280, 720) }, uC: { value: new THREE.Vector3() }, uGY: { value: 0 }, uExp: { value: 1 }, uSun: { value: new THREE.Vector3(1, 0.2, 0) } },
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  /** The Sun's direction in three's axes (toward the Sun). */
  setSun(s3: THREE.Vector3): void { (this.mat.uniforms.uSun.value as THREE.Vector3).copy(s3) }

  /** `centre` and `groundY` are in three's axes (east, up, south), relative to the camera's rebase. `exposure` is the frame's pre-exposure; `resPx` the drawing buffer's size. */
  update(o: { tSim: number; centre: THREE.Vector3; groundY: number; index: number; exposure: number; resPx: THREE.Vector2 }): void {
    this.mesh.visible = o.index > 0.004
    const u = this.mat.uniforms
    u.uT.value = o.tSim
    u.uIndex.value = o.index
    ;(u.uRes.value as THREE.Vector2).copy(o.resPx)
    ;(u.uC.value as THREE.Vector3).copy(o.centre)
    u.uGY.value = o.groundY
    u.uExp.value = o.exposure * 0.6
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose() }
}
