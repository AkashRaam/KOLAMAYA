/* ============================================================================
 * Kolamaya Kolam — vision engine (image processing, half-completion, analyzer)
 * Depends on KolamCore for the tile library & reflection maps.
 * Works on raw ImageData so it runs in the browser (canvas) and can be
 * unit-tested in Node with synthetic masks.
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.KolamVision = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CORE = null;
  function setCore(c) { CORE = c; }
  function core() {
    if (CORE) return CORE;
    if (typeof window !== "undefined" && window.KolamCore) return window.KolamCore;
    throw new Error("KolamVision: KolamCore not available — call setCore() first.");
  }

  /* ================= image helpers ================= */

  /** Estimate the background colour from the border pixels (per-channel median). */
  function medianBorderColor(imgData) {
    var w = imgData.width, h = imgData.height, d = imgData.data;
    var rs = [], gs = [], bs = [];
    function sample(x, y) {
      var i = (y * w + x) * 4;
      rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
    }
    var step = 1;
    for (var x = 0; x < w; x += step) { sample(x, 0); sample(x, h - 1); }
    for (var y = 0; y < h; y += step) { sample(0, y); sample(w - 1, y); }
    if (rs.length > 400) { // subsample very large borders
      var kept = [];
      for (var k = 0; k < rs.length; k += Math.ceil(rs.length / 400)) kept.push(k);
      rs = kept.map(function (i) { return rs[i]; });
      gs = kept.map(function (i) { return gs[i]; });
      bs = kept.map(function (i) { return bs[i]; });
    }
    function median(a) {
      a.sort(function (x, y) { return x - y; });
      return a[Math.floor(a.length / 2)];
    }
    return [median(rs), median(gs), median(bs)];
  }

  /**
   * Binarize an image into an ink mask (1 = foreground stroke/dot).
   * Handles both dark-on-light and light-on-dark kolams by comparing every
   * pixel against the border/background colour.
   */
  function computeInkMask(imgData, opts) {
    opts = opts || {};
    var w = imgData.width, h = imgData.height, d = imgData.data;
    var bg = opts.bg || medianBorderColor(imgData);
    var thr = opts.threshold || 60; // per-channel difference
    var mask = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var j = i * 4;
      var dr = Math.abs(d[j] - bg[0]);
      var dg = Math.abs(d[j + 1] - bg[1]);
      var db = Math.abs(d[j + 2] - bg[2]);
      mask[i] = (dr > thr || dg > thr || db > thr) ? 1 : 0;
    }
    return { w: w, h: h, mask: mask, bg: bg };
  }

  /** Downsample a mask (nearest) for fast analysis; returns scale factor. */
  function downscale(mask, w, h, maxDim) {
    if (Math.max(w, h) <= maxDim) return { w: w, h: h, mask: mask, scale: 1 };
    var scale = maxDim / Math.max(w, h);
    var nw = Math.max(2, Math.round(w * scale));
    var nh = Math.max(2, Math.round(h * scale));
    var out = new Uint8Array(nw * nh);
    for (var y = 0; y < nh; y++) {
      var sy = Math.min(h - 1, Math.floor(y / scale));
      for (var x = 0; x < nw; x++) {
        var sx = Math.min(w - 1, Math.floor(x / scale));
        out[y * nw + x] = mask[sy * w + sx];
      }
    }
    return { w: nw, h: nh, mask: out, scale: scale };
  }

  function inkFraction(mask) {
    var n = 0;
    for (var i = 0; i < mask.length; i++) n += mask[i];
    return n / mask.length;
  }

  /* ================= symmetry ================= */

  /** Dilation (Manhattan-radius r) of a binary mask. */
  function dilateMask(mask, w, h, r) {
    var out = new Uint8Array(mask.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        var y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
        var x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        for (var yy = y0; yy <= y1; yy++)
          for (var xx = x0; xx <= x1; xx++)
            out[yy * w + xx] = 1;
      }
    }
    return out;
  }

  /**
   * Symmetry score (0..1) between the ink mask and its reflection.
   * Uses a dilated (fuzzy) mask and searches a small axis offset so thin
   * strokes aren't penalised for half-pixel alignment differences.
   */
  function symIoU(mask, w, h, mode) {
    var md = dilateMask(mask, w, h, 2);
    var best = 0;
    var offsets = mode === "r180" ? [0] : [-3, -2, -1, 0, 1, 2, 3];
    for (var oi = 0; oi < offsets.length; oi++) {
      var off = offsets[oi];
      var inter = 0, union = 0;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var x2, y2;
          if (mode === "h") { x2 = x; y2 = h - 1 - y + off; }
          else if (mode === "v") { x2 = w - 1 - x + off; y2 = y; }
          else { x2 = w - 1 - x; y2 = h - 1 - y; }
          if (x2 < 0 || x2 >= w || y2 < 0 || y2 >= h) continue;
          var a = md[y * w + x];
          var b = md[y2 * w + x2];
          if (a || b) union++;
          if (a && b) inter++;
        }
      }
      if (union && inter / union > best) best = inter / union;
    }
    return best;
  }

  /* ================= dot / grid detection ================= */

  /** First significant peak of the normalized autocorrelation of a 1-D signal. */
  function autocorrPeak(sig, minK, maxK) {
    var n = sig.length;
    var mean = 0;
    for (var i = 0; i < n; i++) mean += sig[i];
    mean /= n;
    var denom = 0;
    for (var j = 0; j < n; j++) { var dd = sig[j] - mean; denom += dd * dd; }
    if (denom < 1e-6) return 0;
    maxK = Math.min(maxK, n - 2);
    var bestK = 0, bestVal = -1;
    for (var k = minK; k <= maxK; k++) {
      var num = 0;
      for (var i2 = 0; i2 < n - k; i2++) num += (sig[i2] - mean) * (sig[i2 + k] - mean);
      var v = num / denom;
      if (v > bestVal) { bestVal = v; bestK = k; }
    }
    return bestVal > 0.25 ? bestK : 0;
  }

  /** Local maxima with minimum separation & relative threshold, sorted by strength. */
  function localMaxima(sig, minDist, relThr) {
    var max = 0;
    for (var i = 0; i < sig.length; i++) if (sig[i] > max) max = sig[i];
    if (max <= 0) return [];
    var thr = relThr * max;
    var peaks = [];
    for (var j = 0; j < sig.length; j++) {
      if (sig[j] < thr) continue;
      var left = j > 0 ? sig[j - 1] : 0;
      var right = j < sig.length - 1 ? sig[j + 1] : 0;
      if (sig[j] >= left && sig[j] >= right) peaks.push({ p: j, v: sig[j] });
    }
    peaks.sort(function (a, b) { return b.v - a.v; });
    var kept = [];
    for (var k = 0; k < peaks.length; k++) {
      var ok = true;
      for (var m = 0; m < kept.length; m++) {
        if (Math.abs(peaks[k].p - kept[m].p) < minDist) { ok = false; break; }
      }
      if (ok) kept.push(peaks[k].p);
    }
    kept.sort(function (a, b) { return a - b; });
    return kept;
  }

  /** Cluster 1-D positions into groups within a tolerance. Returns sorted means. */
  function cluster1D(values, tol) {
    if (!values.length) return [];
    var v = values.slice().sort(function (a, b) { return a - b; });
    var groups = [[v[0]]];
    for (var i = 1; i < v.length; i++) {
      if (v[i] - groups[groups.length - 1][groups[groups.length - 1].length - 1] <= tol) {
        groups[groups.length - 1].push(v[i]);
      } else {
        groups.push([v[i]]);
      }
    }
    return groups.map(function (g) {
      var s = 0; for (var k = 0; k < g.length; k++) s += g[k];
      return s / g.length;
    });
  }

  /** Median of adjacent gaps. */
  function medianGap(seq) {
    if (seq.length < 2) return 0;
    var gaps = [];
    for (var i = 1; i < seq.length; i++) gaps.push(seq[i] - seq[i - 1]);
    gaps.sort(function (a, b) { return a - b; });
    return gaps[Math.floor(gaps.length / 2)];
  }

  /**
   * Detect the dot lattice of a kolam.
   * Returns { detected, rows, cols, spacing, dotCount, regularity } in the
   * mask's own coordinate space.
   */
  function detectLattice(mask, w, h) {
    // Row / column ink sums → autocorrelation gives the dot spacing.
    var rowSum = new Float64Array(h);
    var colSum = new Float64Array(w);
    for (var y = 0; y < h; y++) {
      var s = 0;
      for (var x = 0; x < w; x++) s += mask[y * w + x];
      rowSum[y] = s;
    }
    for (var x = 0; x < w; x++) {
      var s2 = 0;
      for (var y2 = 0; y2 < h; y2++) s2 += mask[y2 * w + x];
      colSum[x] = s2;
    }
    var spR = autocorrPeak(rowSum, 4, Math.floor(h / 2));
    var spC = autocorrPeak(colSum, 4, Math.floor(w / 2));
    var spacing = 0;
    if (spR && spC) spacing = Math.round((spR + spC) / 2);
    else spacing = spR || spC || 0;

    var minDist = spacing || Math.max(4, Math.round(Math.min(w, h) / 18));

    // Dot centers: local maxima of local ink density (dots are solid blobs).
    var radii = [2, 3, 4];
    var centers = [];
    var intImg = buildIntegral(mask, w, h);
    for (var y3 = 0; y3 < h; y3++) {
      for (var x3 = 0; x3 < w; x3++) {
        if (!mask[y3 * w + x3]) continue;
        var bestD = 0;
        for (var ri = 0; ri < radii.length; ri++) {
          var d = density(intImg, w, h, x3, y3, radii[ri]);
          if (d > bestD) { bestD = d; }
        }
        if (bestD > 0.55) centers.push({ x: x3, y: y3, d: bestD });
      }
    }
    // Suppress non-maxima within the min distance.
    var dots = [];
    centers.sort(function (a, b) { return b.d - a.d; });
    for (var c = 0; c < centers.length; c++) {
      var ok = true;
      for (var m = 0; m < dots.length; m++) {
        var dx = centers[c].x - dots[m].x, dy = centers[c].y - dots[m].y;
        if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
      }
      if (ok) dots.push(centers[c]);
    }

    if (dots.length < 4) {
      return { detected: false, rows: [], cols: [], spacing: spacing || 0, dotCount: dots.length, regularity: 0, dots: dots };
    }

    var tol = Math.max(2, minDist * 0.35);
    var rows = cluster1D(dots.map(function (d) { return d.y; }), tol);
    var cols = cluster1D(dots.map(function (d) { return d.x; }), tol);

    var spRows = medianGap(rows);
    var spCols = medianGap(cols);
    var spacing2 = Math.round((spRows + spCols) / 2) || spacing || minDist;

    // Regularity = how evenly spaced the dot rows/cols are.
    var resRows = gapResidual(rows), resCols = gapResidual(cols);
    var regularity = Math.max(0, Math.min(100, 100 - ((resRows + resCols) / 2)));

    return {
      detected: rows.length >= 2 && cols.length >= 2,
      rows: rows, cols: cols,
      spacing: spacing2,
      dotCount: dots.length,
      regularity: regularity,
      dots: dots
    };
  }

  function buildIntegral(mask, w, h) {
    var s = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      var rowOff = y * w;
      for (var x = 0; x < w; x++) {
        s[(y + 1) * (w + 1) + (x + 1)] =
          mask[rowOff + x] +
          s[y * (w + 1) + (x + 1)] +
          s[(y + 1) * (w + 1) + x] -
          s[y * (w + 1) + x];
      }
    }
    return s;
  }
  function density(intImg, w, h, cx, cy, r) {
    var x0 = Math.max(0, cx - r), x1 = Math.min(w - 1, cx + r);
    var y0 = Math.max(0, cy - r), y1 = Math.min(h - 1, cy + r);
    var sum = intImg[(y1 + 1) * (w + 1) + (x1 + 1)] - intImg[y0 * (w + 1) + (x1 + 1)] -
      intImg[(y1 + 1) * (w + 1) + x0] + intImg[y0 * (w + 1) + x0];
    var area = (x1 - x0 + 1) * (y1 - y0 + 1);
    return sum / area;
  }
  function gapResidual(seq) {
    if (seq.length < 2) return 0;
    var gaps = [];
    for (var i = 1; i < seq.length; i++) gaps.push(seq[i] - seq[i - 1]);
    var mean = 0;
    for (var j = 0; j < gaps.length; j++) mean += gaps[j];
    mean /= gaps.length;
    if (mean <= 0) return 0;
    var dev = 0;
    for (var k = 0; k < gaps.length; k++) dev += Math.abs(gaps[k] - mean);
    dev /= gaps.length;
    return 100 * dev / mean;
  }

  /* ================= tile templates & matching ================= */

  var TEMPLATES = null;
  var TEMPLATE_N = 32;

  function stampDisk(arr, N, cx, cy, r) {
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(N - 1, Math.ceil(cy + r));
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r) arr[y * N + x] = 1;
      }
    }
  }
  function stampLine(arr, N, x1, y1, x2, y2, r) {
    var dx = x2 - x1, dy = y2 - y1;
    var steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      stampDisk(arr, N, x1 + dx * t, y1 + dy * t, r);
    }
  }

  /** Render a tile (with its centre dot) onto an N×N binary mask. */
  function renderTile(tileId, N) {
    var c = core();
    var t = c.PATTERNS[tileId - 1];
    var arr = new Uint8Array(N * N);
    stampDisk(arr, N, N / 2, N / 2, N * 0.055); // the dot
    var r = Math.max(0.6, N * 0.018);
    for (var i = 1; i < t.points.length; i++) {
      var p1 = t.points[i - 1], p2 = t.points[i];
      stampLine(arr, N, (p1.x + 0.5) * N, (p1.y + 0.5) * N, (p2.x + 0.5) * N, (p2.y + 0.5) * N, r);
    }
    return arr;
  }

  function buildTemplates(N) {
    if (TEMPLATES && TEMPLATE_N === N) return TEMPLATES;
    var c = core();
    var ts = [];
    for (var i = 0; i < c.PATTERNS.length; i++) ts.push(renderTile(c.PATTERNS[i].id, N));
    TEMPLATES = ts;
    TEMPLATE_N = N;
    return ts;
  }

  function dilate(mask, N, r) {
    var out = new Uint8Array(N * N);
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        if (!mask[y * N + x]) continue;
        for (var dy = -r; dy <= r; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r) continue;
            var nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < N && ny >= 0 && ny < N) out[ny * N + nx] = 1;
          }
        }
      }
    }
    return out;
  }

  /** Soft (fuzzy) IoU — tolerant of a pixel or two of misalignment. */
  function softIoU(a, b, N) {
    var aN = 0, bN = 0;
    for (var i = 0; i < N * N; i++) { aN += a[i]; bN += b[i]; }
    if (!aN || !bN) return 0;
    var aD = dilate(a, N, 2), bD = dilate(b, N, 2);
    var recall = 0, prec = 0;
    for (var j = 0; j < N * N; j++) {
      if (a[j] && bD[j]) recall++;
      if (b[j] && aD[j]) prec++;
    }
    recall /= aN; prec /= bN;
    if (!recall && !prec) return 0;
    return (2 * recall * prec) / (recall + prec);
  }

  /** Extract an N×N ink sample centred on (cx, cy) with window `size`. */
  function extractCell(mask, w, h, cx, cy, size, N) {
    var out = new Uint8Array(N * N);
    var half = size / 2;
    for (var y = 0; y < N; y++) {
      var sy = cy - half + (y + 0.5) * (size / N);
      var iy = Math.round(sy);
      if (iy < 0 || iy >= h) continue;
      for (var x = 0; x < N; x++) {
        var sx = cx - half + (x + 0.5) * (size / N);
        var ix = Math.round(sx);
        if (ix < 0 || ix >= w) continue;
        out[y * N + x] = mask[iy * w + ix];
      }
    }
    return out;
  }

  /** Match the extracted cell against the tile library; returns best id + conf. */
  function matchCell(sample, N) {
    var ts = buildTemplates(N);
    var best = 1, bestC = -1;
    for (var i = 0; i < ts.length; i++) {
      var c = softIoU(sample, ts[i], N);
      if (c > bestC) { bestC = c; best = i + 1; }
    }
    return { id: best, conf: bestC };
  }

  /* ================= full analysis ================= */

  function analyzeImage(imgData, opts) {
    var full = computeInkMask(imgData, opts);
    var ds = downscale(full.mask, full.w, full.h, opts && opts.maxDim ? opts.maxDim : 360);
    var m = ds.mask, w = ds.w, h = ds.h;

    var cov = inkFraction(m);
    // Symmetry is measured at higher resolution for stroke-level fidelity.
    var symMask = full.mask, symW = full.w, symHt = full.h;
    if (Math.max(symW, symHt) > 800) {
      var d2 = downscale(full.mask, full.w, full.h, 800);
      symMask = d2.mask; symW = d2.w; symHt = d2.h;
    }
    var symH = symIoU(symMask, symW, symHt, "h");
    var symV = symIoU(symMask, symW, symHt, "v");
    var symR = symIoU(symMask, symW, symHt, "r180");
    var best = Math.max(symH, symV, symR);

    var lattice = detectLattice(m, w, h);

    var tiles = null;
    if (lattice.detected) {
      tiles = recognizeTiles(m, w, h, lattice);
    }

    var tileConf = tiles ? tiles.avgConf : 0;
    var dotScore = lattice.detected ? 100 : 0;
    var accuracy = Math.round(
      0.35 * (best * 100) +
      0.35 * (tileConf * 100) +
      0.20 * (lattice.regularity) +
      0.10 * (dotScore)
    );

    return {
      width: full.w, height: full.h,
      scale: ds.scale,
      inkFraction: cov,
      symmetry: {
        horizontal: symH * 100,
        vertical: symV * 100,
        rotational: symR * 100,
        best: best * 100
      },
      lattice: {
        detected: lattice.detected,
        rows: lattice.rows.length,
        cols: lattice.cols.length,
        spacing: lattice.spacing / ds.scale,
        dotCount: lattice.dotCount,
        regularity: lattice.regularity,
        dots: lattice.dots.map(function (d) { return { x: d.x / ds.scale, y: d.y / ds.scale }; }),
        rowsAt: lattice.rows.map(function (v) { return v / ds.scale; }),
        colsAt: lattice.cols.map(function (v) { return v / ds.scale; })
      },
      tiles: tiles,
      accuracy: Math.max(0, Math.min(100, accuracy))
    };
  }

  function recognizeTiles(m, w, h, lattice) {
    var N = TEMPLATE_N;
    var size = lattice.spacing;
    var matrix = [], confs = [], sum = 0, n = 0;
    for (var ri = 0; ri < lattice.rows.length; ri++) {
      var row = [], crow = [];
      for (var ci = 0; ci < lattice.cols.length; ci++) {
        var sample = extractCell(m, w, h, lattice.cols[ci], lattice.rows[ri], size, N);
        var mc = matchCell(sample, N);
        row.push(mc.id);
        crow.push(Math.round(mc.conf * 100) / 100);
        sum += mc.conf; n++;
      }
      matrix.push(row);
      confs.push(crow);
    }
    var dist = {};
    for (var i = 0; i < matrix.length; i++)
      for (var j = 0; j < matrix[i].length; j++)
        dist[matrix[i][j]] = (dist[matrix[i][j]] || 0) + 1;
    return {
      avgConf: n ? sum / n : 0,
      matrix: matrix,
      confs: confs,
      distribution: dist,
      cellCount: n
    };
  }

  /* ================= half completion ================= */

  function inkSideCounts(mask, w, h) {
    var left = 0, right = 0, top = 0, bottom = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (x < w / 2) left++; else right++;
        if (y < h / 2) top++; else bottom++;
      }
    }
    return { left: left, right: right, top: top, bottom: bottom };
  }

  /** Pick the completion axis automatically from where the ink sits. */
  function autoAxis(mask, w, h) {
    var s = inkSideCounts(mask, w, h);
    var total = s.left + s.right;
    if (total === 0) return "vcenter";
    if (s.left < total * 0.05) return "vcenter";     // ink on the right → mirror to the left
    if (s.right < total * 0.05) return "vcenter";    // ink on the left → mirror to the right
    // ink occupies both halves → likely a half-crop against one edge
    var vt = s.top + s.bottom;
    if (vt === 0) return "hcenter";
    if (s.top < vt * 0.05) return "hcenter";
    if (s.bottom < vt * 0.05) return "hcenter";
    // fall back: extend to the right
    return "extend-right";
  }

  /**
   * Mirror-complete a half kolam. `mode` is one of:
   * auto | vcenter | hcenter | extend-right | extend-left | extend-down | extend-up
   * Returns a new RGBA buffer + dimensions (in original resolution).
   */
  function completeHalf(imgData, mode) {
    var w = imgData.width, h = imgData.height, d = imgData.data;
    var mk = computeInkMask(imgData, { threshold: 50 });
    mode = mode || "auto";
    if (mode === "auto") mode = autoAxis(mk.mask, w, h);

    var out, nw = w, nh = h;
    if (mode === "extend-right" || mode === "extend-left") nw = w * 2;
    else if (mode === "extend-down" || mode === "extend-up") nh = h * 2;
    out = new Uint8ClampedArray(nw * nh * 4);

    function copyPixel(sx, sy, dx, dy) {
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;
      var si = (sy * w + sx) * 4, di = (dy * nw + dx) * 4;
      out[di] = d[si]; out[di + 1] = d[si + 1]; out[di + 2] = d[si + 2]; out[di + 3] = 255;
    }

    if (mode === "vcenter") {
      // mirror the inked half into the empty half
      var s = inkSideCounts(mk.mask, w, h);
      var inkRight = s.right > s.left;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          copyPixel(x, y, x, y); // keep the original
          var mirroredX = w - 1 - x;
          var fillsLeftHalf = inkRight && x < w / 2;
          var fillsRightHalf = !inkRight && x >= w / 2;
          if (fillsLeftHalf || fillsRightHalf) copyPixel(mirroredX, y, x, y);
        }
      }
    } else if (mode === "hcenter") {
      var s2 = inkSideCounts(mk.mask, w, h);
      var inkBottom = s2.bottom > s2.top;
      for (var y2 = 0; y2 < h; y2++) {
        for (var x2 = 0; x2 < w; x2++) {
          copyPixel(x2, y2, x2, y2);
          var sy = h - 1 - y2;
          if (inkBottom ? y2 < h / 2 : y2 >= h / 2) copyPixel(x2, sy, x2, y2);
        }
      }
    } else if (mode === "extend-right") {
      for (var y3 = 0; y3 < h; y3++) {
        for (var x3 = 0; x3 < nw; x3++) {
          var sx3 = x3 < w ? x3 : (2 * w - 1 - x3); // mirror about x = w - 0.5
          copyPixel(sx3, y3, x3, y3);
        }
      }
    } else if (mode === "extend-left") {
      for (var y4 = 0; y4 < h; y4++) {
        for (var x4 = 0; x4 < nw; x4++) {
          var sx4 = x4 < w ? (w - 1 - x4) : (x4 - w);
          copyPixel(sx4, y4, x4, y4);
        }
      }
    } else if (mode === "extend-down") {
      for (var y5 = 0; y5 < nh; y5++) {
        var sy5 = y5 < h ? y5 : (2 * h - 1 - y5);
        for (var x5 = 0; x5 < w; x5++) copyPixel(x5, sy5, x5, y5);
      }
    } else if (mode === "extend-up") {
      for (var y6 = 0; y6 < nh; y6++) {
        var sy6 = y6 < h ? (h - 1 - y6) : (y6 - h);
        for (var x6 = 0; x6 < w; x6++) copyPixel(x6, sy6, x6, y6);
      }
    }

    return { width: nw, height: nh, data: out, mode: mode };
  }

  /**
   * Clean regeneration: detect the curve tiles on the drawn half, mirror them
   * with the generator's reflection maps, and return a vector pattern.
   * Returns { pattern, info } or null when the grid cannot be detected.
   */
  function regenerateFromHalf(imgData, mode) {
    var c = core();
    var mk = computeInkMask(imgData, { threshold: 50 });
    mode = mode || "auto";
    if (mode === "auto") mode = autoAxis(mk.mask, mk.w, mk.h);
    var ds = downscale(mk.mask, mk.w, mk.h, 360);
    var lattice = detectLattice(ds.mask, ds.w, ds.h);
    if (!lattice.detected) return null;

    var vertical = (mode === "hcenter" || mode === "extend-down" || mode === "extend-up");
    var rows = lattice.rows, cols = regularizeColumns(lattice, ds.mask, ds.w, ds.h);
    if (!rows.length || !cols.length) return null;

    // Build the tile matrix for the drawn half.
    var spacing = lattice.spacing;
    var H = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var row = [];
      for (var ci = 0; ci < cols.length; ci++) {
        var sample = extractCell(ds.mask, ds.w, ds.h, cols[ci], rows[ri], spacing, TEMPLATE_N);
        row.push(matchCell(sample, TEMPLATE_N).id);
      }
      H.push(row);
    }

    // Detect whether the axis passes through a centre column/row (odd grid):
    // the outermost detected line then lies on the axis and must not be doubled.
    var hasCenter = false;
    if (vertical) {
      var edge = (mode === "extend-down" || mode === "extend-up") ? ds.h : ds.h / 2;
      // (edge detection for vertical stacking is on rows)
      var last = rows[rows.length - 1], first = rows[0];
      if (Math.abs(last - edge) < spacing * 0.5) hasCenter = true;
    } else {
      var edgeX = (mode === "extend-right" || mode === "extend-left") ? ds.w : ds.w / 2;
      var lastC = cols[cols.length - 1], firstC = cols[0];
      if (Math.abs(lastC - edgeX) < spacing * 0.5 || Math.abs(firstC - edgeX) < spacing * 0.5) hasCenter = true;
    }

    var full;
    if (vertical) {
      // reflect rows vertically with v_inv
      function vRefRow(row) { return row.map(function (id) { return c.v_inv[id - 1]; }); }
      var bodyRows = hasCenter ? H.slice(0, H.length - 1) : H;
      var reflected = [];
      for (var i = bodyRows.length - 1; i >= 0; i--) reflected.push(vRefRow(bodyRows[i]));
      full = (mode === "extend-up") ? reflected.concat(H) : H.concat(reflected);
    } else {
      // reflect columns horizontally with h_inv
      function hRefRow(row) {
        var r2 = [];
        for (var k = row.length - 1; k >= 0; k--) r2.push(c.h_inv[row[k] - 1]);
        return r2;
      }
      full = [];
      var R2 = H.length;
      for (var r3 = 0; r3 < R2; r3++) {
        var body = hasCenter ? H[r3].slice(0, H[r3].length - 1) : H[r3];
        var mirrored = hRefRow(body);
        if (mode === "extend-left") full.push(mirrored.concat(H[r3]));
        else full.push(H[r3].concat(mirrored));
      }
    }

    var pattern = c.drawKolam(full);
    return {
      pattern: pattern,
      info: {
        grid: full.length + "\u00d7" + full[0].length,
        avgConf: Math.round(recognizeTiles(ds.mask, ds.w, ds.h, lattice).avgConf * 100),
        axis: mode
      }
    };
  }

  /** Keep only columns that fall on a regular lattice anchored at the densest column. */
  function regularizeColumns(lattice, mask, w, h) {
    var cols = lattice.cols, spacing = lattice.spacing;
    if (!spacing || cols.length < 2) return cols;
    // count dots per column
    var counts = cols.map(function () { return 0; });
    lattice.dots.forEach(function (d) {
      var bi = 0, bd = 1e9;
      for (var i = 0; i < cols.length; i++) {
        var dd = Math.abs(d.x - cols[i]);
        if (dd < bd) { bd = dd; bi = i; }
      }
      if (bd < spacing * 0.6) counts[bi]++;
    });
    var anchor = cols[counts.indexOf(Math.max.apply(null, counts))];
    // walk the lattice in both directions
    var out = [];
    for (var dir = -1; dir <= 1; dir += 2) {
      var k = dir;
      while (true) {
        var cpos = anchor + k * spacing;
        if (cpos < spacing * 0.4 || cpos > w - spacing * 0.4) break;
        // only accept if there is actually ink (a dot or curve) near that column
        var hasInk = false;
        var x0 = Math.max(0, Math.round(cpos - spacing * 0.25)), x1 = Math.min(w - 1, Math.round(cpos + spacing * 0.25));
        for (var y = 0; y < h && !hasInk; y++)
          for (var x = x0; x <= x1; x++) if (mask[y * w + x]) { hasInk = true; break; }
        if (hasInk) {
          if (dir < 0) out.unshift(cpos); else out.push(cpos);
        }
        k += dir;
      }
    }
    if (!out.length) return cols;
    if (out.indexOf(anchor) === -1) out.push(anchor);
    out.sort(function (a, b) { return a - b; });
    // include a column on the far edge if ink reaches it (centre-column case)
    var maxC = Math.max.apply(null, out), minC = Math.min.apply(null, out);
    if (maxC + spacing <= w - spacing * 0.3) {
      var candidate = maxC + spacing;
      var hasInk2 = false;
      var xx0 = Math.max(0, Math.round(candidate - spacing * 0.25)), xx1 = Math.min(w - 1, Math.round(candidate + spacing * 0.25));
      for (var y2 = 0; y2 < h && !hasInk2; y2++)
        for (var x2 = xx0; x2 <= xx1; x2++) if (mask[y2 * w + x2]) { hasInk2 = true; break; }
      if (hasInk2) out.push(candidate);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  return {
    setCore: setCore,
    computeInkMask: computeInkMask,
    inkFraction: inkFraction,
    symIoU: symIoU,
    detectLattice: detectLattice,
    analyzeImage: analyzeImage,
    completeHalf: completeHalf,
    regenerateFromHalf: regenerateFromHalf,
    autoAxis: autoAxis
  };
});
