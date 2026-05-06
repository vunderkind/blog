// Example plugin: renders a tiny animated force-directed graph in <canvas>.
// Use in a post by inserting an HTML card with:
//   <div data-plugin="graph" data-nodes="24" data-height="320"></div>
//
// A plugin is a single ES module that default-exports { init(el, opts) }.
// Keep plugins self-contained: no external deps unless you import() them here.

export default {
  init(el, opts = {}) {
    const N = +opts.nodes || 20;
    const H = +opts.height || 280;
    const canvas = document.createElement('canvas');
    const dpr = devicePixelRatio || 1;
    const resize = () => {
      const w = el.clientWidth || 600;
      canvas.width = w * dpr; canvas.height = H * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = H + 'px';
    };
    el.replaceChildren(canvas);
    resize();
    addEventListener('resize', resize);

    const ctx = canvas.getContext('2d');
    const nodes = Array.from({ length: N }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3,
    }));

    const tick = () => {
      ctx.fillStyle = '#fafaf7'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
      }
      ctx.strokeStyle = 'rgba(17,17,17,.15)';
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 120 * dpr) {
            ctx.globalAlpha = 1 - d / (120 * dpr);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#111';
      for (const n of nodes) { ctx.beginPath(); ctx.arc(n.x, n.y, 2.5 * dpr, 0, 7); ctx.fill(); }
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);

    // Clean up when removed from DOM
    new MutationObserver(() => { if (!el.isConnected) cancelAnimationFrame(raf); })
      .observe(document.body, { childList: true, subtree: true });
  }
};
