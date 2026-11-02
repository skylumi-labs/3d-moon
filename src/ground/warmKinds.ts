import type { GroundKind } from './groundShader'

/**
 * Which ground-pass programs are compiled ahead of the first ground frame (GroundPass.warm), in the order a ground frame first needs them. Kept apart from
 * the pass so the list changes in one small place. The independent metadata program is drawn only by a visibility calibration or an audit, so a
 * visitor's warm-up leaves it out (R50); `metadataWanted` adds it for those runs.
 */
export type GroundWarmKind = GroundKind

export function groundWarmKinds(metadataWanted: boolean): readonly GroundWarmKind[] {
  return metadataWanted ? ['cover', 'shade', 'probe', 'metadata'] : ['cover', 'shade', 'probe']
}
