# 3D Moon

**An explorable, high-resolution 3D reconstruction of the Moon, built from real NASA and JAXA data. Runs in your browser. Free and open source.**

[**Explore the Moon**](https://skylumi.org/moon) · [Source code](https://github.com/skylumi-labs/3d-moon) · [Contribute](CONTRIBUTING.md)

[![CI](https://github.com/skylumi-labs/3d-moon/actions/workflows/ci.yml/badge.svg)](https://github.com/skylumi-labs/3d-moon/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

https://github.com/user-attachments/assets/bfb3b48f-dd6e-42d3-b3b0-d6639ba7ed22

## Why I built this

The Moon is one of the most thoroughly mapped places in the solar system.

NASA's Lunar Reconnaissance Orbiter and Japan's Kaguya mission have given us billions of elevation measurements and extraordinary orbital imagery. At the Apollo 17 landing site, we have imagery down to 25 cm per pixel.

Much of this data is publicly available, but exploring it in an accessible, continuous 3D environment is another matter.

I started this project after seeing how capable AI coding agents had become at building browser-based 3D experiences. I wondered what would happen if I pointed them at some of the best scientific data we have of another world.

This is the result.

It's also an open source offshoot of [Skylumi](https://skylumi.org), my stargazing app.

## Explore

Start with the [live explorer](https://skylumi.org/moon). No installation or account required.

A few places worth visiting:

| Experience | What to see |
|---|---|
| [Fly over the surface](https://skylumi.org/3d-moon/?view=fly) | Descend from orbit and explore lunar terrain |
| [Tycho at low Sun](https://skylumi.org/3d-moon/?moment=tycho-rim) | Crater walls and relief under grazing sunlight |
| [Apollo 17](https://skylumi.org/3d-moon/?moment=apollo17-25cm) | Explore Taurus-Littrow with imagery down to 25 cm/pixel |
| [Lunar surface](https://skylumi.org/3d-moon/?moment=land-lm-eye) | Stand near the Apollo 17 lunar module and explore historical panoramas |
| [Earthrise](https://skylumi.org/3d-moon/?moment=earthrise-low) | See Earth above the lunar landscape |
| [Solar eclipse](https://skylumi.org/3d-moon/?moment=solar-eclipse) | Watch Earth pass in front of the Sun, as seen from the Moon |

The app supports desktop and mobile browsers with WebGL 2. Desktop currently provides the best experience, particularly at the highest terrain resolutions.

## What makes it interesting

### Real terrain, not invented landscapes

The globe combines several generations of lunar mapping data:

- **Global terrain:** LOLA laser altimetry from NASA's Lunar Reconnaissance Orbiter, combined with stereo-derived elevation data from JAXA's SELENE/Kaguya mission.
- **Global imagery:** Lunar Reconnaissance Orbiter Wide Angle Camera mosaics.
- **Higher-resolution imagery:** Kaguya Terrain Camera coverage and LRO Narrow Angle Camera imagery at selected locations.
- **Apollo landing sites:** Dedicated terrain and imagery for Apollo 11 and Apollo 17, including the 25 cm/pixel Apollo 17 orthomosaic from Haase et al.

The viewer streams additional detail as you approach the surface rather than loading the highest-resolution datasets all at once.

### The Moon under the real Sun

Choose a date and watch the illumination change.

The positions of the Sun, Earth and Moon are calculated using [Astronomy Engine](https://github.com/cosinekitty/astronomy). Terrain-aware lighting reconstructs shadows from the lunar topography.

This lets you explore crater rims at sunrise, observe the changing terminator, see earthshine on the night side, and experience eclipses from the lunar surface.

The geometry is based on astronomical calculations. Illumination, exposure and material reflectance are rendered models, not photographs.

### From orbit to ground level

The experience is designed around continuous exploration, from a global view to individual valleys and landing sites.

At Apollo 17, you can descend into Taurus-Littrow, inspect the landing-site imagery, and switch to a ground-level view with historical surface panoramas.

The aim is to make scientific observations accessible as places you can explore, without requiring users to navigate GIS software or manually manage geospatial datasets.

## How it works

The viewer is written in TypeScript using **three.js and WebGL 2**, with Vite for development and production builds.

Unlike conventional planetary globes constructed from polygon meshes, the Moon and Earth are rendered using full-screen ray-casting passes.

The main components:

| Component | Implementation |
|---|---|
| Rendering | three.js 0.186, WebGL 2, custom GLSL shaders |
| Terrain | Hierarchical tiled elevation models, including SLDEM2015 and LOLA |
| Imagery | Multiresolution orbital mosaics and site-specific high-resolution patches |
| Level of detail | Screen-resolution-driven tile selection and streaming |
| Lighting | Terrain-aware solar illumination, horizon data and height-field shadow evaluation |
| Astronomy | Astronomy Engine for Sun, Earth and Moon geometry |
| Performance | Asynchronous tile loading and decoding, GPU rendering, device-specific quality settings |
| Deployment | Static web application with separately hosted data tiles |

Terrain and imagery are fetched at resolutions appropriate to the current view. Expensive decoding work is handled off the main rendering path.

The application deliberately targets WebGL 2 rather than requiring WebGPU, to support a broader range of devices.

The site itself requires no application backend. Large terrain and imagery datasets are served as static assets.

## Run locally

Requires Node.js 22 or newer and npm.

```bash
git clone https://github.com/skylumi-labs/3d-moon.git
cd 3d-moon

nvm use
npm ci
npm run dev
```

Open **http://localhost:5190/moon/**.

The default development mode works offline using the bundled 4K lunar maps. Higher-resolution imagery and terrain require additional data.

To develop against the publicly hosted data tiles:

```bash
npm run dev:hosted
```

This streams supported terrain, imagery and Apollo-site datasets from the project's public data mirror. The mirror is provided on a best-effort basis, without a service-level guarantee.

Other useful commands:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run preview
```

Production builds are static and can be served from any compatible web host. See [`.env.example`](.env.example) for tile sources, local datasets and deployment configuration.

## Data sources and scientific accuracy

This project combines data from multiple scientific missions, instruments and research groups. Their coverage and spatial resolution differ.

| Dataset | Role |
|---|---|
| NASA LRO / LOLA | Global elevation measurements |
| SLDEM2015 | Combined LOLA and Kaguya stereo terrain, approximately 59 m grid spacing in its principal latitude range |
| LROC WAC | Global lunar imagery |
| JAXA SELENE/Kaguya Terrain Camera | Additional surface imagery and elevation measurements |
| LROC NAC | High-resolution Apollo-site imagery and terrain |
| Haase et al., Apollo 17 | 25 cm orthomosaic and 1.5 m terrain model of Taurus-Littrow |
| NASA Apollo mission archives | Mission records, surface panoramas and landing-site context |

An important distinction: **25 cm/pixel imagery does not mean 25 cm terrain elevation resolution.** Image detail, terrain geometry and reconstructed lighting have different sources and accuracies.

Likewise, some elements of the experience are modelled rather than directly observed, including illumination, exposure, parts of the landing-site presentation and reconstructed surface details.

The intention is to be explicit about those differences rather than imply more precision than the underlying data supports.

See [DATA-LICENSES.md](DATA-LICENSES.md) for individual datasets, usage terms, scientific citations and required attribution. The application also includes contextual credits.

## Contributing

There's plenty left to explore and improve.

Some particularly interesting areas include:

- Improving mobile performance, tile streaming and memory usage.
- Extending high-resolution coverage to additional Apollo landing sites.
- Improving terrain and imagery near the lunar poles.
- Refining shadow rendering and visual accuracy across different lighting conditions.
- Building new ways to explore, annotate and understand lunar geography.
- Making the experience more useful to educators, researchers and amateur astronomers.

Bug reports, ideas, documentation improvements and pull requests are welcome.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code. Contributions require DCO-signed commits and acceptance of the project's [contributor license agreement](CLA.md).

For security issues, see [SECURITY.md](SECURITY.md).

## Built with AI coding agents

This project was developed with extensive help from AI coding agents.

I directed the work, defined the experience, evaluated alternatives and reviewed results, while agents implemented much of the rendering, data processing, testing and optimization.

Beyond writing code, agents helped run experiments, compare rendering approaches and measure performance on GPU-equipped machines.

It has been an interesting experiment in what a small project can accomplish with these tools.

More broadly, I hope projects like this make it easier for people to build new ways of experiencing the extraordinary scientific datasets that researchers and public institutions have already created.

## License

The application code is licensed under the **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**.

See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The scientific datasets, imagery, photographs and other third-party assets have separate terms. See [DATA-LICENSES.md](DATA-LICENSES.md).

The SkyLumi name and logo are subject to [TRADEMARKS.md](TRADEMARKS.md).

Commercial licensing inquiries: hello@corsierlabs.com.

## Acknowledgements

This project would not exist without the work of the scientists, engineers and institutions that made these datasets available.

In particular:

NASA's Lunar Reconnaissance Orbiter mission, LOLA, the LROC team at Arizona State University, NASA's Scientific Visualization Studio, JAXA's SELENE/Kaguya mission and DARTS archive, USGS Astrogeology, Haase et al. for the Apollo 17 landing-site mapping, NASA's Apollo mission archives, and the open source developers behind three.js and Astronomy Engine.

**[Explore the Moon](https://skylumi.org/moon)**

Part of [Skylumi](https://skylumi.org), an interactive way to explore the night sky.
