/**
 * Did the GPU accept a compiled program? three's compileAsync resolves once the driver is done, whether or not the link worked, and never rejects
 * for a link failure, so a caller that marks a variant ready on resolve would draw a program that does nothing (a black Moon).
 * Written against minimal structural types so scripts/link-status.test.mts runs it with fakes, no WebGL.
 */
export interface LinkGl { LINK_STATUS: number; getProgramParameter(program: unknown, pname: number): unknown }
export interface LinkRenderer {
  properties?: { get(object: any): unknown }
  getContext?(): LinkGl
}

/** 'failed' when the driver refused the link, 'ok' when it accepted it, 'unknown' when no program is attached yet (treated as usable by callers). */
export function linkOutcome(renderer: LinkRenderer, material: unknown): 'ok' | 'failed' | 'unknown' {
  try {
    const prog = (renderer.properties?.get(material) as { currentProgram?: { program?: unknown } } | undefined)?.currentProgram?.program
    const gl = renderer.getContext?.()
    if (!prog || !gl) return 'unknown'
    return gl.getProgramParameter(prog, gl.LINK_STATUS) === false ? 'failed' : 'ok'
  } catch { return 'unknown' }
}
