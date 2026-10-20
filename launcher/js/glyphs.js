/* Iconos SVG pequeños, dibujados a mano. Sin imágenes remotas. */
(function (root) {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function frame(color, inner) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" focusable="false" aria-hidden="true">' +
      '<rect x="1" y="1" width="38" height="38" rx="10" fill="' + color + '"/>' + inner + '</svg>';
  }

  var SYMBOLS = {
    youtube: '<polygon points="15,12 15,28 29,20" fill="#ffffff"/>',
    netflix: '<text x="20" y="27" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700" fill="#ffffff">N</text>',
    store: '<path d="M14 17h12v11H14z" fill="none" stroke="#ffffff" stroke-width="2"/>' +
      '<path d="M16 17v-2.2a4 4 0 0 1 8 0V17" fill="none" stroke="#ffffff" stroke-width="2"/>',
    settings: '<rect x="11" y="14" width="18" height="2.2" rx="1" fill="#ffffff"/>' +
      '<circle cx="17" cy="15.1" r="2.4" fill="#ffffff"/>' +
      '<rect x="11" y="23" width="18" height="2.2" rx="1" fill="#ffffff"/>' +
      '<circle cx="24" cy="24.1" r="2.4" fill="#ffffff"/>',
    hb: '<text x="20" y="26" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="700" fill="#ffffff">hb</text>',
    all: '<rect x="11" y="11" width="7" height="7" fill="#ffffff"/>' +
      '<rect x="22" y="11" width="7" height="7" fill="#ffffff"/>' +
      '<rect x="11" y="22" width="7" height="7" fill="#ffffff"/>' +
      '<rect x="22" y="22" width="7" height="7" fill="#ffffff"/>',
    tv: '<rect x="10" y="12" width="20" height="13" rx="2" fill="none" stroke="#ffffff" stroke-width="2"/>' +
      '<rect x="18" y="25" width="4" height="3" fill="#ffffff"/>',
    hdmi: '<rect x="11" y="15" width="18" height="11" rx="2" fill="none" stroke="#ffffff" stroke-width="2"/>' +
      '<rect x="15" y="19" width="3" height="4" fill="#ffffff"/>' +
      '<rect x="21" y="19" width="3" height="4" fill="#ffffff"/>',
    av: '<circle cx="20" cy="20" r="6" fill="none" stroke="#ffffff" stroke-width="2"/>' +
      '<circle cx="20" cy="20" r="2" fill="#ffffff"/>',
    comp: '<rect x="12" y="16" width="4" height="8" fill="#ffffff"/><rect x="18" y="16" width="4" height="8" fill="#ffffff"/><rect x="24" y="16" width="4" height="8" fill="#ffffff"/>',
    scart: '<rect x="11" y="14" width="18" height="12" rx="1" fill="none" stroke="#ffffff" stroke-width="2"/>' +
      '<rect x="15" y="18" width="10" height="2" fill="#ffffff"/>',
    more: '<circle cx="14" cy="20" r="2" fill="#ffffff"/><circle cx="20" cy="20" r="2" fill="#ffffff"/><circle cx="26" cy="20" r="2" fill="#ffffff"/>'
  };

  var PALETTE = ['#8c4a3a', '#3f6f86', '#3f6f55', '#8a6a32', '#6a4a78', '#4a5a8a'];

  function colorForId(id) {
    var n = 0;
    var s = String(id || '');
    var i;
    for (i = 0; i < s.length; i++) n = (n + s.charCodeAt(i) * (i + 1)) % 360;
    return PALETTE[n % PALETTE.length];
  }

  function letter(ch, color) {
    var c = String(ch || '?').charAt(0).toUpperCase();
    return frame(color, '<text x="20" y="27" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="700" fill="#ffffff">' + esc(c) + '</text>');
  }

  function forKey(key, color) {
    var inner = SYMBOLS[key];
    if (!inner) return '';
    return frame(color || '#6a6258', inner);
  }

  function forInput(id, color) {
    if (id === 'TV') return forKey('tv', color);
    if (String(id).indexOf('HDMI_') === 0) return forKey('hdmi', color);
    if (String(id).indexOf('AV') === 0) return forKey('av', color);
    if (String(id).indexOf('COMP') === 0) return forKey('comp', color);
    if (String(id).indexOf('SCART') === 0) return forKey('scart', color);
    return forKey('hdmi', color);
  }

  function forApp(app) {
    var id = app && app.id || '';
    var title = app && app.title || id || '?';
    if (id.indexOf('youtube') === 0) return forKey('youtube', '#c4302b');
    if (id === 'netflix' || id === 'netflix-nrdp') return forKey('netflix', '#b20710');
    return letter(title, colorForId(id));
  }

  var api = {
    forKey: forKey,
    forInput: forInput,
    forApp: forApp,
    colorForId: colorForId
  };

  root.LauncherGlyphs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
