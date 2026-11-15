# BLINKx

A public web tool for the NASA Space Apps 2026 challenge "Planet X and SPHEREx".
It opens on Barnard's Star, with the five challenge targets in a sidebar. Type any star name or sky coordinates to watch every NASA SPHEREx infrared image of that spot play as a flipbook, so moving and changing objects stand out.

## What it does

- Finds every SPHEREx Level 2 spectral image covering a position through the NASA/IPAC IRSA archive (Simple Image Access, with TAP as a fallback), including newly ingested quick-release data.
- Reads only the needed pixels straight from NASA's public S3 copy of the archive with HTTP Range requests, then reprojects each frame north-up so frames taken at different spacecraft orientations line up.
- Stacks frames per 6-month survey pass, per day, or shows every exposure, within any wavelength range from 0.75 to 5.0 microns, picked with a slider or from/to detector dropdowns (D1-D6), with an All checkbox.
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
- Every view is a shareable URL, e.g. `/?target=wise-0855&wmin=4.42&wmax=5.00&mode=diff` or `/?ra=133.75988&dec=-7.24220`. Add `&embed=1` to hide the header for embedding.
- The five challenge targets (Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis) are pre-cut into Supabase Storage so they load instantly.

## Stack

- Frontend: React, Vite, Tailwind, shadcn/ui (`src/`).
- API: Express as a single Vercel function (`api/index.ts`): `/api/search` (archive search, cached in Supabase), `/api/cutouts` (batch frame cutting), `/api/gaia` (Gaia DR3 stars), `/api/wise` (CatWISE2020 sources and movers), `/api/resolve` (SIMBAD name lookup), `/api/health`.
- Shared SPHEREx code (`src/lib/spherex/`): FITS header parsing, TAN-SIP WCS, wavelength lookup, Range-read cutouts. Runs in both the browser and Node.
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

1. The site opens on **Barnard's Star**: the three survey passes play as a flipbook. The other challenge targets are in the left sidebar.
2. Switch to **3′** and **Difference**: the fastest star in the sky leaves a blue/orange pair as it moves north.
3. Open **WISE 0855** (opens as a smoothed deep stack with Gaia stars). At **D1** the light sits on a Gaia background star. Pick **D6** in both wavelength boxes (4.4-5.0 µm): the light shifts onto the dashed circle where the brown dwarf's motion predicts it.
4. Open **Epsilon Indi B**: the spectrum, built from hundreds of exposures that each see a slightly different wavelength, shows the methane bands of a T dwarf.
5. Open **RW Aurigae**: its spectrum rises toward 5 µm (the dusty disk) and differs between survey passes, because the star varies. Copy the share link.

## Data credit

SPHEREx Level 2 spectral images from NASA/IPAC Infrared Science Archive (IRSA).
Object positions and proper motions from SIMBAD (CDS, Strasbourg).
Star overlays from ESA Gaia DR3 and NASA WISE (CatWISE2020), both via IRSA.
