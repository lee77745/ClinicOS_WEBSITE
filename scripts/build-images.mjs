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
  // Home v2 — photography carries the layout, so these run taller than a figure.
  { src: 'P07', name: 'home-hero',  ratio: 4 / 3, focus: 0.42, widths: [1200, 800, 600, 400] },
  { src: 'P04', name: 'home-day',   ratio: 4 / 3, focus: 0.50, widths: [1200, 800, 600, 400] },
  { src: 'P06', name: 'home-story', ratio: 4 / 3, focus: 0.50, widths: [1200, 800, 600, 400] },
  // Home v4 — the hero carries a product shot, so the device frame stays uncropped.
  // trimmed to the devices themselves so the mockup reads large in the hero
  { src: 'P10', name: 'hero-device', ratio: 3 / 2, focus: 0.50, widths: [1400, 1000, 700, 480],
    box: { left: 150, top: 96, width: 1362, height: 908 } },
  { src: 'P07', name: 'method-hand', ratio: 3 / 2, focus: 0.45, widths: [1000, 700, 480] },
  // V7 — the page needs more than one aspect ratio to have a rhythm.
  { src: 'P04', name: 'flow-tall', ratio: 3 / 4, focus: 0.46, widths: [900, 640, 460] },
  { src: 'P08', name: 'oc-square', ratio: 1 / 1, focus: 0.48, widths: [560, 380] },
  { src: 'P06', name: 'oc-wide',   ratio: 4 / 3, focus: 0.50, widths: [900, 640, 460] },
  { src: 'P10', name: 'oc-product',ratio: 1 / 1, focus: 0.50, widths: [560, 380],
    box: { left: 430, top: 120, width: 800, height: 800 } },

  /* index.html — the brand hero band. An empty lobby in daylight: no
     people, no devices, no runtime. Full bleed under the copy, so the
     home page never reads as a product split-screen. */
  { src: 'public/images/space/space-lobby-03.png',
    name: 'home-band', ratio: 21 / 9, focus: 0.56, widths: [1920, 1536, 1240, 900] },
  { src: 'public/images/space/space-lobby-03.png',
    name: 'home-band-sm', ratio: 4 / 3, focus: 0.56, xfocus: 0.62, widths: [900, 640, 460] },

  /* why-clinicos.html — the editorial pass. Sources live in the approved
     library under public/images/, so `src` here is a repo-relative path
     rather than a _source stem. Slot names, never photo numbers. */
  { src: 'public/images/space/space-lobby-03.png',
    name: 'why-hero', ratio: 3 / 4, focus: 0.50, xfocus: 0.62, widths: [1240, 900, 640, 460] },
  { src: 'public/images/space/space-lobby-03.png',
    name: 'why-hero-sm', ratio: 4 / 3, focus: 0.50, widths: [900, 640, 460] },
  // 我們看見了什麼 — one frame per story, all on the same 4:3 so the column reads level
  // the crop window sits hard right so the second nurse moves in off the
  // edge — the story frame fades on that side and she must stay out of it
  { src: 'public/images/workflow/handover/handover-01.png',
    name: 'why-handover', ratio: 4 / 3, focus: 0.50, xfocus: 1, widths: [1200, 800, 560] },
  { src: 'public/images/workflow/reschedule/reschedule-01.png',
    name: 'why-reschedule', ratio: 4 / 3, focus: 0.50, widths: [1200, 800, 560] },
  { src: 'public/images/workflow/onboarding/onboarding-01.png',
    name: 'why-onboarding', ratio: 4 / 3, focus: 0.50, widths: [1200, 800, 560] },
  { src: 'public/images/people/people-director-02.png',
    name: 'why-senior', ratio: 4 / 3, focus: 0.46, widths: [1200, 800, 560] },
  { src: 'public/images/workflow/month-end/month-end-01.png',
    name: 'why-monthend', ratio: 4 / 3, focus: 0.50, widths: [1200, 800, 560] },
  // 我們開始思考 — the detail collage is a composition; keep its native 3:2
  { src: 'public/images/detail/clinic-details-01.png',
    name: 'why-details', ratio: 3 / 2, focus: 0.50, widths: [1240, 900, 640] },
  // ClinicOS 的答案 — supporting, deliberately smaller than the story frames
  { src: 'public/images/detail/process-01.png',
    name: 'why-process', ratio: 4 / 3, focus: 0.50, widths: [800, 560, 380] },
  { src: 'public/images/detail/knowledge-01.png',
    name: 'why-knowledge', ratio: 4 / 3, focus: 0.50, widths: [800, 560, 380] },
  // 品牌收束 — the room, empty. Wide on desktop, calmer 4:3 on phones.
  { src: 'public/images/people/people-reception-08.png',
    name: 'why-close', ratio: 21 / 9, focus: 0.52, widths: [1600, 1240, 900] },
  { src: 'public/images/people/people-reception-08.png',
    name: 'why-close-sm', ratio: 4 / 3, focus: 0.52, widths: [768, 560, 375] },
  // CTA — a consultation actually happening
  { src: 'public/images/people/people-consultation-01.png',
    name: 'why-cta', ratio: 4 / 3, focus: 0.50, widths: [1000, 700, 480] },

  /* day.html — Chapter 02「一天」. Photography only opens and closes the day;
     the six moments in between are carried by runtime frames. */
  { src: 'public/images/space/space-lobby-04.png',
    name: 'day-hero', ratio: 3 / 4, focus: 0.50, xfocus: 0.16, widths: [1240, 900, 640, 460] },
  { src: 'public/images/space/space-lobby-04.png',
    name: 'day-hero-sm', ratio: 4 / 3, focus: 0.50, xfocus: 0.28, widths: [900, 640, 460] },
  /* contact.html — Chapter 07「啟程」. The room before anyone arrives:
     an empty lobby in daylight, which is what a beginning looks like.
     Freed up when chapter 02's close moved to the night lobby. */
  { src: 'public/images/people/people-reception-06.png',
    name: 'start-hero', ratio: 3 / 4, focus: 0.50, xfocus: 0.58, widths: [1240, 900, 640, 460] },
  { src: 'public/images/people/people-reception-06.png',
    name: 'start-hero-sm', ratio: 4 / 3, focus: 0.52, xfocus: 0.55, widths: [900, 640, 460] },

  /* 20:00 — the same room after the lights go down. The wide band keeps
     the counter light strip, the corridor and the window together; the
     phone crop opens out so the frame never collapses to a dark wall. */
  { src: 'public/images/space/space-night-lobby-01.png',
    name: 'day-close', ratio: 21 / 9, focus: 0.58, widths: [1600, 1240, 900] },
  { src: 'public/images/space/space-night-lobby-01.png',
    name: 'day-close-sm', ratio: 4 / 3, focus: 0.50, xfocus: 0.60, widths: [768, 560, 375] },

  /* The six runtime frames. Captured from the RC1 build (ClinicOS_V4 @ 8f93650)
     against the demo tenant on working date 2026-07-16, at 1600x1200 CSS px /
     DPR 2. `box` trims the tenant and system-date chrome off the top of each
     capture — nothing inside the frame is retouched, recoloured or composited. */
  { src: 'public/images/product/runtime-workbench.png', name: 'day-rt-workbench',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-customer.png', name: 'day-rt-customer',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  // already scrolled to 今日預約總表 at capture time, so the frame starts at the top
  { src: 'public/images/product/runtime-appointments.png', name: 'day-rt-appointments',
    widths: [1600, 1200, 800], box: { left: 0, top: 0, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-usage.png', name: 'day-rt-usage',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-sales.png', name: 'day-rt-sales',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  // the closing dialog is the subject here, so this one crops in on it
  { src: 'public/images/product/runtime-closing.png', name: 'day-rt-closing',
    widths: [1400, 1000, 700], box: { left: 890, top: 60, width: 1400, height: 1120 } },

  /* day-to-day.html — Chapter 03「日常」. Seven kinds of work, one runtime
     frame each, captured the same way as chapter 02: RC1 build against the
     demo tenant, 1600x1200 CSS px / DPR 2, `box` trimming the tenant and
     system-date chrome off the top. Every frame is the same 16:10 so the
     page keeps one rhythm all the way down. */
  /* 01 預約安排 — the day's appointment board rather than a dashboard:
     who is coming, at what time, with which member of staff. Captured
     already scrolled to the board, so the frame starts at its own title. */
  { src: 'public/images/product/runtime-appointment-board.png', name: 'dtd-rt-booking',
    widths: [1600, 1200, 800], box: { left: 0, top: 0, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-crm.png', name: 'dtd-rt-crm',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-courses.png', name: 'dtd-rt-courses',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-media.png', name: 'dtd-rt-media',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-salesquery.png', name: 'dtd-rt-sales',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-inventory.png', name: 'dtd-rt-inventory',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-daybook.png', name: 'dtd-rt-daybook',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },

  /* Chapter 03 hero — the room the seven kinds of work happen in. Unused by
     the other chapters; tall on desktop, 4:3 on phones, same as chapter 02. */
  { src: 'public/images/people/people-reception-07.png',
    name: 'dtd-hero', ratio: 3 / 4, focus: 0.50, xfocus: 0.42, widths: [1240, 900, 640, 460] },
  { src: 'public/images/people/people-reception-07.png',
    name: 'dtd-hero-sm', ratio: 4 / 3, focus: 0.50, xfocus: 0.48, widths: [900, 640, 460] },

  /* trust.html — Chapter 04「信任」. One customer's record, read from her
     first booking to the friends she brings in. Same capture conditions as
     chapters 02 and 03; `box` trims the tenant and system-date chrome. */
  { src: 'public/images/product/runtime-first-booking.png', name: 'tr-rt-booking',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-c360.png', name: 'tr-rt-c360',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-purchase.png', name: 'tr-rt-purchase',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-treatment-history.png', name: 'tr-rt-history',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-care.png', name: 'tr-rt-care',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-return.png', name: 'tr-rt-return',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/runtime-referral.png', name: 'tr-rt-referral',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },

  /* Chapter 04 photography — three moments only: the first visit, the person
     being looked after, and the friend she brings. All previously unused. */
  { src: 'public/images/people/people-consultation-03.png',
    name: 'tr-hero', ratio: 4 / 5, focus: 0.42, xfocus: 0.55, widths: [1240, 900, 640, 460] },
  { src: 'public/images/people/people-consultation-03.png',
    name: 'tr-hero-sm', ratio: 4 / 3, focus: 0.44, widths: [900, 640, 460] },
  { src: 'public/images/people/people-consultation-04.png',
    name: 'tr-care', ratio: 4 / 3, focus: 0.46, widths: [1000, 700, 480] },
  { src: 'public/images/people/people-team-03.png',
    name: 'tr-referral', ratio: 4 / 3, focus: 0.46, widths: [1000, 700, 480] },
  { src: 'public/images/space/space-lobby-02.png',
    name: 'tr-close', ratio: 21 / 9, focus: 0.52, widths: [1600, 1240, 900] },
  { src: 'public/images/space/space-lobby-02.png',
    name: 'tr-close-sm', ratio: 4 / 3, focus: 0.52, widths: [768, 560, 375] },

  /* future.html — Chapter 06「未來」. The hero is the studio device shot,
     the one piece of product photography this site owns; no people, no
     clinical setting, which is what this chapter asks for. */
  { src: 'P10', name: 'fut-hero',
    widths: [1400, 1000, 700, 480], box: { left: 120, top: 80, width: 1380, height: 920 } },
  { src: 'P10', name: 'fut-hero-sm',
    widths: [900, 640, 460], box: { left: 180, top: 70, width: 1200, height: 900 } },

  /* management.html — Chapter 05「經營」. Six decisions, six finished
     screens; every dashboard page carrying a 「尚未提供」 placeholder was
     rejected. Same capture conditions as the other chapters, `box` trims
     the tenant and system-date chrome. */
  { src: 'public/images/product/management-sales.png', name: 'mg-rt-sales',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/management-customers.png', name: 'mg-rt-customers',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  /* narrower than the rest: the 備註 column of this table carries the demo
     builder's own provenance strings, which are bookkeeping, not clinic data */
  { src: 'public/images/product/management-treatments.png', name: 'mg-rt-treatments',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 2272, height: 1420 } },
  { src: 'public/images/product/management-inventory.png', name: 'mg-rt-inventory',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  /* NOTE: the 經營摘要 row and the 收款方式統計 row sit in the same six
     columns, so no single rectangle can drop the leftmost KPI (來客數) while
     keeping the rightmost payment card (LINE Pay) — cropping in from the left
     removes 現金 and still leaves 成交率 / 新客比例. Kept at full width until
     that trade-off is decided. */
  { src: 'public/images/product/management-finance.png', name: 'mg-rt-finance',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },
  { src: 'public/images/product/management-analytics.png', name: 'mg-rt-analytics',
    widths: [1600, 1200, 800], box: { left: 0, top: 360, width: 3200, height: 2000 } },

  /* Chapter 05 hero — the same studio device shot as chapter 06, cropped
     wider so the desk reads rather than the devices. No people. */
  { src: 'P10', name: 'mg-hero',
    widths: [1400, 1000, 700, 480], box: { left: 60, top: 40, width: 1440, height: 900 } },
  { src: 'P10', name: 'mg-hero-sm',
    widths: [900, 640, 460], box: { left: 160, top: 60, width: 1220, height: 915 } },
];

/* `xfocus` mirrors `focus` on the horizontal axis (0 = left, 1 = right);
   it defaults to 0.5, so every job written before it is unchanged. */
const cropBox = async (file, ratio, focus, box, xfocus = 0.5) => {
  if (box) return box;
  const img = sharp(file);
  const { width: w, height: h } = await img.metadata();
  let cw = w, ch = Math.round(w / ratio);
  if (ch > h) { ch = h; cw = Math.round(h * ratio); }
  const left = Math.max(0, Math.min(w - cw, Math.round((w - cw) * xfocus)));
  const top = Math.max(0, Math.min(h - ch, Math.round((h - ch) * focus)));
  return { left, top, width: cw, height: ch };
};

let count = 0;
for (const job of JOBS) {
  const file = job.src.includes('/') ? `${ROOT}/${job.src}` : `${SRC}/${job.src}.png`;
  const box = await cropBox(file, job.ratio, job.focus, job.box, job.xfocus);
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
