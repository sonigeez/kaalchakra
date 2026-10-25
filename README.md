# Kaalchakra · कालचक्र

4,000 years of the Indian subcontinent on one map, from the Harappan cities (2600 BCE) to the uprising of 1857.
Drag the timeline and watch empires rise and fall, follow travellers across the land, and play a daily map quiz.

Designed as a printed atlas: paper, ink and pigment washes. Inspired by [jiangshan-map](https://github.com/DeanChensj/jiangshan-map). This is a clean build with no shared code.

Live at **https://kaalchakra.anokha.space**.

## Run it

The site is static files in `public/`, with no build step.

```bash
npm run dev
```

Then open http://localhost:8642.

## Deploy

It runs on Cloudflare Workers. The Worker serves `public/`, writes per-link preview tags, and draws a 1200×630 preview image for every shareable link (`?home=indore`, `?y=1030`, `?j=xuanzang&s=7`, `?p=patna`, `?quiz`).

```bash
npm install
npm run deploy
```

`npm run deploy` first runs `scripts/build-og-data.mjs`, which uses the same engine as the app (`public/js/engine.js`) to precompute city histories, so previews always match the map.

## What's in it

- **Timeline.** 119 powers, from the Harappans and Mauryas to the Marathas, Sikhs and the Company. Press ▶ to watch the whole sweep in about 75 seconds.
- **Painted territories.** Each patch of land goes to the strongest nearby power, and every power is traced into one watercolour region with a pigment edge. When the year changes, conquests spread outward from each power's homeland like ink. Borders are schematic, and ≈ marks uncertain extents. Land inside the atlas that no mapped power held is hatched and labelled "Local chiefdoms", so a gap reads as history rather than a missing tile.
- **Who ruled your city?** Search about 200 cities and towns, or old names like Pataliputra or Bombay, or use your location. You get every power that held that ground, the longest rule, how often it changed hands, and a 1080×1350 image card to share. It uses the same scoring that paints the map, so the card always agrees with what you see.
- **Living place names.** City labels change as you scrub: Pataliputra to Patna to Azimabad, Dhillika to Dilli to Shahjahanabad. Tap a city to trace its names and events.
- **Journeys.** Eight travellers: the Buddha, Alexander, Ashoka's edicts, Xuanzang, Adi Shankara, Ibn Battuta, Guru Nanak and Shivaji.
- **Daily quiz.** Find five historic places on an unlabelled map. Results share as emoji, Wordle-style.
- **Deep links.** `#y=1030`, `#y=1030&p=thanjavur`, `#home=indore`, `#j=xuanzang&s=7` and `#quiz` all open straight to that view.

## Files

| Path (under `public/` unless noted) | What it holds |
| --- | --- |
| `js/data/polities.js` | Regions (lon, lat, radius in km) and every power's phases, rulers and notes |
| `js/data/places.js` | Cities with their names over time and a fact |
| `js/data/stories.js` | Events, journeys, quiz pool, eras, rivers and ancient roads |
| `js/data/towns.js` | Modern cities and towns for the "Your city" search, with old names |
| `js/engine.js` | Who holds which ground in which year, shared by the app and the preview builder |
| `js/app.js` | Map, timeline, cards, journeys, quiz and sharing |
| `css/style.css` | All styling, including the phone layout |
| `worker/index.js` | Cloudflare Worker: preview tags and images |
| `scripts/build-og-data.mjs` | Precomputes data for link previews |

To fix a date or an extent, edit the data files. A phase like `[1601,1636,'+ khandesh vidarbha']` means "the previous phase plus these regions".

## Caveats

The data is hand-compiled and schematic. Treat it as a starting point, not a reference.
Coastlines come from Natural Earth via [world-atlas](https://github.com/topojson/world-atlas). D3 and topojson-client load from public CDNs.

## License

Code and data are released under the [MIT License](LICENSE). Fonts are served from Google Fonts and Fontsource under the SIL Open Font License.
