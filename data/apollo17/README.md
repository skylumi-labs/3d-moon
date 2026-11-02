# `data/apollo17/`: Apollo 17 site data

Small derived files the viewer and its build scripts read for the Apollo 17 landing site (Taurus-Littrow). Nothing here is a raw
source download: the large rasters (the 25 cm orthomosaic, the 1.5 m DTM, the 50 cm mosaic) stay out of git and are served as tiles.
Terms and credits for the whole folder are in [`DATA-LICENSES.md`](../../DATA-LICENSES.md) (rows `apollo-17-tier` and
`apollo-17-flight`); every file's SHA-256 is in [`DATA-SHA256SUMS.txt`](../../DATA-SHA256SUMS.txt).

## Upstream package

Most files derive from the Haase et al. Apollo 17 landing-site package (`Apollo17_PDS_fullPackage_Haase.zip`, PDS3, publication
date 2018-04-09), distributed through the USGS PDS Annex:

- I. Haase, M. Wählisch, P. Gläser, J. Oberst and M. S. Robinson (2019), *Coordinates and Maps of the Apollo 17 Landing Site*,
  Earth and Space Science 6(1), 59-95, [doi:10.1029/2018EA000408](https://doi.org/10.1029/2018EA000408).
- USGS record: [Apollo 17 LROC NAC landing site orthomosaic 50 cm](https://astrogeology.usgs.gov/search/map/moon_apollo_17_lroc_nac_landing_site_orthomosaic_50cm).
  Access constraints: none. Use constraints: "Please cite authors." The images are LROC NAC (NASA/GSFC/Arizona State University).

`package-SHA256.txt` lists the SHA-256 of every file of that package as downloaded (the large `.IMG` and `.TIFF` files included,
although they are not in git). It is the provenance record for the files below.

## Files

| File | What it is | Source | Kind |
|---|---|---|---|
| `source/AAREADME.TXT`, `source/APOLLO17_CONTROLPOINTS_2018.LBL`, `source/APOLLO17_CONTROLPOINTS_2018.TAB` | Unmodified copies of three package files | Haase et al. package (`./AAREADME.TXT`, `./DATA/...` in `package-SHA256.txt`) | upstream, verbatim |
| `a17-controlpoints.json` | Control points (stations, ALSEP, LM) converted from the TAB, cross-checked against the shapefile | `DATA/APOLLO17_CONTROLPOINTS_2018.TAB`, `EXTRAS/GIS/APOLLO17_CONTROLPOINTS_2018.SHP` | converted |
| `a17-traverse.json` | The nine LRV/EVA traverse lines | `EXTRAS/GIS/APOLLO17_TRAVERSE_2018.SHP` | converted |
| `haase-tier.manifest.json` | Placement of the 25 cm tier (`patch/a17/Lm1.*` on the mirror) in the A17 patch frame | `DATA/APOLLO17_M168000580RE_25CM.IMG`, `DATA/APOLLO17_DTM_150CM.IMG` | project metadata |
| `registration.json`, `registration-summary.json` | Shifts fitted between the 25 cm image, the 50 cm mosaic, the DTM and the existing patch | the package rasters and the project's A17 patch | project measurement |
| `lm1-mask.json` | The region of the 25 cm tier where the 2011 LM descent stage and its shadow were filled out | `DATA/APOLLO17_M168000580RE_25CM.IMG` | project edit record |
| `a17-tracks-snapped.json`, `a17-track-network-lm.json`, `a17-trace-network-v2.json` | Rover and boot tracks traced by eye on the 25 cm image and snapped to the image | `DATA/APOLLO17_M168000580RE_25CM.IMG` | project derivation |
| `a17-disturbed-soil.json` | Brightness profiles around the LM and stations | `DATA/APOLLO17_M168000580RE_25CM.IMG` | project measurement |
| `arbiter/*.json` | Fit and detectability results used to choose the track rendering | the files above | project measurement |
| `trace-decals/*` (`d_*.bin.gz`, `stamps*.png`, `stamps.json`, `manifest.json`, previews) | Height decals of wheel and boot traces placed along the traced tracks | track positions from the files above; the stamp shapes are **modelled** by the project (see `stamps.json`), not measured imprints | project derivation, modelled |
| `descent-track.json` | Apollo 17 powered-descent reference track | Apollo 17 Mission Report (JSC-07904) and the Apollo Lunar Surface Journal, through `cloud/g2a/build_descent.py`; interpolated intervals are modelled | project derivation from mission records |

"Project derivation" and "project measurement" files are this project's own work from the sources named; they claim no more than
those sources support. `trace-decals/manifest.json` says so for the traces: positions come from the 25 cm image with sigma about
0.5 m; the decal relief is modelled surface detail, not a measurement of any imprint.

## Credit

When you reuse these files, cite Haase et al. (2019) and credit LROC NAC (NASA/GSFC/Arizona State University); for
`descent-track.json`, credit the NASA Manned Spacecraft Center mission report and the Apollo Lunar Surface Journal by Eric M. Jones
and Ken Glover.
