/*
 * Navegación espacial para D-pad. Recibe rectángulos (getBoundingClientRect)
 * y devuelve el índice del destino. No envuelve: en el borde se queda.
 */
(function (root) {
  function pick(rects, fromIndex, dir) {
    if (!rects || !rects.length) return -1;
    if (fromIndex < 0 || fromIndex >= rects.length) return 0;
    var from = rects[fromIndex];
    var fx = from.left + from.width / 2;
    var fy = from.top + from.height / 2;
    var best = -1;
    var bestScore = 1e15;
    var i;
    for (i = 0; i < rects.length; i++) {
      if (i === fromIndex) continue;
      var r = rects[i];
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = cx - fx;
      var dy = cy - fy;
      var primary;
      var secondary;
      if (dir === 'left') {
        if (dx >= -1) continue;
        primary = -dx;
        secondary = Math.abs(dy);
      } else if (dir === 'right') {
        if (dx <= 1) continue;
        primary = dx;
        secondary = Math.abs(dy);
      } else if (dir === 'up') {
        if (dy >= -1) continue;
        primary = -dy;
        secondary = Math.abs(dx);
      } else if (dir === 'down') {
        if (dy <= 1) continue;
        primary = dy;
        secondary = Math.abs(dx);
      } else {
        continue;
      }
      if (secondary > primary * 1.15 + 36) continue;
      var score = primary + secondary * 4;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  var api = { pick: pick };
  root.LauncherNav = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
