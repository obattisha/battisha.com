/*
 * dodge(button, options): makes a button run away from the user.
 *
 * Mouse: it jumps away when the cursor gets close. Touch: it jumps the moment a finger lands on
 * it (pointerdown fires before the tap becomes a click, and we cancel that click), so it works on
 * phones too. After `limit` dodges it gives up and calls onGiveUp(button).
 * Keyboard users are left alone: Enter/Space still "click" it, so nothing is ever unreachable.
 *
 *   dodge(el, { area: someContainer, limit: 10, near: 80, onDodge(n, el) {}, onGiveUp(el) {} })
 */
window.dodge = function dodge(el, opts = {}) {
  const area = opts.area || el.parentElement;
  const limit = opts.limit ?? 10;
  const near = opts.near ?? 80;
  let count = 0, done = false, x = 0, y = 0, lastJump = 0, swallowUntil = 0;

  el.style.transition = 'transform .22s cubic-bezier(.3, 1.4, .5, 1)';
  el.style.position = el.style.position || 'relative';
  el.style.zIndex = 5;
  el.style.touchAction = 'manipulation';

  function jump() {
    const now = Date.now();
    if (done || now - lastJump < 180) return;        // one jump per approach, not one per pixel
    lastJump = now;
    count++;
    // jump within the part of the area that's actually on screen (below any sticky top bar),
    // so it never escapes somewhere the user can't reach (phones especially)
    const r = area.getBoundingClientRect(), b = el.getBoundingClientRect();
    const bar = document.querySelector('.bar');
    const topLimit = Math.max(r.top, bar ? bar.getBoundingClientRect().bottom : 0, 0);
    const a = { left: Math.max(r.left, 0), top: topLimit, width: Math.min(r.right, innerWidth) - Math.max(r.left, 0), height: Math.min(r.bottom, innerHeight) - topLimit };
    const homeLeft = b.left - x, homeTop = b.top - y;  // where the button sits with no offset
    const pad = 8;
    // pick a spot inside the area, far enough from where it is now
    let tx, ty, tries = 0;
    do {
      tx = a.left + pad + Math.random() * Math.max(0, a.width - b.width - pad * 2);
      ty = a.top + pad + Math.random() * Math.max(0, a.height - b.height - pad * 2);
      tries++;
    } while (Math.hypot(tx - b.left, ty - b.top) < Math.min(160, a.width / 3) && tries < 20);
    x = tx - homeLeft; y = ty - homeTop;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (opts.onDodge) opts.onDodge(count, el);
    if (count >= limit) giveUp();
  }

  function giveUp() {
    done = true;
    setTimeout(() => {
      swallowUntil = 0;                              // the settled button must work on the next tap
      x = 0; y = 0; el.style.transform = '';
      if (opts.onGiveUp) opts.onGiveUp(el);
    }, 260);
  }

  // mouse: dodge when the cursor comes within `near` px of the button
  area.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || done) return;
    const b = el.getBoundingClientRect();
    const dx = Math.max(b.left - e.clientX, 0, e.clientX - b.right);
    const dy = Math.max(b.top - e.clientY, 0, e.clientY - b.bottom);
    if (Math.hypot(dx, dy) < near) jump();
  });
  // touch/pen (and a mouse that somehow got there): dodge on contact and swallow the tap.
  // The browser still fires that tap's click wherever the finger is, which after the jump is
  // whatever is underneath (another link!), so swallow any click for a moment, page-wide.
  document.addEventListener('click', (e) => {
    if (Date.now() < swallowUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  el.addEventListener('pointerdown', (e) => {
    if (done) return;
    e.preventDefault();
    swallowUntil = Date.now() + 600;
    jump();
  });
  el.addEventListener('click', (e) => {
    // a click that wasn't from the keyboard (detail > 0) while still dodging is cancelled
    if (!done && e.detail > 0) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  return { get count() { return count; }, giveUp };
};
