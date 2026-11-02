import assert from 'node:assert/strict'
import { hashManifests, verifyServedIdentity, verifyDataIdentity, type AuditIdentity } from '../audit/identity.mts'
const manifests = { 'https://fixture/patch/manifest.json': 'b'.repeat(64) }
const expected: AuditIdentity = { commit: 'c'.repeat(40), bundleSha256: 'a'.repeat(64), dataManifestSha256: hashManifests(manifests), development: false }
const actual = { commit: expected.commit, dirty: false, bundleSha256: expected.bundleSha256 }
verifyServedIdentity(expected, actual); verifyDataIdentity(expected, manifests)
assert.throws(() => verifyServedIdentity(expected, { ...actual, commit: 'd'.repeat(40) }), /match/)
assert.throws(() => verifyServedIdentity(expected, { ...actual, dirty: true }), /match/)
assert.throws(() => verifyServedIdentity(expected, { ...actual, bundleSha256: 'e'.repeat(64) }), /match/)
assert.throws(() => verifyDataIdentity(expected, {}), /match/)
assert.throws(() => verifyDataIdentity(expected, { ...manifests, other: 'f'.repeat(64) }), /match/)
assert.throws(() => verifyDataIdentity({ ...expected, development: true }, manifests), /incomplete/)
console.log('audit-identity.test.mts: exact clean build/bundle/data identity and incomplete development evidence: ok')
