import assert from 'node:assert/strict'
import fs from 'node:fs'
import { descentReached } from '../src/descent/reach.ts'

// Measured on an L4: the Apollo 17 end pose backs 8.6 km off the site, outside its 1.5 km terrain model, so the funnel
// floor (7.92e-3 radii above the sphere) holds the camera while the pose the descent asks for is 2.7e-4 below it.
const ideal = 1 - 2.7418e-4, floor = 1 + 7.9208e-3
assert.equal(descentReached(floor, ideal, floor), true, 'a camera held at the floor has reached the end of the descent')
assert.equal(descentReached(floor + 1e-3, ideal, floor), false, 'above the floor it has not')
assert.equal(descentReached(ideal + 1e-5, ideal, 0), false, 'with no floor in the way, a camera still above the end pose has not arrived')
assert.equal(descentReached(ideal, ideal, 0), true)
assert.match(fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), /descentReached\(rig\.pose\.dist, ideal\.dist, rig\.floorAt\(ideal\.lon, ideal\.lat\)\)/, 'main gates the end of the descent on it')
console.log('descent-reach.test.mts: end of descent counts the site floor: ok')
