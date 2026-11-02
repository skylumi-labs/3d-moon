/** Extract the actual production admission expression, rather than a second policy implementation. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { Vector3 } from 'three'
import { wantsLevel } from '../src/moon/patch/demand.ts'
const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.ES2022, true)
let expression = '', coarseExpression = ''
function visit(node: ts.Node): void {
 if (ts.isCallExpression(node) && node.expression.getText(ast) === 'PL.create') {
  const opts = node.arguments[1]
  assert.ok(ts.isObjectLiteralExpression(opts))
  const prop = opts.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'initialDemand')
  assert.ok(prop && ts.isPropertyAssignment(prop), 'actual PL.create receives current camera demand')
  if (node.arguments[0].getText(ast).includes('MID_PATCH_BASE')) coarseExpression = prop.initializer.getText(ast)
  else expression = prop.initializer.getText(ast)
 }
 ts.forEachChild(node, visit)
}
visit(ast); assert.ok(expression); assert.ok(coarseExpression)
const js = ts.transpileModule('const result = ' + expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const sample = new Function('last', 'rig', 'ephem', 'canvasAspect', 'performance', 'MOON_R_KM', 'site', 'angularDistance', 'canvas', 'PATCH_PREWARM_ARC', 'underCamera', 'MID_PATCH_BASE', js + '; return result')
const site = { lon: 23.473, lat: .6741, groundM: -1928 }
const call = (distance: number, nearby: boolean) => sample({ cam: { pos: new Vector3(distance, 0, 0), tanHalf: Math.tan(Math.PI / 12) } }, {}, {}, () => 1.6, { now: () => 0 }, 1737.4, site, () => nearby ? 0 : 1, { height: 900 }, .05, () => ({ lon: site.lon, lat: site.lat }), false)
const far = call(200, true), wrongPlace = call(1.005, false), close = call(1.005, true)
assert.equal(wantsLevel({ texelM: 8 }, far), false, 'distant selection reaches real create admission as false')
assert.equal(wantsLevel({ texelM: 8 }, wrongPlace), false)
assert.equal(wantsLevel({ texelM: 8 }, close), true, 'real close-camera footprint admits NAC')
assert.match(source, /tweenAt\(tw, now \+ t \* 1000\)/, 'exposure anticipation uses sampled journey frustum (the planned fly-to)')
assert.match(source, /const offs = aheadCameras\(cameraNow, aspect\)/, 'capture look-ahead uses the pinned camera clock while settle renders advance')
console.log('main-demand-integration.test.mts: actual production PL.create admission expression and future-camera wiring: ok (browser interaction unrun)')

const coarseJs = ts.transpileModule('const result = ' + coarseExpression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const coarse = new Function(coarseJs + '; return result')()
assert.equal(wantsLevel({ texelM: 8 }, coarse), false, 'wide origin cannot admit fine NAC during selection')
