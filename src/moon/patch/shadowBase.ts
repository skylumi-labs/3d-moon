/** The patch shadow cache's base layer: a square of this half extent (metres) around the site, at this texel (metres), holds the horizon over the composite ground (patch levels over the tiles) where no cached patch level is fully weighted (levels not resident, the fade rings, the tiles' ground beside the patch). */
export const PSH_BASE_HALF_M = 48000
export const PSH_BASE_TEXEL_M = 96
/** A pixel reads the cache when its march level (the tile level of its footprint) is at most this many levels coarser than the finest the build used: its footprint then spans a few cache texels, so the finest horizon sits within the penumbra of the filtered one. */
export const PSH_LM_SLACK = 1
