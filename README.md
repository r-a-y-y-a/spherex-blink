<div align="center">

# BLINKx

**Blink through NASA SPHEREx images at light speeds to find moving worlds**

## 🔭 [Try it live: blinkx-nasa.vercel.app](https://blinkx-nasa.vercel.app)

No install, no sign-up: it opens on Barnard's Star and runs in any browser.

[![BLINKx showing WISE 0855, the coldest known brown dwarf, at 4.7 µm with NASA WISE confirming its motion](https://blinkx-nasa.vercel.app/readme-screenshot.png)](https://blinkx-nasa.vercel.app/?target=wise-0855&group=all&smooth=1&gaia=1&fov=32&bands=6&wise=1)

<sub>WISE 0855, the coldest known brown dwarf, appearing at 4.7 µm exactly where its motion predicts, with NASA WISE's catalogue tagging it "8.1″/yr". Click the image to open this view.</sub>

</div>

## About

BLINKx is our entry for the NASA Space Apps Challenge 2026 challenge "Planet X and SPHEREx".
Type any star name or sky coordinates and it plays every NASA SPHEREx infrared image of that spot as a flipbook, so anything that moves or changes stands out.
Switch between SPHEREx's six wavelength bands, subtract frames to light up what moved, pin an object twice to measure its speed, and check what you find against the Gaia and NASA WISE catalogues.
The five challenge targets load instantly from the sidebar; any other position is searched live in NASA's archive and loads in about 10-30 seconds.

## Why it matters

Cold brown dwarfs and possible distant planets are faint in visible light but glow in the infrared, and finding them takes many human eyes.
Citizen-science projects like Backyard Worlds showed that volunteers blinking images can find them.
BLINKx brings that method to SPHEREx's new all-sky infrared data, so students, amateurs and researchers can search it with nothing but a browser.

## What it finds, checked on real data

- **Barnard's Star moves.** Pinning it in the first and last survey pass measures 10.2″/yr due north; the catalogue proper motion is 10.4″/yr.
- **WISE 0855, the coldest known brown dwarf, only appears in the reddest light.**
  At 0.9 µm (D1) the only light is a background Gaia star.
  At 4.4-5.0 µm (D6) the light sits on the spot its proper motion predicts, and NASA WISE's own catalogue marks the same object moving 8.1″/yr.
- **Epsilon Indi B shows a T dwarf's methane bands.**
  Its spectrum, built from 458 exposures that each sample a slightly different wavelength, has the deep absorption dips of a cold brown dwarf.
- **R Draconis varies.**
  It sits near the ecliptic pole, where SPHEREx looks almost every day, and its brightness changes several-fold across the year, as expected for a Mira variable.
  It is bright enough that some single-day points are affected by saturation, so read the trend rather than each point.

## Features

- **Search anything.** Finds every SPHEREx Level 2 spectral image covering a position through the NASA/IPAC IRSA archive (Simple Image Access, with TAP as a fallback), including newly released quick-release data.
- **Reads only what it needs.** Pulls just the needed pixels straight from NASA's public S3 copy of the archive with HTTP Range requests, then turns each frame north-up so frames taken at different spacecraft orientations line up.
- **Any wavelength.** Stacks frames per 6-month survey pass, per day, or shows every exposure, within any range from 0.75 to 5.0 µm, picked with a slider or by switching any combination of the six detector bands (D1-D6) on and off.
- **Difference mode.** Subtracts the median of all frames or one chosen frame (A − B), so anything that moved or changed brightness lights up orange and blue.
- **Spectra and light curves.** Click anywhere on the image for a spectrum (every exposure samples a slightly different wavelength) and a brightness-over-time curve.
- **Pins that measure motion.** Drop numbered pins that stay fixed on the sky while the flipbook plays, and pin a mover again in a later frame to get its speed in arcsec/yr and its direction.
- **Explore mode.** Arrow tabs on the image edges (or Shift + arrow keys) step the view one field north, south, east or west, to sweep the sky around a target the way Backyard Worlds volunteers do.
  The four neighbouring views preload in the background, so a step usually shows in well under a second.
  The header shows how far you are from where you started, with a link back.
- **Second-telescope checks.** Overlay Gaia DR3 stars (moved to each frame's date) and CatWISE2020 sources from NASA's WISE survey; objects WISE measured moving get an arrow and their speed.
  False catalogue motions around bright saturated stars are filtered out using Gaia.
- **Quality flags.** Pipeline flags (saturation, ghosts, streaks, cosmic rays and more) are read from each image's RICE-compressed FLAGS extension; flagged exposures show hollow in the spectrum and can be skipped.
- **Sky coordinates everywhere.** RA/Dec axis labels, an optional coordinate grid, a colour bar in MJy/sr, and a readout of the position, pixel value and any Gaia or WISE source under the pointer.
- **Known movers.** A dashed circle shows where catalogue proper motion predicts the target on each date.
- **Built-in help.** An (i) button beside each group of controls explains what it does and when to use it.
- **Shareable views.** Every view is a URL, for example:
  - [`/?target=wise-0855&bands=6&wise=1`](https://blinkx-nasa.vercel.app/?target=wise-0855&bands=6&wise=1)
  - [`/?target=barnards-star&mode=diff&ref=61270.86`](https://blinkx-nasa.vercel.app/?target=barnards-star&mode=diff&ref=61270.86) (A − B against Aug 2026)
  - [`/?ra=133.75988&dec=-7.24220`](https://blinkx-nasa.vercel.app/?ra=133.75988&dec=-7.24220)

  Parameters include `bands` (detector list), `wmin`/`wmax` (custom range), `group`, `mode=diff`, `ref`, `fov`, `smooth`, `gaia`, `wise`, `grid`, `pins` (`ra,dec,mjd;...`), and `origin`/`near` in Explore mode.
  Explore links keep the exact explored spot and still open quickly when NASA's archive search is slow, because the starting point's image list seeds them.
  Add `&embed=1` to hide the header and sidebar for embedding.

## How it works

- **Frontend** (`src/`): React, Vite, Tailwind CSS and shadcn/ui, drawing images and charts with Canvas and SVG.
- **API** (`api/index.ts`): Express as a single Vercel function, in the same AWS region as NASA's S3 bucket, so live frames are cut next to the data (browsers only get 6 connections to S3).
  - `/api/search`: archive search, cached in Supabase.
  - `/api/cutouts`: batch frame cutting.
  - `/api/gaia`: Gaia DR3 stars, via IRSA with ESA's archive as a fallback.
  - `/api/wise`: CatWISE2020 sources and movers.
  - `/api/resolve`: SIMBAD name lookup.
  - `/api/health`.
- **SPHEREx code written from scratch** (`src/lib/spherex/`): FITS header parsing, TAN-SIP WCS, wavelength lookup, RICE decompression of quality flags and Range-read cutouts.
  It runs in both the browser and Node.
- **Reliability.** IRSA services are retried automatically, since they intermittently return fast 502 errors.
  Catalogue lookups use IRSA's Gator cone search, which answers in seconds where TAP can take minutes.
- **Storage.** Supabase holds the `searches` table (archive search cache, schema in `supabase/schema.sql`) and a public `frames` bucket with the five challenge targets pre-cut so they load instantly.

## Run it locally

```sh
npm install
vercel link            # once, project "spherex-blink"
vercel env pull .env.local
vercel dev             # frontend + API on http://localhost:3000
```

Environment variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server only) and `VITE_SUPABASE_URL` (frontend, public storage reads).

To use another API, such as production's (useful for realistic live-loading speed, since a local API is usually far from NASA's S3 bucket):

```sh
API_PROXY=https://blinkx-nasa.vercel.app npx vite
```

Re-cut the demo targets (for example after a new data release):

```sh
node --env-file=.env.local scripts/seed.ts               # all five
node --env-file=.env.local scripts/seed.ts wise-0855     # just one
```

## Demo script (30 s, recorded and sped up)

1. The site opens on **Barnard's Star**, playing its three survey passes as a flipbook.
2. Switch to **3′** and **Difference**: the fastest star in the sky leaves a blue/orange pair as it moves north.
3. Back to **Image**, switch the toggle under the image to the pin, and pin the star in the first and last pass: 10.2″/yr north.
4. Open **WISE 0855** from the sidebar.
   With only **D1** on, the light sits on a Gaia background star.
   With only **D6** on, it shifts onto the dashed circle where the brown dwarf's motion predicts it.
   Turn on **WISE**: the catalogue tags it "WISE 8.1″/yr".
5. Open **Epsilon Indi B** and enlarge the spectrum: the methane dips of a T dwarf.
6. Type **TRAPPIST-1** in the search box: a position never seen before loads live from NASA's archive.

## Credits

### NASA data and services

- [SPHEREx Level 2 Spectral Images](https://irsa.ipac.caltech.edu/Missions/spherex.html) from the NASA/IPAC Infrared Science Archive (IRSA), read from its [public AWS S3 copy](https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/).
- IRSA's [Simple Image Access](https://irsa.ipac.caltech.edu/SIA), [TAP](https://irsa.ipac.caltech.edu/TAP) and [Gator](https://irsa.ipac.caltech.edu/applications/Gator/) services.
- [CatWISE2020](https://catwise.github.io/) (Marocco et al. 2021), built from NASA [WISE](https://science.nasa.gov/mission/wise/) and NEOWISE data, via IRSA.
- [NASA SPHEREx mission](https://science.nasa.gov/mission/spherex/).

### Partner and other data

- [ESA Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3), via IRSA with the [ESA Gaia Archive](https://gea.esac.esa.int/archive/) as a fallback.
- [SIMBAD](https://simbad.cds.unistra.fr/simbad/) (CDS, Strasbourg) for object names, positions and proper motions.

### Software, icons and fonts

- [React](https://react.dev), [TypeScript](https://www.typescriptlang.org), [Vite](https://vite.dev), [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [Radix UI](https://www.radix-ui.com), [Express](https://expressjs.com), [Supabase](https://supabase.com), [Vercel](https://vercel.com), [Node.js](https://nodejs.org), [Playwright](https://playwright.dev) and [Oxlint](https://oxc.rs).
- [Lucide](https://lucide.dev) icons; [Geist and Geist Mono](https://vercel.com/font) and [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) fonts via [Fontsource](https://fontsource.org).
- Built with help from [Claude Code](https://claude.com/claude-code).
