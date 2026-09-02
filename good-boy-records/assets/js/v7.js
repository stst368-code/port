/* ==========================================================================
   Good Boy Records — player v7
   --------------------------------------------------------------------------
   Structure:
     util          small helpers
     magazine      cassette selection: rotary wheel (wide) or snap rail (narrow)
     graph         Web Audio: EQ -> limiter -> destination, with meter taps
     meters        one rAF loop driving the VU needles and the spectrum canvas
     deck          artwork, title plate, technical drawer
     lyrics        word-timed sidecar with line fallback
     transport     play/pause/seek/volume/shuffle
     boot          wiring

   Geometry note. v6 sized the cassettes from the wheel, and the wheel from a
   percentage of its own column, so both collapsed to their floor values on
   anything narrow. Here the column is measured once per resize, the cassette
   width is derived from it, and the wheel is derived from the cassettes. The
   dependency only ever runs one way.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------- util --- */

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (lo, v, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var mod = function (v, d) { return ((v % d) + d) % d; };
  var DEG = 180 / Math.PI;

  function clock(sec) {
    if (!isFinite(sec) || sec < 0) return "--:--";
    sec = Math.floor(sec);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function remember(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function recall(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  /* ------------------------------------------------------- catalogue ---- */

  var dataNode = $("catalogue-data");
  if (!dataNode) return;

  var catalogue = [];
  try { catalogue = JSON.parse(dataNode.textContent || "[]") || []; } catch (_) { catalogue = []; }
  var byId = {};
  catalogue.forEach(function (t) { byId[t.id] = t; });

  var el = {
    audio: $("gbr-audio"),
    status: $("gbr-status"),
    magazine: $("gbr-magazine"),
    wheel: $("gbr-wheel"),
    hub: $("gbr-wheel-hub"),
    cards: $("gbr-cards"),
    prev: $("gbr-prev"),
    next: $("gbr-next"),
    vu: $("gbr-vu"),
    spectrum: $("gbr-spectrum"),
    art: $("gbr-artwork"),
    artFrame: $("gbr-art-frame"),
    slot: $("gbr-tape-slot"),
    title: $("gbr-title"),
    meta: $("gbr-meta"),
    play: $("gbr-play"),
    shuffle: $("gbr-shuffle"),
    back: $("gbr-back"),
    skip: $("gbr-skip"),
    progress: $("gbr-progress"),
    volume: $("gbr-volume"),
    elapsed: $("gbr-time"),
    total: $("gbr-total"),
    lossless: $("gbr-lossless"),
    losslessWrap: $("gbr-lossless-wrap"),
    lyricWord: $("gbr-lyric-word"),
    lyricLine: $("gbr-lyric-line"),
    eqToggle: $("gbr-eq-toggle"),
    eqPopover: $("gbr-eq-popover"),
    eqClose: $("gbr-eq-close"),
    eqFlat: $("gbr-eq-flat"),
    eqNote: $("gbr-eq-note"),
    techToggle: $("gbr-tech-toggle"),
    techPanel: $("gbr-tech-panel"),
    techClose: $("gbr-tech-close"),
    techContent: $("gbr-tech-content")
  };
  if (!el.audio) return;

  var audio = el.audio;
  var current = null;
  var shuffleMode = true;
  var cycleBusy = false;

  function setStatus(text, tone) {
    if (!el.status) return;
    el.status.textContent = text || "";
    if (tone) el.status.dataset.tone = tone; else el.status.removeAttribute("data-tone");
  }

  /* ==================================================== MAGAZINE ======== */
  /* Mirrors the 860px breakpoint in v7.css. Change both together. */
  var MAGAZINE_QUERY = matchMedia("(max-width: 860px)");

  var mag = {
    mode: "wheel",
    cards: [],
    position: 0,      // fractional card index at the pickup point
    stepDeg: 12,
    radius: 400,
    arcLimit: 40,
    centreX: 0,
    centreY: 0,
    pitch: 140,
    anim: 0,
    dragging: null,
    lastHit: null,
    suppressClickUntil: 0
  };

  function collectCards() {
    mag.cards = Array.prototype.slice.call(el.cards ? el.cards.querySelectorAll(".card") : []);
    mag.cards.forEach(function (c, i) { c.dataset.index = String(i); });
    if (el.magazine) el.magazine.dataset.empty = mag.cards.length ? "false" : "true";
  }

  /* Randomise song order per visit while keeping each song's versions
     adjacent. Groups are whole <article> elements, so this is a reorder,
     never a re-render. */
  function shuffleGroups() {
    var wall = el.cards && el.cards.querySelector(".track-wall");
    if (!wall) return;
    var groups = Array.prototype.slice.call(wall.children)
      .filter(function (n) { return n.classList.contains("track-group"); });
    for (var i = groups.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = groups[i]; groups[i] = groups[j]; groups[j] = tmp;
    }
    groups.forEach(function (g) { wall.appendChild(g); });
  }

  /* Measure the column, then derive cassette size, pitch and radius from it. */
  function measureMagazine() {
    if (!el.magazine || !el.cards) return;

    if (mag.mode === "rail") {
      var railW = el.magazine.getBoundingClientRect().width || 320;
      var railCard = clamp(70, railW * 0.235, 116);
      document.documentElement.style.setProperty("--rail-card-w", railCard.toFixed(1) + "px");
      return;
    }

    var box = el.magazine.getBoundingClientRect();
    var W = Math.max(120, box.width);
    var H = Math.max(160, box.height);

    var stepGutter = 54;                       // reserved for the ▲ / ▼ buttons
    var lane = Math.max(90, W - stepGutter);
    var cardW = clamp(76, lane * 0.62, 172);
    var cardH = cardW / 1.06 + 15;             // sleeve + version tag

    mag.pitch = cardH * 1.13;
    /* A larger radius flattens the arc. Tie it to column height so a tall
       window shows more of the magazine rather than a tighter curve. */
    mag.radius = Math.max(H * 1.02, mag.pitch * 3.7);
    mag.stepDeg = (mag.pitch / mag.radius) * DEG;
    mag.arcLimit = Math.min(64, Math.asin(clamp(0, (H / 2 + cardH * 0.55) / mag.radius, 1)) * DEG);

    var cardCx = lane - cardW / 2 - 8;
    mag.centreX = cardCx - mag.radius;
    mag.centreY = H / 2;

    document.documentElement.style.setProperty("--card-w", cardW.toFixed(1) + "px");

    var discR = mag.radius / 0.78;
    if (el.wheel) {
      el.wheel.style.setProperty("--wheel-x", mag.centreX.toFixed(1) + "px");
      el.wheel.style.setProperty("--wheel-y", mag.centreY.toFixed(1) + "px");
      el.wheel.style.setProperty("--wheel-d", (discR * 2).toFixed(1) + "px");
    }
    if (el.hub) {
      el.hub.style.setProperty("--wheel-x", mag.centreX.toFixed(1) + "px");
      el.hub.style.setProperty("--wheel-y", mag.centreY.toFixed(1) + "px");
      el.hub.style.setProperty("--wheel-d", (discR * 2).toFixed(1) + "px");
    }
  }

  function paintMagazine() {
    var n = mag.cards.length;
    if (!n) return;

    if (mag.mode === "rail") {
      mag.cards.forEach(function (card) { card.dataset.visible = "true"; });
      return;
    }

    for (var i = 0; i < n; i++) {
      var card = mag.cards[i];
      var offset = mod(i - mag.position + n / 2, n) - n / 2;
      var theta = offset * mag.stepDeg;

      if (Math.abs(theta) > mag.arcLimit) {
        if (card.dataset.visible !== "false") card.dataset.visible = "false";
        continue;
      }
      card.dataset.visible = "true";

      var rad = theta / DEG;
      var near = Math.abs(theta) / mag.arcLimit;
      card.style.setProperty("--x", (mag.centreX + mag.radius * Math.cos(rad)).toFixed(1) + "px");
      card.style.setProperty("--y", (mag.centreY + mag.radius * Math.sin(rad)).toFixed(1) + "px");
      /* Tapes lean with the arc, but at 0.62 of it: a full lean reads as
         sloppy typesetting rather than a rotary mechanism. */
      card.style.setProperty("--tilt", (theta * 0.62).toFixed(2) + "deg");
      card.style.setProperty("--scale", (1 - near * 0.17).toFixed(3));
      card.style.setProperty("--opacity", (1 - near * 0.62).toFixed(3));
      card.style.setProperty("--z", String(1000 - Math.round(Math.abs(theta) * 4)));
      card.dataset.pickup = Math.abs(offset) < 0.5 ? "true" : "false";
    }

    if (el.wheel) {
      el.wheel.style.setProperty("--wheel-spin", (-mag.position * mag.stepDeg).toFixed(2) + "deg");
    }
  }

  function relayoutMagazine() { measureMagazine(); paintMagazine(); }

  function pickupIndex() {
    var n = mag.cards.length;
    return n ? mod(Math.round(mag.position), n) : 0;
  }
  function indexOfTrack(track) {
    if (!track) return -1;
    for (var i = 0; i < mag.cards.length; i++) {
      if (mag.cards[i].dataset.track === track.id) return i;
    }
    return -1;
  }
  function trackAt(index) {
    var n = mag.cards.length;
    if (!n) return null;
    return byId[mag.cards[mod(index, n)].dataset.track] || null;
  }

  /* Animate `position` rather than transitioning transforms, so cards travel
     along the arc instead of cutting the chord. */
  function glideTo(index, opts, done) {
    opts = opts || {};
    var n = mag.cards.length;
    if (!n) { if (done) done(); return; }

    if (mag.mode === "rail") {
      mag.position = mod(index, n);
      var card = mag.cards[mag.position];
      if (card && card.scrollIntoView) {
        card.scrollIntoView({
          behavior: reduceMotion.matches ? "auto" : "smooth",
          inline: "center",
          block: "nearest"
        });
      }
      if (done) done();
      return;
    }

    cancelAnimationFrame(mag.anim);

    /* Shortest way round, unless a long shuffle spin was asked for. */
    var target = mag.position + (mod(index - mag.position + n / 2, n) - n / 2);
    var duration = opts.long ? 1150 : (opts.duration == null ? 380 : opts.duration);
    if (opts.long) target += n * (1 + Math.floor(Math.random() * 2));
    if (reduceMotion.matches) duration = 0;

    if (duration <= 0) {
      mag.position = mod(target, n);
      paintMagazine();
      if (done) done();
      return;
    }

    var from = mag.position;
    var start = performance.now();
    (function frame(now) {
      var t = clamp(0, (now - start) / duration, 1);
      mag.position = from + (target - from) * easeOut(t);
      paintMagazine();
      if (t < 1) mag.anim = requestAnimationFrame(frame);
      else { mag.position = mod(target, n); paintMagazine(); if (done) done(); }
    })(start);
  }

  function stepMagazine(dir) {
    if (!mag.cards.length) return;
    glideTo(pickupIndex() + dir, { duration: 300 }, null);
  }

  function markSelected(id) {
    mag.cards.forEach(function (card) {
      var on = card.dataset.track === id;
      card.dataset.active = on ? "true" : "false";
      card.classList.toggle("is-in-deck", on && mag.mode === "wheel");
      var button = card.querySelector(".card__play");
      if (button) button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function applyMagazineMode() {
    var next = MAGAZINE_QUERY.matches ? "rail" : "wheel";
    if (next === mag.mode && document.documentElement.dataset.magazine) return;
    mag.mode = next;
    document.documentElement.dataset.magazine = next;

    if (next === "rail") {
      cancelAnimationFrame(mag.anim);
      mag.cards.forEach(function (card) {
        card.removeAttribute("style");
        card.classList.remove("is-in-deck", "is-departing");
      });
    }
    relayoutMagazine();
    if (current) markSelected(current.id);
  }

  function bindMagazine() {
    if (!el.cards) return;

    el.cards.addEventListener("click", function (event) {
      if (Date.now() < mag.suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      /* Pointer capture retargets click to the capture element, so fall back
         to whatever the pointer actually went down on. */
      var card = event.target.closest(".card") || mag.lastHit;
      mag.lastHit = null;
      if (!card) return;
      var track = byId[card.dataset.track];
      if (!track) return;
      if (current && current.id === track.id) {
        if (audio.paused) startPlayback(); else audio.pause();
        return;
      }
      engage(track, true, false);
    });

    el.cards.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      stepMagazine(event.key === "ArrowUp" ? -1 : 1);
    });

    /* Wheel-mode gestures only. In rail mode the browser's own horizontal
       scrolling and snap points do the job better than we can. */
    el.cards.addEventListener("wheel", function (event) {
      if (mag.mode !== "wheel" || !mag.cards.length) return;
      event.preventDefault();
      var delta = event.deltaY || event.deltaX;
      mag.position += delta / mag.pitch;
      paintMagazine();
      clearTimeout(el.cards._settle);
      el.cards._settle = setTimeout(function () {
        glideTo(pickupIndex(), { duration: 220 }, null);
      }, 110);
    }, { passive: false });

    el.cards.addEventListener("pointerdown", function (event) {
      if (mag.mode !== "wheel" || event.button !== 0 || !mag.cards.length) return;
      cancelAnimationFrame(mag.anim);
      mag.lastHit = event.target.closest(".card");
      mag.dragging = {
        id: event.pointerId, y: event.clientY,
        from: mag.position, moved: false, captured: false
      };
    });

    el.cards.addEventListener("pointermove", function (event) {
      if (!mag.dragging || mag.dragging.id !== event.pointerId) return;
      var dy = event.clientY - mag.dragging.y;

      if (!mag.dragging.moved) {
        if (Math.abs(dy) <= 4) return;
        mag.dragging.moved = true;
        el.cards.dataset.dragging = "true";
        /* Capture only once a real drag begins. Capturing on pointerdown
           retargets the following click to this container, which is what
           stopped cassettes being selectable with the mouse at all. */
        try {
          el.cards.setPointerCapture(event.pointerId);
          mag.dragging.captured = true;
        } catch (_) {}
      }

      mag.position = mag.dragging.from + dy / mag.pitch;
      paintMagazine();
    });

    function endDrag(event) {
      if (!mag.dragging || mag.dragging.id !== event.pointerId) return;
      var moved = mag.dragging.moved;
      var captured = mag.dragging.captured;
      mag.dragging = null;
      el.cards.dataset.dragging = "false";
      if (captured) { try { el.cards.releasePointerCapture(event.pointerId); } catch (_) {} }
      if (!moved) return;                       /* a tap: let the click select */
      mag.suppressClickUntil = Date.now() + 300;
      glideTo(pickupIndex(), { duration: 240 }, null);
    }
    el.cards.addEventListener("pointerup", endDrag);
    el.cards.addEventListener("pointercancel", endDrag);

    if (el.prev) el.prev.addEventListener("click", function () { stepMagazine(-1); });
    if (el.next) el.next.addEventListener("click", function () { stepMagazine(1); });

    if (MAGAZINE_QUERY.addEventListener) MAGAZINE_QUERY.addEventListener("change", applyMagazineMode);
    else MAGAZINE_QUERY.addListener(applyMagazineMode);

    if (window.ResizeObserver && el.magazine) {
      new ResizeObserver(function () { relayoutMagazine(); }).observe(el.magazine);
    } else {
      window.addEventListener("resize", relayoutMagazine, { passive: true });
    }
  }

  /* ======================================================== AUDIO GRAPH == */

  var EQ_FREQS = [60, 250, 1000, 4000, 12000];
  var eqInputs = Array.prototype.slice.call(document.querySelectorAll("[data-eq-frequency]"));

  var graph = {
    ctx: null,
    ready: false,
    analyser: null,        // mono, for the spectrum
    analyserL: null,
    analyserR: null,
    freq: null,
    timeL: null,
    timeR: null,
    filters: []
  };

  function setEqAvailable(ok) {
    eqInputs.forEach(function (i) { i.disabled = !ok; });
    if (el.eqFlat) el.eqFlat.disabled = !ok;
    if (el.eqNote) {
      el.eqNote.textContent = ok
        ? "Applied live to the deck output."
        : "Needs http or https. Direct file:// playback stays native.";
    }
  }

  function buildGraph() {
    if (graph.ready || location.protocol === "file:") {
      if (!graph.ready) setEqAvailable(false);
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { setEqAvailable(false); return; }

    try {
      var ctx = new AC();
      var source = ctx.createMediaElementSource(audio);

      graph.filters = EQ_FREQS.map(function (f, i) {
        var node = ctx.createBiquadFilter();
        node.frequency.value = f;
        node.gain.value = 0;
        if (i === 0) node.type = "lowshelf";
        else if (i === EQ_FREQS.length - 1) node.type = "highshelf";
        else { node.type = "peaking"; node.Q.value = 1.05; }
        return node;
      });

      var limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;

      var node = source;
      graph.filters.forEach(function (f) { node.connect(f); node = f; });
      node.connect(limiter);
      limiter.connect(ctx.destination);

      /* Meter taps sit after the limiter, which is what "post EQ" on the
         panel legend promises. */
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.32;
      analyser.minDecibels = -86;
      analyser.maxDecibels = -18;
      limiter.connect(analyser);

      var splitter = ctx.createChannelSplitter(2);
      limiter.connect(splitter);
      var left = ctx.createAnalyser();
      var right = ctx.createAnalyser();
      left.fftSize = right.fftSize = 1024;
      left.smoothingTimeConstant = right.smoothingTimeConstant = 0;
      splitter.connect(left, 0);
      splitter.connect(right, 1);

      graph.ctx = ctx;
      graph.analyser = analyser;
      graph.analyserL = left;
      graph.analyserR = right;
      graph.freq = new Uint8Array(analyser.frequencyBinCount);
      graph.timeL = new Uint8Array(left.fftSize);
      graph.timeR = new Uint8Array(right.fftSize);
      graph.ready = true;
      setEqAvailable(true);
      applyEq();
    } catch (_) {
      graph.ready = false;
      setEqAvailable(false);
    }
  }

  function resumeGraph() {
    buildGraph();
    if (graph.ctx && graph.ctx.state === "suspended") graph.ctx.resume().catch(function () {});
  }

  function eqState() {
    var out = {};
    eqInputs.forEach(function (i) { out[i.dataset.eqFrequency] = Number(i.value) || 0; });
    return out;
  }
  function updateEqLabels() {
    eqInputs.forEach(function (i) {
      var out = i.parentElement && i.parentElement.querySelector("output");
      var v = Number(i.value) || 0;
      if (out) out.textContent = (v > 0 ? "+" : "") + v + " dB";
    });
  }
  function applyEq() {
    var state = eqState();
    remember("gbr:eq", JSON.stringify(state));
    updateEqLabels();
    if (!graph.ready) return;
    var now = graph.ctx.currentTime;
    graph.filters.forEach(function (f, i) {
      var v = Number(state[String(EQ_FREQS[i])]) || 0;
      try { f.gain.setTargetAtTime(v, now, 0.025); } catch (_) { f.gain.value = v; }
    });
  }

  /* ============================================================ METERS === */
  /* One rAF loop drives both instruments. It idles when nothing is playing
     and the needles have come to rest, so a paused tab costs nothing. */

  var SPECTRUM_BANDS = 24;
  var SPECTRUM_SEGS = 13;
  var BAND_CENTRES = [];
  (function () {
    for (var i = 0; i < SPECTRUM_BANDS; i++) {
      BAND_CENTRES.push(40 * Math.pow(17000 / 40, i / (SPECTRUM_BANDS - 1)));
    }
  })();

  var VU_REFERENCE = 9;   /* dB added to dBFS so that -9 dBFS reads 0 VU */

  /* A real VU face is not a linear scale. */
  var VU_SCALE = [
    [-20, 0.00], [-10, 0.25], [-7, 0.35], [-5, 0.43], [-3, 0.53],
    [-2, 0.59], [-1, 0.65], [0, 0.76], [1, 0.85], [2, 0.93], [3, 1.00]
  ];
  function vuToFraction(vu) {
    if (vu <= VU_SCALE[0][0]) return 0;
    if (vu >= VU_SCALE[VU_SCALE.length - 1][0]) return 1;
    for (var i = 1; i < VU_SCALE.length; i++) {
      if (vu <= VU_SCALE[i][0]) {
        var a = VU_SCALE[i - 1], b = VU_SCALE[i];
        return a[1] + (b[1] - a[1]) * ((vu - a[0]) / (b[0] - a[0]));
      }
    }
    return 1;
  }

  var meters = {
    running: false,
    raf: 0,
    last: 0,
    face: null,
    faceKey: "",
    channels: [
      { name: "L", pos: 0, vel: 0, target: 0, peak: 0, peakAt: 0, over: 0 },
      { name: "R", pos: 0, vel: 0, target: 0, peak: 0, peakAt: 0, over: 0 }
    ],
    spectrum: [],
    caps: []
  };
  for (var b = 0; b < SPECTRUM_BANDS; b++) { meters.spectrum.push(0); meters.caps.push(0); }

  function fitCanvas(canvas) {
    if (!canvas) return null;
    var rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(rect.width * dpr);
    var h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: rect.width, h: rect.height };
  }

  /* The scale, lettering and red arc never change, so they are drawn once
     into an offscreen canvas and blitted each frame. */
  function renderVuFace(w, h) {
    var key = Math.round(w) + "x" + Math.round(h);
    if (meters.face && meters.faceKey === key) return meters.face;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var off = document.createElement("canvas");
    off.width = Math.round(w * dpr);
    off.height = Math.round(h * dpr);
    var c = off.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    var gap = 3;
    var mh = (h - gap) / 2;
    for (var i = 0; i < 2; i++) {
      drawFacePlate(c, 0, i * (mh + gap), w, mh, meters.channels[i].name);
    }

    meters.face = { canvas: off, w: w, h: h, meterH: mh, gap: gap };
    meters.faceKey = key;
    return meters.face;
  }

  /* Plates taller than this get the full treatment: numerals following the
     arc, and a shroud the needle emerges from. */
  function isRoomy(h) { return h >= 58; }

  function meterGeometry(w, h) {
    /* One formula covers both plate proportions. Sweep comes from the aspect
       ratio, the radius from the width, and the pivot drops below the plate as
       it does on real hardware. The second constraint keeps the ends of the
       arc from running off the bottom of a tall plate. */
    var sweep = clamp(22, 90 * (h / w) + 8, 52) / DEG;
    var crown = h * 0.17;
    var floorLimit = isRoomy(h) ? 0.58 : 0.82;   /* how far down the arc may go */
    var r = Math.min(
      (w * 0.42) / Math.sin(sweep),
      ((floorLimit - 0.17) * h) / (1 - Math.cos(sweep))
    );
    return { cx: w / 2, cy: r + crown, r: r, sweep: sweep };
  }
  function needleAngle(geo, fraction) {
    return -Math.PI / 2 + (fraction - 0.5) * 2 * geo.sweep;
  }

  function drawFacePlate(c, x, y, w, h, label) {
    c.save();
    c.translate(x, y);

    var plate = c.createLinearGradient(0, 0, 0, h);
    plate.addColorStop(0, "#f2dfb3");
    plate.addColorStop(0.5, "#e5cd9b");
    plate.addColorStop(1, "#c3a268");
    c.fillStyle = plate;
    roundRect(c, 0, 0, w, h, 3);
    c.fill();

    /* Lamp behind the face, brightest at the crown of the arc. */
    var geo = meterGeometry(w, h);
    var lamp = c.createRadialGradient(geo.cx, h * 0.34, 0, geo.cx, h * 0.34, w * 0.6);
    lamp.addColorStop(0, "rgba(255, 226, 160, 0.55)");
    lamp.addColorStop(1, "rgba(255, 196, 96, 0)");
    c.fillStyle = lamp;
    roundRect(c, 0, 0, w, h, 3);
    c.fill();

    var roomy = isRoomy(h);
    var arcW = clamp(1.5, h * 0.045, 3.4);
    var tickLong = clamp(3, h * 0.13, 15);
    var tickShort = tickLong * 0.55;

    c.lineWidth = arcW;
    c.strokeStyle = "#3a2c1c";
    c.beginPath();
    c.arc(geo.cx, geo.cy, geo.r, needleAngle(geo, 0), needleAngle(geo, vuToFraction(0)));
    c.stroke();
    c.strokeStyle = "#c23a22";
    c.beginPath();
    c.arc(geo.cx, geo.cy, geo.r, needleAngle(geo, vuToFraction(0)), needleAngle(geo, 1));
    c.stroke();

    var majors = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
    var labelled = [-20, -10, -5, -3, 0, 3];
    majors.forEach(function (vu) {
      var long = labelled.indexOf(vu) !== -1;
      if (!roomy && !long) return;
      var a = needleAngle(geo, vuToFraction(vu));
      var len = long ? tickLong : tickShort;
      c.strokeStyle = vu >= 0 ? "#a8331f" : "#3a2c1c";
      c.lineWidth = long ? Math.max(1.2, arcW * 0.5) : Math.max(0.8, arcW * 0.32);
      c.beginPath();
      c.moveTo(geo.cx + Math.cos(a) * (geo.r - arcW / 2 - len),
               geo.cy + Math.sin(a) * (geo.r - arcW / 2 - len));
      c.lineTo(geo.cx + Math.cos(a) * (geo.r - arcW / 2),
               geo.cy + Math.sin(a) * (geo.r - arcW / 2));
      c.stroke();
    });

    if (roomy) {
      /* Numerals sit inside the arc, on their own tick. */
      var fs = clamp(7, h * 0.105, 14);
      c.font = "600 " + fs.toFixed(1) + "px ui-monospace, monospace";
      c.textAlign = "center";
      c.textBaseline = "middle";
      var ringR = geo.r - arcW / 2 - tickLong - fs * 1.15;
      /* The shroud is drawn over the bottom of the plate, so lift any numeral
         that would otherwise sit behind it. Real faces offset the end
         numerals for the same reason. */
      var ceiling = h * 0.74 - fs * 0.75;
      labelled.forEach(function (vu) {
        var a = needleAngle(geo, vuToFraction(vu));
        c.fillStyle = vu >= 0 ? "#a8331f" : "#4a3720";
        c.fillText(vu > 0 ? "+" + vu : String(vu),
                   geo.cx + Math.cos(a) * ringR,
                   Math.min(geo.cy + Math.sin(a) * ringR, ceiling));
      });
    } else if (h >= 26) {
      c.font = "600 " + Math.max(5, Math.round(h * 0.15)) + "px ui-monospace, monospace";
      c.textBaseline = "top";
      c.textAlign = "left";
      c.fillStyle = "#4a3720";
      c.fillText("-20", 4, h * 0.5);
      c.textAlign = "right";
      c.fillStyle = "#a8331f";
      c.fillText("+3", w - 4, h * 0.5);
    }

    if (!roomy) {
      c.fillStyle = "#5b452a";
      c.font = "700 " + clamp(6, h * 0.2, 13).toFixed(1) + "px ui-monospace, monospace";
      c.textAlign = "left";
      c.textBaseline = "bottom";
      c.fillText(label, 5, h - 3);
      c.textAlign = "right";
      c.fillText("VU", w - 5, h - 3);
    }

    c.strokeStyle = "rgba(70,50,26,0.55)";
    c.lineWidth = 1;
    roundRect(c, 0.5, 0.5, w - 1, h - 1, 3);
    c.stroke();

    c.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawVu(dt) {
    var fit = fitCanvas(el.vu);
    if (!fit) return false;
    var face = renderVuFace(fit.w, fit.h);
    var c = fit.ctx;

    c.clearRect(0, 0, fit.w, fit.h);
    c.drawImage(face.canvas, 0, 0, fit.w, fit.h);

    var settled = true;
    var now = performance.now();

    for (var i = 0; i < 2; i++) {
      var ch = meters.channels[i];

      /* Spring ballistics: ~300 ms to reach 99% with the slight overshoot a
         mechanical movement actually has. */
      var accel = (ch.target - ch.pos) * 190 - ch.vel * 26;
      ch.vel += accel * dt;
      ch.pos += ch.vel * dt;
      ch.pos = clamp(0, ch.pos, 1.06);
      if (Math.abs(ch.target - ch.pos) > 0.002 || Math.abs(ch.vel) > 0.01) settled = false;

      var top = i * (face.meterH + face.gap);
      var geo = meterGeometry(fit.w, face.meterH);
      var angle = needleAngle(geo, clamp(0, ch.pos, 1));

      c.save();
      c.translate(0, top);
      c.beginPath();
      c.rect(0, 0, fit.w, face.meterH);
      c.clip();

      /* Peak hold pip. */
      if (now - ch.peakAt < 1400 && ch.peak > 0.02) {
        var pa = needleAngle(geo, clamp(0, ch.peak, 1));
        c.fillStyle = ch.peak >= vuToFraction(0) ? "#b8321c" : "#6b542f";
        c.beginPath();
        c.arc(geo.cx + Math.cos(pa) * geo.r, geo.cy + Math.sin(pa) * geo.r,
              clamp(1.1, face.meterH * 0.022, 3.4), 0, Math.PI * 2);
        c.fill();
        settled = false;
      }

      /* Needle. */
      var roomy = isRoomy(face.meterH);
      var tipX = geo.cx + Math.cos(angle) * (geo.r + face.meterH * 0.02);
      var tipY = geo.cy + Math.sin(angle) * (geo.r + face.meterH * 0.02);
      var tail = geo.r * (roomy ? 0.62 : 0.3);
      var baseX = geo.cx + Math.cos(angle) * (geo.r - tail);
      var baseY = geo.cy + Math.sin(angle) * (geo.r - tail);

      c.strokeStyle = "rgba(20,12,4,0.28)";
      c.lineWidth = Math.max(1.6, face.meterH * 0.05);
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(baseX + 1, baseY + 1.2);
      c.lineTo(tipX + 1, tipY + 1.2);
      c.stroke();

      c.strokeStyle = "#1d1409";
      c.lineWidth = Math.max(1.2, face.meterH * 0.038);
      c.beginPath();
      c.moveTo(baseX, baseY);
      c.lineTo(tipX, tipY);
      c.stroke();

      /* Shroud: the needle has to come out of something. Drawn after the
         needle so it hides the tail, which is why it is not part of the
         cached face. */
      if (roomy) {
        var sy = face.meterH * 0.74;
        var shroud = c.createLinearGradient(0, sy, 0, face.meterH);
        shroud.addColorStop(0, "#8c7345");
        shroud.addColorStop(0.18, "#3a2c1a");
        shroud.addColorStop(1, "#221a0f");
        c.fillStyle = shroud;
        c.fillRect(0, sy, fit.w, face.meterH - sy);
        c.fillStyle = "#d8bd85";
        c.font = "700 " + clamp(7, face.meterH * 0.1, 13).toFixed(1) + "px ui-monospace, monospace";
        c.textBaseline = "bottom";
        c.textAlign = "left";
        c.fillText(ch.name, 6, face.meterH - 5);
        c.textAlign = "right";
        c.fillText("VU", fit.w - 6, face.meterH - 5);
      }

      /* Overload lamp. */
      if (ch.over > 0) {
        ch.over = Math.max(0, ch.over - dt * 1.6);
        c.fillStyle = "rgba(224,73,42," + (0.35 + ch.over * 0.65).toFixed(3) + ")";
        c.beginPath();
        c.arc(fit.w - 8, 6, Math.max(2, face.meterH * 0.07), 0, Math.PI * 2);
        c.fill();
        settled = false;
      }

      c.restore();
    }

    return !settled;
  }

  function drawSpectrum() {
    var fit = fitCanvas(el.spectrum);
    if (!fit) return false;
    var c = fit.ctx;
    c.clearRect(0, 0, fit.w, fit.h);

    var padX = 3, padY = 2;
    var gapX = fit.w > 340 ? 3 : 2;
    var gapY = fit.h > 90 ? 2 : 1;
    var bandW = (fit.w - padX * 2 - gapX * (SPECTRUM_BANDS - 1)) / SPECTRUM_BANDS;
    var segH = (fit.h - padY * 2 - gapY * (SPECTRUM_SEGS - 1)) / SPECTRUM_SEGS;
    if (bandW < 1 || segH < 1) return false;

    var live = false;
    for (var i = 0; i < SPECTRUM_BANDS; i++) {
      var level = meters.spectrum[i];
      var lit = Math.round(level * SPECTRUM_SEGS);
      var cap = Math.round(meters.caps[i] * SPECTRUM_SEGS);
      if (level > 0.004) live = true;

      for (var s = 0; s < SPECTRUM_SEGS; s++) {
        var x = padX + i * (bandW + gapX);
        var y = padY + (SPECTRUM_SEGS - 1 - s) * (segH + gapY);
        var on = s < lit;
        var isCap = s === cap - 1 && cap > 0;

        if (on || isCap) {
          var heat = s / (SPECTRUM_SEGS - 1);
          c.fillStyle = isCap && !on
            ? "#8a5a1c"
            : (heat > 0.86 ? "#ff5c1a" : (heat > 0.62 ? "#ff9a1e" : "#e77d0a"));
        } else {
          c.fillStyle = "#20130a";
        }
        roundRect(c, x, y, bandW, segH, Math.min(1.5, segH / 2));
        c.fill();
      }
    }
    return live;
  }

  function sampleAudio(dt) {
    if (!graph.ready) return;

    /* Spectrum: geometric-mean band edges over the FFT. */
    graph.analyser.getByteFrequencyData(graph.freq);
    var nyquist = graph.ctx.sampleRate / 2;
    var bins = graph.freq.length;
    for (var i = 0; i < SPECTRUM_BANDS; i++) {
      var centre = Math.min(BAND_CENTRES[i], nyquist * 0.96);
      var lo = i ? Math.sqrt(BAND_CENTRES[i - 1] * BAND_CENTRES[i]) : centre / 1.4;
      var hi = i < SPECTRUM_BANDS - 1 ? Math.sqrt(centre * BAND_CENTRES[i + 1]) : centre * 1.4;
      var b0 = Math.max(1, Math.floor(lo / nyquist * bins));
      var b1 = Math.min(bins - 1, Math.ceil(hi / nyquist * bins));
      var sum = 0, count = 0;
      for (var k = b0; k <= b1; k++) { sum += graph.freq[k]; count++; }
      var raw = count ? (sum / count) / 255 : 0;

      meters.spectrum[i] = raw > meters.spectrum[i]
        ? raw
        : Math.max(0, meters.spectrum[i] - dt * 1.05);
      meters.caps[i] = meters.spectrum[i] > meters.caps[i]
        ? meters.spectrum[i]
        : Math.max(0, meters.caps[i] - dt * 0.32);
    }

    /* VU: RMS per channel, referenced so -9 dBFS reads 0 VU. */
    var buffers = [graph.timeL, graph.timeR];
    var analysers = [graph.analyserL, graph.analyserR];
    for (var ch = 0; ch < 2; ch++) {
      analysers[ch].getByteTimeDomainData(buffers[ch]);
      var buf = buffers[ch], sq = 0, peak = 0;
      for (var n = 0; n < buf.length; n++) {
        var v = (buf[n] - 128) / 128;
        sq += v * v;
        var a = Math.abs(v);
        if (a > peak) peak = a;
      }
      var rms = Math.sqrt(sq / buf.length);
      var vu = rms > 0.00002 ? 20 * Math.log10(rms) + VU_REFERENCE : -40;
      var state = meters.channels[ch];
      state.target = vuToFraction(clamp(-24, vu, 4));

      var peakVu = peak > 0.00002 ? 20 * Math.log10(peak) + VU_REFERENCE : -40;
      var peakFraction = vuToFraction(clamp(-24, peakVu, 4));
      if (peakFraction >= state.peak || performance.now() - state.peakAt > 1400) {
        state.peak = peakFraction;
        state.peakAt = performance.now();
      }
      if (peak > 0.985) state.over = 1;
    }
  }

  function meterFrame(now) {
    var dt = meters.last ? Math.min((now - meters.last) / 1000, 0.05) : 0.016;
    meters.last = now;

    sampleAudio(dt);
    var vuBusy = drawVu(dt);
    var spectrumBusy = drawSpectrum();

    var playing = !audio.paused && !audio.ended;
    if (playing || vuBusy || spectrumBusy) {
      meters.raf = requestAnimationFrame(meterFrame);
    } else {
      meters.running = false;
      meters.raf = 0;
    }
  }

  function startMeters() {
    if (meters.running || document.hidden) return;
    meters.running = true;
    meters.last = 0;
    meters.raf = requestAnimationFrame(meterFrame);
  }
  function stopMeters() {
    cancelAnimationFrame(meters.raf);
    meters.running = false;
    meters.raf = 0;
  }
  function restMeters() {
    /* Draw the instruments once at rest so they are never blank. */
    meters.channels.forEach(function (ch) { ch.target = 0; });
    drawVu(0.016);
    drawSpectrum();
  }

  /* ============================================================== DECK === */

  function artPath(track) {
    var base = track && track.artwork && track.artwork.base;
    return "assets/img/sleeves/" + (base || "gbr-placeholder") + "-640.jpg";
  }

  function assetUrl(name, folder) {
    if (!name) return null;
    if (/^(https?:)?\/\//i.test(name) || name.charAt(0) === "/" ||
        name.indexOf("data:") === 0 || name.indexOf("blob:") === 0) return name;
    return folder + name;
  }

  function hasLossless(track) {
    var s = (track && track.audio && track.audio.sources) || {};
    return !!(s.flac || s.lossless);
  }

  function chooseSource(track) {
    var s = (track && track.audio && track.audio.sources) || {};
    var loss = s.flac || s.lossless;
    var wants = !!(el.lossless && el.lossless.checked);
    if (wants && loss && audio.canPlayType("audio/flac")) return assetUrl(loss, "assets/audio/tracks/");
    if (s.opus && audio.canPlayType('audio/ogg; codecs="opus"')) return assetUrl(s.opus, "assets/audio/tracks/");
    if (s.mp3) return assetUrl(s.mp3, "assets/audio/tracks/");
    if (s.wav && audio.canPlayType("audio/wav")) return assetUrl(s.wav, "assets/audio/tracks/");
    if (loss && audio.canPlayType("audio/flac")) return assetUrl(loss, "assets/audio/tracks/");
    return null;
  }

  function versionLabel(track) {
    var v = (track.provenance || {}).songVersion;
    if (v != null) {
      var text = String(v).trim();
      return text.toLowerCase().charAt(0) === "v" ? text : "v" + text;
    }
    return track.versionLabel || null;
  }

  /* The title plate. v6 had no track title anywhere in the interface, so the
     only way to know what was playing was to recognise the sleeve. */
  function paintPlate(track) {
    if (el.title) el.title.textContent = track ? track.title : "No cassette latched";
    if (!el.meta) return;

    if (!track) {
      el.meta.innerHTML = "";
      return;
    }
    var chips = [];
    var version = versionLabel(track);
    if (version) chips.push(['<li data-kind="version">', version]);
    if (track.style && track.style.genre) chips.push(["<li>", track.style.genre]);
    if (track.catalogueNumber) chips.push(["<li>", track.catalogueNumber]);
    if (track.audio && track.audio.duration) chips.push(["<li>", clock(track.audio.duration)]);
    if (hasLossless(track)) chips.push(["<li>", "FLAC"]);
    el.meta.innerHTML = chips.map(function (c) { return c[0] + esc(c[1]) + "</li>"; }).join("");
  }

  function paintArtwork(track) {
    if (!el.art) return;
    el.art.src = artPath(track);
    el.art.alt = "Sleeve artwork for " + track.title;
    if (el.artFrame) {
      el.artFrame.classList.remove("materialize");
      void el.artFrame.offsetWidth;
      el.artFrame.classList.add("materialize");
    }
    if (el.slot) el.slot.classList.add("loaded");
  }

  function buildTech(track) {
    if (!el.techContent) return;
    if (!track) { el.techContent.innerHTML = "<p>No cassette latched.</p>"; return; }

    var rows = [];
    var model = track.model || {}, prov = track.provenance || {};
    var gen = track.generation || {}, style = track.style || {};
    if (model.provider || model.name) rows.push(["Model", [model.provider, model.name].filter(Boolean).join(" ")]);
    if (prov.songVersion != null) rows.push(["Version", "v" + prov.songVersion]);
    if (prov.generationNumber != null) rows.push(["Generation", "#" + prov.generationNumber]);
    if (gen.cfg != null) rows.push(["CFG", gen.cfg]);
    if (gen.steps != null) rows.push(["Steps", gen.steps]);
    if (gen.seed != null) rows.push(["Seed", gen.seed]);
    if (style.genre) rows.push(["Genre", style.genre]);
    if (track.audio && track.audio.duration) rows.push(["Duration", clock(track.audio.duration)]);
    if (track.catalogueNumber) rows.push(["Catalogue", track.catalogueNumber]);

    var html = '<dl class="gbr-tech-grid">' + rows.map(function (r) {
      return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>";
    }).join("") + "</dl>";
    var note = (track.notes && (track.notes.short || track.notes.caption)) || track.subtitle;
    /* Prose about a track lives here, not on the plate. */
    if (note) html += '<p class="gbr-tech-note">' + esc(note) + "</p>";
    el.techContent.innerHTML = html;
  }

  function mediaSession(track) {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: "Good Boy Records",
        album: track.catalogueNumber || "Good Boy Records",
        artwork: [{ src: artPath(track), sizes: "640x640", type: "image/jpeg" }]
      });
      navigator.mediaSession.setActionHandler("play", function () { startPlayback(); });
      navigator.mediaSession.setActionHandler("pause", function () { audio.pause(); });
      navigator.mediaSession.setActionHandler("nexttrack", function () { advance(1); });
      navigator.mediaSession.setActionHandler("previoustrack", function () { advance(-1); });
    } catch (_) {}
  }

  /* --------------------------------------------------------- insert fx --- */
  /* Mechanisms are noise, not tone. The v6 version was three oscillators and
     read as a UI blip; this is filtered noise bursts shaped into the actual
     sequence a deck makes — shell sliding into the well, the well bottoming
     out, the latch catching, the chassis absorbing it, then the spring flap
     and the two reel hubs engaging.

     Kept on its own AudioContext, deliberately: routing it through the program
     graph would put the latch through the user's EQ and, worse, spike the VU
     meters with a sound that is not the record. */

  var fx = { ctx: null, noise: null };

  function fxContext() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!fx.ctx) {
      try { fx.ctx = new AC(); } catch (_) { return null; }
    }
    if (fx.ctx.state === "suspended") fx.ctx.resume().catch(function () {});
    if (!fx.noise) {
      var len = Math.floor(fx.ctx.sampleRate * 0.5);
      var buffer = fx.ctx.createBuffer(1, len, fx.ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      fx.noise = buffer;
    }
    return fx.ctx;
  }

  function jitter(value, amount) { return value * (1 + (Math.random() * 2 - 1) * amount); }

  /* A filtered noise burst: the building block for every plastic and metal
     part of the sequence. */
  function noiseHit(ctx, out, at, o) {
    var src = ctx.createBufferSource();
    src.buffer = fx.noise;
    src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;

    var filter = ctx.createBiquadFilter();
    filter.type = o.type || "bandpass";
    filter.frequency.setValueAtTime(jitter(o.from, 0.06), at);
    if (o.to) {
      filter.frequency.exponentialRampToValueAtTime(jitter(o.to, 0.06), at + o.dur);
    }
    filter.Q.value = o.q == null ? 1 : o.q;

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(o.gain, at + (o.attack == null ? 0.002 : o.attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(at);
    src.stop(at + o.dur + 0.03);
  }

  /* The low resonance of the chassis taking the weight. */
  function bodyHit(ctx, out, at, freq, dur, level) {
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(jitter(freq, 0.05), at);
    osc.frequency.exponentialRampToValueAtTime(jitter(freq * 0.6, 0.05), at + dur);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }

  function playInsertSound() {
    var ctx = fxContext();
    if (!ctx) return;
    /* Follow the deck's own output level; a latch louder than the music is
       just annoying. */
    var level = clamp(0, audio.volume, 1);
    if (level < 0.02) return;

    try {
      var now = ctx.currentTime + 0.01;
      var master = ctx.createGain();
      master.gain.value = 0.55 * level;

      var tame = ctx.createBiquadFilter();
      tame.type = "lowpass";
      tame.frequency.value = 7200;
      var floorCut = ctx.createBiquadFilter();
      floorCut.type = "highpass";
      floorCut.frequency.value = 70;

      master.connect(tame);
      tame.connect(floorCut);
      floorCut.connect(ctx.destination);

      var t = function (base) { return now + base + (Math.random() * 0.016 - 0.008); };

      /* Shell sliding down the well. */
      noiseHit(ctx, master, t(0), { from: 2100, to: 850, q: 0.9, dur: 0.11, gain: 0.09, attack: 0.025 });

      /* It bottoms out. */
      noiseHit(ctx, master, t(0.09), { from: 950, q: 2.2, dur: 0.055, gain: 0.15 });
      bodyHit(ctx, master, t(0.09), 124, 0.09, 0.09);

      /* Latch catches: the sharp plastic tick. */
      noiseHit(ctx, master, t(0.142), { from: 3400, q: 7, dur: 0.028, gain: 0.30, attack: 0.001 });

      /* Chassis takes it. */
      noiseHit(ctx, master, t(0.155), { type: "lowpass", from: 320, q: 0.7, dur: 0.17, gain: 0.17 });
      bodyHit(ctx, master, t(0.155), 78, 0.19, 0.15);

      /* Spring flap settling. */
      noiseHit(ctx, master, t(0.24), { from: 5200, q: 9, dur: 0.022, gain: 0.12, attack: 0.001 });

      /* Both reel hubs engaging, a few milliseconds apart. */
      noiseHit(ctx, master, t(0.30), { from: 2600, q: 6, dur: 0.02, gain: 0.09, attack: 0.001 });
      noiseHit(ctx, master, t(0.335), { from: 2350, q: 6, dur: 0.02, gain: 0.07, attack: 0.001 });
    } catch (_) {}
  }

  function flyIntoDeck(track, done) {
    var index = indexOfTrack(track);
    var card = index >= 0 ? mag.cards[index] : null;
    var sleeve = card && card.querySelector(".cassette");

    mag.cards.forEach(function (c) {
      if (c !== card) c.classList.remove("is-in-deck", "is-departing");
    });

    if (!card || !sleeve || !el.artFrame || mag.mode === "rail" || reduceMotion.matches) {
      if (card && mag.mode === "wheel") card.classList.add("is-in-deck");
      playInsertSound();
      if (done) done();
      return;
    }

    var from = sleeve.getBoundingClientRect();
    var to = el.artFrame.getBoundingClientRect();
    var w = Math.min(to.width * 0.45, 130), h = w / 1.06;
    var flyer = sleeve.cloneNode(true);
    flyer.classList.add("gbr-cassette-flyer");
    flyer.style.left = from.left + "px";
    flyer.style.top = from.top + "px";
    flyer.style.width = from.width + "px";
    flyer.style.height = from.height + "px";
    document.body.appendChild(flyer);
    card.classList.add("is-departing");

    requestAnimationFrame(function () {
      flyer.style.left = (to.left + (to.width - w) / 2) + "px";
      flyer.style.top = (to.top + to.height - h - 12) + "px";
      flyer.style.width = w + "px";
      flyer.style.height = h + "px";
      flyer.style.transform = "rotate(-1.5deg)";
    });

    setTimeout(function () {
      if (flyer.parentNode) flyer.parentNode.removeChild(flyer);
      card.classList.remove("is-departing");
      card.classList.add("is-in-deck");
      playInsertSound();
      if (done) done();
    }, 560);
  }

  /* ============================================================ LYRICS === */

  var cues = [], lyricToken = 0, lastWord = "", lastLine = "";

  function lineText(line) { return String((line && line.text) || "").replace(/\s+/g, " ").trim(); }
  function usableLine(line) {
    var t = lineText(line);
    return t && !/^\[.*\]$/.test(t);
  }
  function lineAt(t) {
    for (var i = 0; i < cues.length; i++) {
      var l = cues[i], s = Number(l.start || 0), e = Number(l.end);
      if (!isFinite(e)) e = Infinity;
      if (t >= s && t < e && usableLine(l)) return l;
    }
    return null;
  }
  function lastLineBefore(t) {
    var found = null;
    for (var i = 0; i < cues.length; i++) {
      var l = cues[i], e = Number(l.end);
      if (isFinite(e) && e <= t && usableLine(l)) found = l;
    }
    return found;
  }
  function wordAt(line, t) {
    if (!line || !Array.isArray(line.words)) return null;
    for (var i = 0; i < line.words.length; i++) {
      var w = line.words[i];
      if (t >= Number(w.start) && t < Number(w.end)) return w;
    }
    return null;
  }
  function lastWordBefore(line, t) {
    if (!line || !Array.isArray(line.words)) return null;
    var found = null;
    for (var i = 0; i < line.words.length; i++) {
      if (Number(line.words[i].end) <= t) found = line.words[i];
    }
    return found;
  }

  function paintLyric(t) {
    var line = lineAt(t);
    var word = line && wordAt(line, t);
    var past = false, text = "";

    if (word && word.text) {
      text = String(word.text).trim();
      lastWord = text; lastLine = lineText(line);
    } else if (line) {
      var prior = lastWordBefore(line, t);
      if (prior && prior.text) {
        text = String(prior.text).trim();
        past = true; lastWord = text; lastLine = lineText(line);
      } else {
        text = lineText(line).split(/\s+/)[0] || "";
      }
    } else {
      var previous = lastLineBefore(t);
      if (previous) {
        var pw = lastWordBefore(previous, t);
        text = (pw && pw.text ? String(pw.text).trim() : lineText(previous).split(/\s+/).pop()) || lastWord;
        lastLine = lineText(previous) || lastLine;
        past = true;
      } else {
        text = lastWord || "Ready";
      }
    }

    if (el.lyricWord) {
      el.lyricWord.textContent = text || "Ready";
      el.lyricWord.classList.toggle("is-past", past);
    }
    if (el.lyricLine) el.lyricLine.textContent = lineText(line) || lastLine || "";
  }

  function loadLyrics(track) {
    lyricToken++;
    var token = lyricToken;
    cues = (track && track.lyrics && Array.isArray(track.lyrics.cues)) ? track.lyrics.cues : [];
    lastWord = ""; lastLine = "";
    paintLyric(audio.currentTime || 0);

    var wt = track && track.lyrics && track.lyrics.wordTiming;
    if (!wt || !wt.src || ((wt.reviewRequired || wt.usable === false) && !wt.approved)) return;

    fetch(wt.src, { cache: "force-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        if (token !== lyricToken || !d || d.format !== "gbr-word-lyrics-v1" || !Array.isArray(d.lines)) return;
        cues = d.lines;
        lastWord = ""; lastLine = "";
        paintLyric(audio.currentTime || 0);
      })
      .catch(function () {});
  }

  /* ========================================================= TRANSPORT === */

  function playableTracks() {
    return catalogue.filter(function (t) {
      return t && t.audio && t.audio.available !== false && !!chooseSource(t);
    });
  }

  function randomTrack() {
    var pool = playableTracks();
    if (!pool.length) return null;
    if (current && pool.length > 1) {
      /* Prefer a different song before another version of the same one. */
      var other = pool.filter(function (t) { return t.id !== current.id && t.title !== current.title; });
      pool = other.length ? other : pool.filter(function (t) { return t.id !== current.id; });
    }
    return pool[Math.floor(Math.random() * pool.length)] || null;
  }

  function setShuffle(on) {
    shuffleMode = !!on;
    if (el.shuffle) el.shuffle.setAttribute("aria-pressed", shuffleMode ? "true" : "false");
    remember("gbr:shuffle", shuffleMode ? "on" : "off");
  }

  function updateLossless(track) {
    var ok = hasLossless(track);
    if (el.losslessWrap) el.losslessWrap.dataset.available = ok ? "true" : "false";
    if (el.lossless) {
      el.lossless.disabled = !ok;
      el.lossless.checked = ok && recall("gbr:lossless") === "on";
    }
  }

  function fillRange(input) {
    if (!input) return;
    var min = Number(input.min) || 0;
    var max = Number(input.max) || 0;
    var pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty("--fill", clamp(0, pct, 100).toFixed(2) + "%");
  }

  function playbackMessage(err) {
    var name = (err && err.name) || "PlaybackError";
    if (name === "NotAllowedError") return "Press play";
    if (name === "NotSupportedError") return "Format unsupported";
    if (name === "AbortError") return "Source changed";
    return "Playback error";
  }

  function setSource(track) {
    var src = chooseSource(track);
    if (!src) { setStatus("No audio", "fault"); return false; }
    if (location.protocol !== "file:") {
      try {
        if (new URL(src, location.href).origin !== location.origin) audio.crossOrigin = "anonymous";
        else audio.removeAttribute("crossorigin");
      } catch (_) { audio.removeAttribute("crossorigin"); }
    }
    var absolute = new URL(src, location.href).href;
    if (audio.src !== absolute) { audio.src = src; audio.load(); }
    return true;
  }

  function startPlayback() {
    resumeGraph();
    var p;
    try { p = audio.play(); } catch (e) { setStatus(playbackMessage(e), "fault"); return; }
    if (p && p.catch) p.catch(function (e) { setStatus(playbackMessage(e), "fault"); });
  }

  function latch(track, autoplay) {
    if (!track) return;
    current = track;
    markSelected(track.id);
    paintArtwork(track);
    paintPlate(track);
    loadLyrics(track);
    updateLossless(track);
    buildTech(track);
    mediaSession(track);

    var duration = (track.audio && track.audio.duration) || 0;
    if (el.progress) { el.progress.value = 0; el.progress.max = duration; fillRange(el.progress); }
    if (el.elapsed) el.elapsed.textContent = "0:00";
    if (el.total) el.total.textContent = clock(duration);

    try { history.replaceState(null, "", "?track=" + encodeURIComponent(track.slug || track.id)); } catch (_) {}

    if (!setSource(track)) return;
    setStatus("Latched");
    if (autoplay) startPlayback();
  }

  function engage(track, autoplay, longSpin) {
    var index = indexOfTrack(track);
    if (index < 0) { latch(track, autoplay); return; }
    glideTo(index, { long: !!longSpin }, function () {
      flyIntoDeck(track, function () { latch(track, autoplay); });
    });
  }

  function advance(direction) {
    if (cycleBusy) return;
    var track;
    if (direction > 0 && shuffleMode) track = randomTrack();
    else track = trackAt(indexOfTrack(current) + direction);
    if (!track) return;
    cycleBusy = true;
    engage(track, true, direction > 0 && shuffleMode);
    setTimeout(function () { cycleBusy = false; }, reduceMotion.matches ? 80 : 1700);
  }

  /* ============================================================ POPUPS === */

  function openPopup(node, button) {
    if (!node) return;
    node.hidden = false;
    if (button) button.setAttribute("aria-expanded", "true");
  }
  function closePopup(node, button) {
    if (!node) return;
    node.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
  }
  function togglePopup(node, button) {
    if (!node) return;
    if (node.hidden) openPopup(node, button); else closePopup(node, button);
  }

  /* ============================================================ FOLDERS == */
  /* Tabs down the right edge pull out a single drawer; switching tabs swaps
     the sheet inside it rather than closing and reopening. Absent from the
     page entirely when content-source/folders is empty, so everything here
     no-ops rather than guarding at every call site. */

  var folders = { root: null, drawer: null, tabs: [], sheets: [], lastTab: null };

  function setFolder(id) {
    if (!folders.root) return;
    folders.root.dataset.open = id || "";
    folders.tabs.forEach(function (tab) {
      tab.setAttribute("aria-selected", tab.dataset.folder === id ? "true" : "false");
    });
    folders.sheets.forEach(function (sheet) {
      sheet.hidden = sheet.id !== "gbr-folder-" + id;
    });
    if (!id) return;
    var open = document.getElementById("gbr-folder-" + id);
    if (open) { open.scrollTop = 0; open.focus({ preventScroll: true }); }
  }

  function closeFolders(restoreFocus) {
    if (!folders.root || !folders.root.dataset.open) return;
    setFolder("");
    if (restoreFocus && folders.lastTab) folders.lastTab.focus();
  }

  function initFolders() {
    folders.root = $("gbr-folders");
    if (!folders.root) return;
    folders.drawer = $("gbr-folder-drawer");
    folders.tabs = Array.prototype.slice.call(folders.root.querySelectorAll(".gbr-folder-tab"));
    folders.sheets = Array.prototype.slice.call(folders.root.querySelectorAll(".gbr-folder-sheet"));

    folders.tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () {
        folders.lastTab = tab;
        var id = tab.dataset.folder;
        setFolder(folders.root.dataset.open === id ? "" : id);
      });
      /* Roving arrow keys along the tab strip, as a tablist should. */
      tab.addEventListener("keydown", function (event) {
        var step = event.key === "ArrowDown" ? 1 : (event.key === "ArrowUp" ? -1 : 0);
        if (!step) return;
        event.preventDefault();
        folders.tabs[mod(index + step, folders.tabs.length)].focus();
      });
    });

    var close = $("gbr-folder-close");
    if (close) close.addEventListener("click", function () { closeFolders(true); });
    var scrim = $("gbr-folder-scrim");
    if (scrim) scrim.addEventListener("click", function () { closeFolders(true); });
  }

  /* ============================================================== BOOT === */

  function boot() {
    shuffleGroups();
    collectCards();
    initFolders();
    applyMagazineMode();
    bindMagazine();
    restMeters();

    /* EQ */
    var saved = {};
    try { saved = JSON.parse(recall("gbr:eq") || "{}") || {}; } catch (_) {}
    eqInputs.forEach(function (input) {
      if (saved[input.dataset.eqFrequency] != null) input.value = saved[input.dataset.eqFrequency];
      input.addEventListener("input", function () { buildGraph(); applyEq(); });
    });
    updateEqLabels();
    setEqAvailable(location.protocol !== "file:" && !!(window.AudioContext || window.webkitAudioContext));

    setShuffle(recall("gbr:shuffle") !== "off");

    if (el.volume) {
      var savedVolume = Number(recall("gbr:volume"));
      if (isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1) el.volume.value = savedVolume;
      audio.volume = Number(el.volume.value) || 0.9;
      fillRange(el.volume);
      el.volume.addEventListener("input", function () {
        audio.volume = Number(el.volume.value) || 0;
        fillRange(el.volume);
        remember("gbr:volume", String(audio.volume));
      });
    }

    if (el.back) el.back.addEventListener("click", function () { advance(-1); });
    if (el.skip) el.skip.addEventListener("click", function () { advance(1); });
    if (el.play) el.play.addEventListener("click", function () {
      if (!current) {
        var track = shuffleMode ? randomTrack() : trackAt(pickupIndex());
        if (track) engage(track, true, shuffleMode);
        return;
      }
      if (audio.paused) startPlayback(); else audio.pause();
    });
    if (el.shuffle) el.shuffle.addEventListener("click", function () {
      setShuffle(!shuffleMode);
      if (!current) {
        var track = randomTrack();
        if (track) engage(track, true, true);
      }
    });

    /* Scrubbing. v6 let `timeupdate` write the slider mid-drag, so the thumb
       fought the pointer. The drag now owns the value until release. */
    if (el.progress) {
      var scrubbing = false;
      el.progress.addEventListener("pointerdown", function () { scrubbing = true; });
      el.progress.addEventListener("input", function () {
        fillRange(el.progress);
        if (el.elapsed) el.elapsed.textContent = clock(Number(el.progress.value));
      });
      el.progress.addEventListener("change", function () {
        scrubbing = false;
        var t = Number(el.progress.value) || 0;
        try { audio.currentTime = t; } catch (_) {}
        paintLyric(t);
      });
      ["pointerup", "pointercancel"].forEach(function (type) {
        el.progress.addEventListener(type, function () { scrubbing = false; });
      });
      el.progress._isScrubbing = function () { return scrubbing; };
    }

    if (el.lossless) el.lossless.addEventListener("change", function () {
      remember("gbr:lossless", el.lossless.checked ? "on" : "off");
      if (!current) return;
      var at = audio.currentTime || 0, wasPlaying = !audio.paused;
      if (!setSource(current)) return;
      audio.addEventListener("loadedmetadata", function () {
        try { audio.currentTime = Math.min(at, audio.duration || at); } catch (_) {}
        if (wasPlaying) startPlayback();
      }, { once: true });
    });

    if (el.eqToggle) el.eqToggle.addEventListener("click", function () { togglePopup(el.eqPopover, el.eqToggle); });
    if (el.eqClose) el.eqClose.addEventListener("click", function () { closePopup(el.eqPopover, el.eqToggle); });
    if (el.eqPopover) el.eqPopover.addEventListener("click", function (e) {
      if (e.target === el.eqPopover) closePopup(el.eqPopover, el.eqToggle);
    });
    if (el.eqFlat) el.eqFlat.addEventListener("click", function () {
      eqInputs.forEach(function (i) { i.value = 0; });
      buildGraph();
      applyEq();
    });
    if (el.techToggle) el.techToggle.addEventListener("click", function () { togglePopup(el.techPanel, el.techToggle); });
    if (el.techClose) el.techClose.addEventListener("click", function () { closePopup(el.techPanel, el.techToggle); });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (folders.root && folders.root.dataset.open) { closeFolders(true); return; }
        closePopup(el.eqPopover, el.eqToggle);
        closePopup(el.techPanel, el.techToggle);
        return;
      }
      var tag = (event.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (folders.root && folders.root.dataset.open) return;
      if (event.key === " ") { event.preventDefault(); if (el.play) el.play.click(); }
    });

    /* Audio element */
    audio.addEventListener("play", function () {
      resumeGraph();
      startMeters();
      setPlayIcon(true);
      setStatus("Playing", "live");
    });
    audio.addEventListener("pause", function () {
      setPlayIcon(false);
      if (!audio.ended) setStatus("Paused");
      meters.channels.forEach(function (ch) { ch.target = 0; });
      startMeters();
    });
    audio.addEventListener("loadedmetadata", function () {
      if (el.total) el.total.textContent = clock(audio.duration);
      if (el.progress && isFinite(audio.duration)) { el.progress.max = audio.duration; fillRange(el.progress); }
    });
    audio.addEventListener("timeupdate", function () {
      if (el.progress && !el.progress._isScrubbing()) {
        if (isFinite(audio.duration)) el.progress.max = audio.duration;
        el.progress.value = audio.currentTime || 0;
        fillRange(el.progress);
        if (el.elapsed) el.elapsed.textContent = clock(audio.currentTime);
      }
      paintLyric(audio.currentTime || 0);
    });
    audio.addEventListener("ended", function () { advance(1); });
    audio.addEventListener("error", function () { setStatus("Audio error", "fault"); });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopMeters();
      else if (!audio.paused) startMeters();
      else restMeters();
    });

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { meters.face = null; restMeters(); });
      if (el.vu) ro.observe(el.vu);
      if (el.spectrum) ro.observe(el.spectrum);
    }

    /* Deep link, else park on the pickup card. */
    var wanted = null;
    try {
      var q = new URLSearchParams(location.search).get("track");
      if (q) wanted = catalogue.find(function (t) { return t.slug === q || t.id === q; });
    } catch (_) {}

    paintPlate(wanted || null);

    if (wanted) {
      var index = indexOfTrack(wanted);
      if (index >= 0) glideTo(index, { duration: 0 }, null);
      latch(wanted, false);
    } else {
      setStatus(mag.cards.length ? "Ready" : "No cassettes");
      if (!mag.cards.length && el.title) el.title.textContent = "No cassettes staged";
    }
  }

  var PLAY_PATH = "M8 5v14l11-7z";
  var PAUSE_PATH = "M6 5h4v14H6zM14 5h4v14h-4z";
  function setPlayIcon(playing) {
    if (!el.play) return;
    var path = el.play.querySelector("path");
    if (path) path.setAttribute("d", playing ? PAUSE_PATH : PLAY_PATH);
    el.play.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
