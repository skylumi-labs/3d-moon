import type { PatchLayout } from '../moonShader'
import { BAKED_MAX_SLOTS, BAKED_LIVE_M, BAKED_LIVE_SAMPLES, BAKED_LIVE_POW, BAKED_BIAS_M } from './format'
/** One sampler. Tables contain local-north azimuths, clockwise east, in degrees above local horizontal. */
export function bakedShadowRead(tiles: boolean, patch: PatchLayout | null): string {
  const hs = patch?.map((l, i) => l.h ? i : -1).filter(i => i >= 0) ?? []
  return /* glsl */ `
uniform highp sampler2DArray uBaked;
uniform vec4 uBakedRect[${BAKED_MAX_SLOTS}];
uniform vec4 uBakedInfo[${BAKED_MAX_SLOTS}]; // source level (-1 global), N, texel x/y; N=0 is not resident
float gBakedHit = 0.0;
float gBakedHorizon = 0.0;
float gPshHit = -1.0;
float horizonSun(vec3 p, vec3 t, float lod, float lodT) {
  gBakedHit = 0.0; gPshHit = 0.0;
  vec2 at = uvOf(p);
  int level = -1;
  bool valid = ${tiles ? 'gTileMarch < 0.001' : 'true'};
${patch ? `  if (uPatchBlend * uPatchGround >= 0.999 && gTileMarch >= 0.999) {
    at = patchEN(p);
    valid = false;
${hs.map(i => `    if (uPS${i}.x > 0.0) {
      level = ${i};
      valid = patchEdge(patchQ(uPG${i}, uPA${i}, at), uPS${i}, uPG${i}, ${patch[i].fadeM.toFixed(1)}) >= 0.999;
    }`).join('\n')}
  }` : ''}
  if (valid) {
    // Local east and north in the world frame, identical to the spherical bake.
    vec3 east = cross(uK, p);
    if (length(east) > 1e-6) {
      east = normalize(east);
      vec3 north = normalize(cross(p, east));
      float az = mod(atan(dot(t, east), dot(t, north)) + 2.0 * PI, 2.0 * PI);
      for (int slot = 0; slot < ${BAKED_MAX_SLOTS}; slot++) {
        vec4 info = uBakedInfo[slot], r = uBakedRect[slot];
        if (info.y < 4.0 || int(info.x) != level || any(lessThan(at, r.xy)) || any(greaterThanEqual(at, r.xy + r.zw))) continue;
        vec2 uv = ((at - r.xy) / info.zw + 1.0) / 128.0;
        float k = az * info.y / (2.0 * PI);
        int a = int(floor(k)), b = (a + 1) % int(info.y);
        float ha = texture(uBaked, vec3(uv, float(slot * 16 + a / 4)))[a % 4];
        float hb = texture(uBaked, vec3(uv, float(slot * 16 + b / 4)))[b % 4];
        float best = mix(ha, hb, fract(k)) * 64.0;
        // Bias is in metres in BOTH bake and near march. Never add it to the unit-radius position.
        float h0 = ${tiles ? 'level >= 0 ? marchHQ(p, int(floor(lodT + 0.5)), lod, 0.0) : heightAt(uvOf(p), 0.0)' : 'heightAt(uvOf(p), 0.0)'} + ${BAKED_BIAS_M.toFixed(1)};
        for (int j = 1; j <= ${BAKED_LIVE_SAMPLES}; j++) {
          float d = ${BAKED_LIVE_M.toFixed(1)} * ${BAKED_LIVE_POW === 1 ? `float(j) / ${BAKED_LIVE_SAMPLES.toFixed(1)}` : `pow(float(j) / ${BAKED_LIVE_SAMPLES.toFixed(1)}, ${BAKED_LIVE_POW.toFixed(3)})`};
          float th = d / 1737400.0;
          float omc = 2.0 * sin(th * 0.5) * sin(th * 0.5);
          vec3 q = normalize(p * (1.0 - omc) + t * sin(th));
          float hq = ${tiles ? 'level >= 0 ? marchHQ(q, int(floor(lodT + 0.5)), lod, 0.0) : heightAt(uvOf(q), 0.0)' : 'heightAt(uvOf(q), 0.0)'};
          best = max(best, degrees(atan(hq - h0 - (1737400.0 + hq) * omc, (1737400.0 + hq) * sin(th))));
        }
        gBakedHit = 1.0; gPshHit = 1.0; gBakedHorizon = best;
        return best;
      }
    }
  }
  // Mode 3 satisfies the existing Fast live-march conditions (uShMode > 0.5).
  float elev = degrees(asin(clamp(dot(p, uS), -1.0, 1.0)));
  return elev > -10.0 && elev < 24.0 ? horizonAt(p, t, lod, lodT) : -90.0;
}
`
}
