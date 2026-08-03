/* -----------------------------------------------------------------------
   ClinicOS website — image derivative builder

   One-off tool. NOT part of the site: the website itself is static and has
   no build step, no package.json and no node_modules. Run it by hand from a
   directory that has sharp installed, whenever the source photography in
   assets/img/_source/ changes:

     node scripts/build-images.mjs

   Sources are never modified. Every derivative is a crop + resize + encode
   of an untouched original — no colour grading, no filters, no overlays.

   Because this repo has no node_modules, point SHARP_MODULE at a sharp
   installed anywhere else:

     SHARP_MODULE=file:///c/tools/node_modules/sharp/lib/index.js \
       node scripts/build-images.mjs
   --------------------------------------------------------------------- */

const sharp = (await import(process.env.SHARP_MODULE || 'sharp')).default;

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = `${ROOT}/assets/img/_source`;
const OUT = `${ROOT}/assets/img`;
mkdirSync(OUT, { recursive: true });

/* Crop is expressed as a target ratio; the crop window is centred
   horizontally and positioned vertically by `focus` (0 = top, 1 = bottom),
   so the subject survives every breakpoint. */
/* Source files keep the filenames they arrived with. Outputs are named after
   the place they sit in, not after a photo number — the slot is what stays
   true if the photography is ever re-shot. */
const JOBS = [
  // index.html — the breath after the hero. Wide band on desktop, calmer 4:3 on phones.
  { src: 'P01', name: 'band',      ratio: 21 / 9, focus: 0.52, widths: [1536, 1240, 992, 768] },
  { src: 'P01', name: 'band-sm',   ratio: 4 / 3,  focus: 0.52, widths: [768, 560, 375] },
  // Side figures — 44% column on desktop, full width on phones. Always 16:9.
  { src: 'P07', name: 'method',    ratio: 16 / 9, focus: 0.45, widths: [1120, 720, 400] },
  { src: 'P06', name: 'scale',     ratio: 16 / 9, focus: 0.50, widths: [1120, 720, 400] },
  { src: 'P04', name: 'field',     ratio: 16 / 9, focus: 0.50, widths: [1120, 720, 400] },
  { src: 'P08', name: 'positions', ratio: 16 / 9, focus: 0.48, widths: [1120, 720, 400] },
];

const cropBox = async (file, ratio, focus) => {
  const img = sharp(file);
  const { width: w, height: h } = await img.metadata();
  let cw = w, ch = Math.round(w / ratio);
  if (ch > h) { ch = h; cw = Math.round(h * ratio); }
  const left = Math.round((w - cw) / 2);
  const top = Math.max(0, Math.min(h - ch, Math.round((h - ch) * focus)));
  return { left, top, width: cw, height: ch };
};

let count = 0;
for (const job of JOBS) {
  const file = `${SRC}/${job.src}.png`;
  const box = await cropBox(file, job.ratio, job.focus);
  for (const width of job.widths) {
    const base = sharp(file).extract(box).resize({ width, withoutEnlargement: true });
    await base.clone().avif({ quality: 52, effort: 6 }).toFile(`${OUT}/${job.name}-${width}.avif`);
    await base.clone().webp({ quality: 78, effort: 5 }).toFile(`${OUT}/${job.name}-${width}.webp`);
    await base.clone().jpeg({ quality: 80, mozjpeg: true }).toFile(`${OUT}/${job.name}-${width}.jpg`);
    count += 3;
  }
  console.log(`${job.name.padEnd(14)} crop ${box.width}x${box.height} @${box.left},${box.top}  ->  ${job.widths.join(', ')}`);
}

/* Open Graph cover — the only place the studio device shot is used. */
const ogBox = await cropBox(`${SRC}/P10.png`, 1200 / 630, 0.5);
await sharp(`${SRC}/P10.png`).extract(ogBox).resize({ width: 1200, height: 630 })
  .png({ compressionLevel: 9, effort: 10 }).toFile(`${ROOT}/assets/og-cover.png`);
console.log(`og-cover       crop ${ogBox.width}x${ogBox.height}  ->  1200x630`);

console.log(`\n${count} derivatives + 1 og cover written to assets/img/`);
