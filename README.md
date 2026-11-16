# battisha.com

A personal website that greets visitors with "Hmm, are you sure you wanna be here?" and means it. Originally created in 2019.

Live at [battisha.com](https://battisha.com), served by a Cloudflare Worker.

## What's inside

The site is a single-page experience built on the [Tooplate 2115 Marvel](https://www.tooplate.com/view/2115-marvel) template, with autoplay background music and scroll animations via [AOS.js](https://michalsnik.github.io/aos/).

Shortcode generator is at [shorten.battisha.com](https://shorten.battisha.com). Anyone can create or delete a `battisha.com/<code>` redirect; codes are stored in Cloudflare KV.

## Stack

- HTML/CSS/JS (no framework or build step)
- [Bootstrap 4](https://getbootstrap.com/)
- [AOS.js](https://michalsnik.github.io/aos/) for scroll animations
- [Owl Carousel](https://owlcarousel2.github.io/OwlCarousel2/) for the photo slider
- [Headroom.js](https://wicky.nillia.ms/headroom.js/) for the sticky nav
- Skyscanner and vote.org embedded widgets
- One (1) crucial song
- Cloudflare Workers + KV for hosting, shortcodes, and the SSN-validation proxy

## Structure

```
site/               — everything the website serves
  index.html        — entry page ("are you sure?")
  main              — main site
  social, submit, error — extra pages
  data/countries.json — country list for the travel tracker
  css/ js/ images/ music/ font/ favicon/
src/index.js        — Cloudflare Worker: serves site/, shortcode redirects,
                      shorten.battisha.com, /api/validate-ssn (RapidAPI proxy)
scripts/upload-assets.py — uploads site/ into the SITE KV namespace
wrangler.jsonc      — Worker config (KV bindings, custom domains)
sass/               — source SCSS (not deployed)
```

## Deploying

Needs a Cloudflare API token with Workers Scripts, Workers KV Storage and Workers Routes edit access.

```bash
npm install
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=8262aad3d4d68e3949cb125492a30315
python3 scripts/upload-assets.py $CLOUDFLARE_ACCOUNT_ID dbf0b80728d247c99a5d4506bd31f1da   # site files -> KV
npx wrangler deploy                                                                        # Worker code
```

Static files live in KV rather than Workers Static Assets so that uploads go through the regular API token.
The RapidAPI key is a Worker secret (`npx wrangler secret put RAPIDAPI_KEY`), never in page source.

Built by TheEccentricEgyptian. All rights reserved by Bombastic Industries.
