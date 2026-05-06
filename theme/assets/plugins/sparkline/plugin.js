// Second example plugin: inline SVG sparkline from comma-separated values.
// <span data-plugin="sparkline" data-values="3,5,4,8,6,9,7,12"></span>

export default {
  init(el, opts = {}) {
    const vals = (opts.values || '').split(',').map(Number).filter(n => !isNaN(n));
    if (!vals.length) return;
    const w = +opts.width || 100, h = +opts.height || 22;
    const min = Math.min(...vals), max = Math.max(...vals), r = max - min || 1;
    const pts = vals.map((v, i) =>
      `${(i / (vals.length - 1)) * w},${h - ((v - min) / r) * h}`).join(' ');
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"
      style="vertical-align:middle"><polyline fill="none" stroke="currentColor"
      stroke-width="1.5" points="${pts}"/></svg>`;
  }
};
