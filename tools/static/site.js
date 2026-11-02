/* Living Group Pages: keep a static page current and balanced.
   - Past events drop off (dates compared in the group's own time zone).
   - Featured blocks are placed, in date order, into the shorter column (measured).
   - Meeting series show their next date from the dates computed at build time.
   - Columns are balanced by measuring rendered heights; the shorter column
     gets the Indra's net filler. Measure, don't estimate. */
(function () {
  "use strict";
  var zEl = document.querySelector("[data-zone]");
  var zone = (zEl && zEl.getAttribute("data-zone")) || "UTC";
  var today;
  try {
    today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch (e) {
    today = new Date().toISOString().slice(0, 10);
  }
  var isPast = function (iso) { return iso && iso < today; };

  // Program announcements: drop past items; hide the block if empty.
  var pa = document.getElementById("pa");
  if (pa) {
    pa.querySelectorAll("li[data-last]").forEach(function (li) {
      if (isPast(li.getAttribute("data-last"))) li.remove();
    });
    if (!pa.querySelector("li")) pa.style.display = "none";
  }

  // Next meeting block: hide once its date has passed.
  document.querySelectorAll(".next[data-date]").forEach(function (b) {
    if (isPast(b.getAttribute("data-date"))) b.style.display = "none";
  });

  // Meeting series: next date from the precomputed list.
  document.querySelectorAll(".series[data-dates]").forEach(function (s) {
    var list;
    try { list = JSON.parse(s.getAttribute("data-dates")); } catch (e) { return; }
    var next = list.filter(function (d) { return d[0] >= today; })[0];
    if (!next) { s.style.display = "none"; return; }
    var n = s.querySelector(".s-next"), t = s.querySelector(".s-time");
    if (n) n.textContent = next[1];
    if (t && next[2]) t.textContent = next[2];
  });

  // Featured blocks (events and series): drop past ones, keep date order.
  var feats = Array.prototype.slice.call(document.querySelectorAll(".feat[data-feat]"))
    .sort(function (a, b) { return +a.getAttribute("data-feat") - +b.getAttribute("data-feat"); })
    .filter(function (f) {
      if (isPast(f.getAttribute("data-last")) || f.style.display === "none") { f.remove(); return false; }
      return true;
    });
  feats.forEach(function (f, i) { f.style.order = String(10 + i); });  // phone: date order
  var L = document.querySelector(".colL"), R = document.querySelector(".colR");
  var anchorL = document.querySelector('.feat-anchor[data-side="L"]');
  var anchorR = document.querySelector('.feat-anchor[data-side="R"]');
  var fl = L && L.querySelector(".filler"), fr = R && R.querySelector(".filler");

  function twoColumns() { return fl && getComputedStyle(fl).display !== "none"; }
  function h(el) { return el.getBoundingClientRect().height; }

  // Place each featured block, in date order, into whichever column is
  // shorter at that moment (measured), then fill the remaining gap.
  function layout() {
    if (!L || !R || !anchorL || !anchorR) return;
    fl.style.height = "0px"; fr.style.height = "0px";
    if (!twoColumns()) return;  // phone: one column, order set above
    feats.forEach(function (f) { f.parentNode.removeChild(f); });
    feats.forEach(function (f) {
      var anchor = h(L) <= h(R) ? anchorL : anchorR;
      anchor.parentNode.insertBefore(f, anchor);
    });
    var hl = h(L), hr = h(R), gap = Math.round(Math.abs(hl - hr));
    if (hl > hr) fr.style.height = gap + "px";
    else if (hr > hl) fl.style.height = gap + "px";
  }
  layout();
  window.addEventListener("load", layout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  var timer;
  window.addEventListener("resize", function () { clearTimeout(timer); timer = setTimeout(layout, 150); });
})();
