// Dates.gs — pure date helpers. ISO 'YYYY-MM-DD' strings in, out.

var MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

// 'Sep 8, 2026' or '2026-09-08' -> '2026-09-08'; anything else -> ''.
function parseDueDate(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/.exec(s);
  if (!m) return '';
  var mi = MONTHS_.indexOf(m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase());
  if (mi < 0) return '';
  return m[3] + '-' + pad2_(mi + 1) + '-' + pad2_(parseInt(m[2], 10));
}

// '2026-09-08' -> 'Sep 8'; '' -> 'no due date'.
function formatShort(iso) {
  if (!iso) return 'no due date';
  var p = iso.split('-');
  return MONTHS_[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10);
}

// Whole days from isoA to isoB (UTC arithmetic so DST cannot skew it).
function daysBetween(isoA, isoB) {
  var a = isoA.split('-'), b = isoB.split('-');
  var ua = Date.UTC(+a[0], +a[1] - 1, +a[2]);
  var ub = Date.UTC(+b[0], +b[1] - 1, +b[2]);
  return Math.round((ub - ua) / 86400000);
}

// Date (local) or iso string or blank -> iso string.
function toIso(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return v.getFullYear() + '-' + pad2_(v.getMonth() + 1) + '-' + pad2_(v.getDate());
  }
  return parseDueDate(String(v));
}

// iso string -> local Date at midnight, or '' for blank.
function fromIso(iso) {
  if (!iso) return '';
  var p = iso.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function todayIso() { return toIso(new Date()); }
