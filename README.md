# BLINKx

**Live: [blinkx-nasa.vercel.app](https://blinkx-nasa.vercel.app)**

A public web tool for the NASA Space Apps 2026 challenge "Planet X and SPHEREx".
Type any star name or sky coordinates to watch every NASA SPHEREx infrared image of that spot play as a flipbook, so moving and changing objects stand out.
It opens on Barnard's Star, with the five challenge targets in a sidebar.
Any other position is searched live in NASA's archive and loads in about 10-30 seconds.

## What it finds, checked on real data

- **Barnard's Star moves.** Pinning it in the first and last survey pass measures 10.2″/yr due north; the catalogue proper motion is 10.4″/yr.
- **WISE 0855, the coldest known brown dwarf, only appears in the reddest light.** At 0.9 µm (D1) the only light is a background Gaia star. At 4.4-5.0 µm (D6) the light sits on the spot its proper motion predicts, and NASA WISE's own catalogue marks the same object moving 8.1″/yr.
- **Epsilon Indi B shows a T dwarf's methane bands.** Its spectrum, built from 458 exposures that each sample a slightly different wavelength, has the deep absorption dips of a cold brown dwarf.
- **R Draconis varies.** It sits near the ecliptic pole, where SPHEREx looks almost every day, and its brightness changes several-fold across the year, as expected for a Mira variable. It is bright enough that some single-day points are affected by saturation, so read the trend rather than each point.

## What it does

- Finds every SPHEREx Level 2 spectral image covering a position through the NASA/IPAC IRSA archive (Simple Image Access, with TAP as a fallback), including newly ingested quick-release data.
- Reads only the needed pixels straight from NASA's public S3 copy of the archive with HTTP Range requests, then reprojects each frame north-up so frames taken at different spacecraft orientations line up.
- Stacks frames per 6-month survey pass, per day, or shows every exposure, within any wavelength range from 0.75 to 5.0 microns, picked with a slider or by switching any combination of the six detector bands (D1-D6) on and off, with an All checkbox.
- Difference mode subtracts a reference, either the median of all frames or one chosen frame (A − B), so anything that moved or changed brightness stands out.
- Click anywhere on the image to get a spectrum (every exposure samples a slightly different wavelength, so all of them together make a spectrum) and a brightness-over-time curve.
- Pipeline quality flags (saturation, ghosts, streaks, cosmic rays and more) are read from each image's RICE-compressed FLAGS extension at the target. Flagged exposures show hollow in the spectrum, are listed per frame, and can be skipped.
- Gaia DR3 stars can be overlaid, each moved to the frame's date with its proper motion.
- CatWISE2020 sources from NASA's WISE survey can be overlaid too; objects WISE measured moving get an arrow and their speed, as an independent check from a second telescope. Spurious catalogue motions around bright saturated stars are filtered out using Gaia.
- Live positions are cut by the API in batches, in the same AWS region as NASA's S3 bucket (browsers only get 6 connections to S3).
- RA/Dec axis labels on the image edges, an optional coordinate grid, a colour bar in MJy/sr, and a readout of the sky position, pixel value and any Gaia or WISE source under the pointer.
- Pins, like Backyard Worlds marks: drop numbered pins that stay fixed on the sky while the flipbook plays, and pin a mover again in a later frame to measure its motion (arcsec/yr and direction). Pins are saved in the share link (`&pins=ra,dec,mjd;...`).
- An (i) button beside each group of controls explains what it does and when to use it.
- Known movers show a dashed circle where catalogue proper motion predicts them on each date.
- Explore mode: arrow tabs on the image edges (or Shift + arrow keys) step the view one field north, south, east or west, with a little overlap, to sweep the sky around a target the way Backyard Worlds volunteers do.
  The header shows Explore mode, how far you are from where you started, and a link back.
  The four neighbouring views are preloaded in the background, so a step usually shows its image in well under a second, and a step reuses the image list of the spot before it instead of searching the archive again.
  Share links keep the exact explored spot (`ra`, `dec`, plus `origin` and `near` for where exploring started), and open quickly even when NASA's archive search is slow, because the start's image list seeds them.
- Every view is a shareable URL, e.g. `/?target=wise-0855&bands=6&wise=1`, `/?target=barnards-star&mode=diff&ref=61270.86` (A − B against Aug 2026) or `/?ra=133.75988&dec=-7.24220`.
  Parameters include `bands` (detector list), `wmin`/`wmax` (custom range), `group`, `mode=diff`, `ref`, `fov`, `smooth`, `gaia`, `wise`, `grid`, `pins`, and `origin`/`near` in Explore mode.
  Add `&embed=1` to hide the header and sidebar for embedding.
- The five challenge targets (Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis) are pre-cut into Supabase Storage so they load instantly.

## Stack

- Frontend: React, Vite, Tailwind, shadcn/ui (`src/`).
- API: Express as a single Vercel function (`api/index.ts`): `/api/search` (archive search, cached in Supabase), `/api/cutouts` (batch frame cutting), `/api/gaia` (Gaia DR3 stars, via IRSA with ESA's archive as a fallback), `/api/wise` (CatWISE2020 sources and movers), `/api/resolve` (SIMBAD name lookup), `/api/health`.
- Shared SPHEREx code (`src/lib/spherex/`): FITS header parsing, TAN-SIP WCS, wavelength lookup, Range-read cutouts. Runs in both the browser and Node.
- IRSA services are retried automatically, since they intermittently return fast 502 errors; catalogue lookups use IRSA's Gator cone search, which answers in seconds where TAP can take minutes.
- Supabase: `searches` table (archive search cache, schema in `supabase/schema.sql`) and a public `frames` storage bucket.

## Run it

```sh
npm install
vercel link            # once, project "spherex-blink"
vercel env pull .env.local
vercel dev             # frontend + API on http://localhost:3000
```

Environment variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server only) and `VITE_SUPABASE_URL` (frontend, public storage reads).

Re-cut the demo targets (for example after a new data release):

```sh
node --env-file=.env.local scripts/seed.ts               # all five
node --env-file=.env.local scripts/seed.ts wise-0855     # just one
```

## Demo script (30 s, recorded and sped up)

1. The site opens on **Barnard's Star**, playing its three survey passes as a flipbook.
2. Switch to **3′** and **Difference**: the fastest star in the sky leaves a blue/orange pair as it moves north.
3. Back to **Image**, switch the toggle under the image to the pin, and pin the star in the first and last pass: 10.2″/yr north.
4. Open **WISE 0855** from the sidebar. With only **D1** on, the light sits on a Gaia background star. With only **D6** on, it shifts onto the dashed circle where the brown dwarf's motion predicts it. Turn on **WISE**: the catalogue tags it "WISE 8.1″/yr".
5. Open **Epsilon Indi B** and enlarge the spectrum: the methane dips of a T dwarf.
6. Type **TRAPPIST-1** in the search box: a position never seen before loads live from NASA's archive.

## Data credit

SPHEREx Level 2 spectral images from the NASA/IPAC Infrared Science Archive (IRSA), read from its public AWS S3 copy.
Object positions and proper motions from SIMBAD (CDS, Strasbourg).
Star overlays from ESA Gaia DR3 and NASA WISE (CatWISE2020, Marocco et al. 2021), both via IRSA.
