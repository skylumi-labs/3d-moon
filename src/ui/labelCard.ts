export type LabelCardKind = 'mare' | 'mission' | 'terminator' | 'crater' | 'mountain' | 'valley' | 'point'
export type LabelMissionStatus = 'crewed' | 'landed' | 'impact' | 'crashed'
export interface LabelCardInput {
  kind: LabelCardKind
  tier: 1 | 2 | 3
  sub?: string
  fact?: string
  agency?: string
  status?: LabelMissionStatus
  /** Feature diameter; the visible label never shows it, so the card does. */
  sizeKm?: number
}
export interface LabelCardLine { kind: 'detail' | 'action'; text: string }

const KIND_WORD: Record<Exclude<LabelCardKind, 'mission' | 'terminator'>, string> = { mare: 'Sea', crater: 'Crater', mountain: 'Mountain', valley: 'Valley or scarp', point: 'Point' }
const STATUS_WORD: Record<LabelMissionStatus, string> = { crewed: 'crewed landing', landed: 'robotic landing', impact: 'impact', crashed: 'crashed' }

/** Keep only hover-card details that add information beyond the visible label. */
export function labelCardLines(l: LabelCardInput, compact = false): LabelCardLine[] {
  const lines: LabelCardLine[] = []
  if (l.kind === 'mare' && l.sub) lines.push({ kind: 'detail', text: l.sub })
  if (l.kind === 'mission') {
    const details = [l.agency, STATUS_WORD[l.status ?? 'landed']].filter(Boolean)
    if (details.length) lines.push({ kind: 'detail', text: details.join(' · ') })
  }
  if (l.fact && (l.tier !== 1 || compact || l.kind === 'terminator')) lines.push({ kind: 'detail', text: l.fact })
  if (l.kind !== 'mission' && l.kind !== 'terminator' && !l.sub && (l.sizeKm ?? 0) > 0) lines.push({ kind: 'detail', text: `${KIND_WORD[l.kind]}, about ${Math.round(l.sizeKm ?? 0).toLocaleString('en')} km across` })
  lines.push({ kind: 'action', text: 'Fly there' })
  return lines
}
