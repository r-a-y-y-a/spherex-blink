/** Plain-language help for each group of viewer controls, shown behind the (i) buttons. */
export type HelpTopic = {
  title: string
  intro?: string
  items: { name: string; text: string }[]
}

export const HELP = {
  wavelength: {
    title: 'Wavelength',
    intro:
      'SPHEREx sees 0.75-5.0 µm infrared light. Its filters change colour across each detector, so every exposure catches the target at a slightly different wavelength.',
    items: [
      {
        name: 'Range slider',
        text: 'Picks which wavelengths are stacked into the image. A narrow range is a purer colour but uses fewer exposures, so it is noisier.',
      },
      {
        name: 'D1-D6',
        text: 'Jump to one detector band (the number under each is its middle wavelength in µm). Stars are brightest in D1-D3. Cold brown dwarfs like WISE 0855 only show up in D5-D6.',
      },
      {
        name: 'All',
        text: 'Every wavelength at once: the deepest image, but colour information is lost.',
      },
      {
        name: 'Use it to',
        text: 'Tell objects apart. Something that appears or brightens as you slide red is cold or dusty; something that fades is a hot star.',
      },
    ],
  },
  frames: {
    title: 'Frames',
    intro: 'How exposures are combined into the frames of the flipbook. Each frame is a median stack, which removes cosmic rays and noise.',
    items: [
      {
        name: 'All',
        text: 'One deep image from every exposure in the band. Best for finding faint objects, but nothing moves.',
      },
      {
        name: 'Per pass',
        text: 'One frame per 6-month survey pass. Best for slow movers like nearby stars, which shift a pixel or two per year.',
      },
      {
        name: 'Per day',
        text: 'One frame per observing day. Shows changes within a pass, like a variable star brightening.',
      },
      {
        name: 'Each',
        text: 'Every single exposure, unstacked. Noisy, but shows fast movers such as asteroids and lets you inspect bad frames.',
      },
      {
        name: 'Skip flagged exposures',
        text: 'Leaves out exposures where the pipeline marked the target pixels as saturated, ghosted, hit by a cosmic ray or otherwise unreliable.',
      },
    ],
  },
  display: {
    title: 'Display',
    items: [
      {
        name: 'Image',
        text: 'The sky as SPHEREx saw it, with the background level removed.',
      },
      {
        name: 'Difference',
        text: 'Subtracts the median of all frames, so anything constant disappears. Orange is brighter than usual, blue is fainter. A mover leaves a blue/orange pair: blue where it was, orange where it is now.',
      },
      {
        name: 'Smooth',
        text: 'Blurs by about one pixel to average out noise, so faint real sources stand out from single noisy pixels. It only changes the picture; the charts use raw pixels.',
      },
      {
        name: 'Gaia stars',
        text: 'Green rings on every star in ESA’s Gaia DR3 catalogue (bigger = brighter), moved to each frame’s date. A blob without a ring is not a known star, and rings landing on stars confirm the image alignment.',
      },
    ],
  },
  field: {
    title: 'Field of view',
    items: [
      {
        name: '3′ / 6.5′ / 10′',
        text: 'Width of the image in arcminutes (the Moon is about 30′). Zoom in to see small motions, zoom out for context and comparison stars.',
      },
      {
        name: 'Coordinate grid',
        text: 'Draws lines of constant RA and Dec across the image. The tick labels on the edges are always shown.',
      },
    ],
  },
  colour: {
    title: 'Colour',
    intro: 'Maps brightness to colour. Both use a stretch that shows faint detail without blowing out bright stars.',
    items: [
      { name: 'Infrared heat', text: 'Black through purple and orange to yellow-white. Easiest to read small differences in brightness.' },
      { name: 'Greyscale', text: 'Black to white, like a classic astronomy plate. Good for judging shapes.' },
    ],
  },
  image: {
    title: 'Reading the image',
    intro: 'North is up and east is left, as on a sky chart. Every frame is real SPHEREx data, reprojected so all frames line up.',
    items: [
      { name: 'Dashed blue circle', text: 'Where the catalogue (SIMBAD) proper motion predicts the target on this frame’s date.' },
      { name: 'Orange ring', text: 'Your measuring aperture. With the crosshair icon selected under the image, click anywhere to place it; the charts update.' },
      { name: 'Green rings', text: 'Gaia DR3 stars, when Gaia stars is on.' },
      { name: 'White numbered marks', text: 'Your pins. They stay on the same spot in the sky in every frame.' },
      { name: 'Edge labels', text: 'Right ascension along the bottom and declination up the left side.' },
      {
        name: 'Readout',
        text: 'Hover (or tap) the image for the sky position, the pixel value in MJy/sr (surface brightness), the distance from the field centre, and any Gaia star there.',
      },
      { name: 'Colour bar', text: 'The brightness each colour stands for, in MJy/sr.' },
    ],
  },
  spectrum: {
    title: 'Spectrum',
    intro:
      'Brightness against wavelength at the aperture. Each dot is one exposure; because each one sees a different wavelength, all of them together make a spectrum.',
    items: [
      { name: 'Colours', text: 'One colour per survey pass. If the passes disagree, the object changed brightness.' },
      { name: 'Hollow dots', text: 'Exposures with quality flags at the target. Treat them with care.' },
      { name: 'Shaded band', text: 'The wavelength range currently shown in the image.' },
      {
        name: 'Use it to',
        text: 'Identify the object. Stars fade toward 5 µm, dusty young stars rise, and brown dwarfs show deep dips from methane and water.',
      },
    ],
  },
  lightCurve: {
    title: 'Brightness over time',
    intro: 'Brightness at the aperture in each flipbook frame, in the current wavelength range.',
    items: [
      { name: 'Highlighted dot', text: 'The frame currently on screen.' },
      {
        name: 'Use it to',
        text: 'Spot variable stars (brightness changes) and movers (the brightness drops as the object leaves a fixed aperture).',
      },
    ],
  },
  pins: {
    title: 'Pins',
    intro:
      'Mark a spot the way Backyard Worlds volunteers do. A pin is fixed to the sky, not to the object, so anything that moves drifts away from it as the flipbook plays.',
    items: [
      {
        name: 'Drop a pin',
        text: 'Switch the toggle under the image to the pin icon, then click the image. Click a pin again to remove it. Pins stay put when you change wavelength, frames or zoom, and are saved in the share link.',
      },
      {
        name: 'Track a mover',
        text: 'Pin an object in one frame, step to a later frame, and pin it again where it now is. The list shows how far it moved, in which direction, and its speed in arcseconds per year, measured from the earliest pin.',
      },
      {
        name: 'Is it real?',
        text: 'A real mover shifts steadily in one direction over the passes and appears at the same place in every band where it is bright. Noise and artefacts jump around or appear in only one frame.',
      },
      {
        name: 'For scale',
        text: 'One pixel is 6.15″. Barnard’s Star, the fastest star in the sky, moves about 10″ per year.',
      },
    ],
  },
  about: {
    title: 'About these frames',
    items: [
      { name: 'Exposures', text: 'How many SPHEREx images cover this spot (up to 600 are loaded, spread evenly in time).' },
      { name: 'Survey passes', text: 'SPHEREx maps the whole sky every 6 months; each pass is one visit to this spot.' },
      { name: 'Source link', text: 'Opens the original image file in NASA’s archive, so every frame can be checked.' },
      { name: 'Flags', text: 'Pipeline quality warnings at the target in the current frame, with how many exposures carry each.' },
    ],
  },
} satisfies Record<string, HelpTopic>
