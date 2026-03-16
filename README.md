# battisha.com

A personal website that greets visitors with "Hmm, are you sure you wanna be here?" and means it.

Live at [battisha.com](http://battisha.com).

## What's inside

The site is a single-page experience built on the [Tooplate 2115 Marvel](https://www.tooplate.com/view/2115-marvel) template, with autoplay background music and scroll animations via [AOS.js](https://michalsnik.github.io/aos/). Visitors are warned at the entry page and then invited to proceed at their own peril.

The main page has six sections:

| Section | What it does |
|---------|-------------|
| **Colors** | Informs you that colors include green, red, and purple. Features a photo of a rock formation. |
| **Photos** | A carousel of photos taken by the author. |
| **Vote** | Embedded [vote.org](https://vote.org) voter registration form. Visitors are reminded they are wasting time on the internet and therefore have time to register. |
| **Adventure** | Skyscanner flight search widget, pre-pointed at Dublin. |
| **Maps** | Satellite map embeds of Sossusvlei (Namibia), a location in Egypt, and Lago San Martín (Patagonia). Described as "places that are probably cooler than wherever you are now." |
| **Information** | A form asking for your Social Security Number, bank password, and mother's maiden name. Submitting it takes you to a page that says *"Umm, you weren't actually supposed to do that."* |

Clicking the social media buttons takes you to a page that says *"As if I would be that basic."*

## Stack

- HTML/CSS/JS (no framework or build step)
- [Bootstrap 4](https://getbootstrap.com/)
- [AOS.js](https://michalsnik.github.io/aos/) for scroll animations
- [Owl Carousel](https://owlcarousel2.github.io/OwlCarousel2/) for the photo slider
- [Headroom.js](https://wicky.nillia.ms/headroom.js/) for the sticky nav
- Skyscanner and vote.org embedded widgets
- One (1) crucial song

## Structure

```
index.html          — entry page ("are you sure?")
main                — main site
social              — social links destination
submit              — form submission destination
css/                — stylesheets
js/                 — scripts
images/             — photos and assets
music/              — the crucial song
font/               — icon font (Unicons)
favicon/            — favicons for every platform known to man
sass/               — source SCSS
```

Built by TheEccentricEgyptian. All rights reserved by Bombastic Industries.
