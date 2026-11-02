/**
 * Apollo 17 as ground mode knows it (G1). Positions are in the Haase package's own frame
 * (Haase et al. 2019, the LROC NAC orthoimage and DTM the 25 cm tier is cut from) plus the shift that
 * registers that frame to the base patch, measured against the patch's L0 (median over
 * 8 windows, std 0.4 m east and 0.14 m north): add 12.7 m east and 7.2 m north.
 */

/** The lunar module (Challenger, LM-12) in the Haase frame: the control point, degrees. Measured (photograph). */
export const LM_HAASE = { lon: 30.7716815, lat: 20.1909097 }
/** Metres east and north from the Haase frame to the base patch's. */
export const HAASE_TO_PATCH_EN: readonly [number, number] = [12.7, 7.2]

/** The attitude the crew reported after landing (ALSJ 114:10:14, Cernan): "about 5 degrees pitchup" and "about 2 degrees left (roll)". Nose up and left side down, degrees. A report by ear, not a measurement. */
export const LM_REPORTED_PITCH_DEG = 5
export const LM_REPORTED_ROLL_DEG = 2
