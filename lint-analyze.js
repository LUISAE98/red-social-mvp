const rl = require('readline').createInterface({ input: process.stdin });
const files = {};
rl.on('line', l => {
  const m = l.match(/^(c:.*?\.(tsx?|ts))\s+(\d+)/i);
  if (m) {
    const parts = m[1].split('red-social-mvp');
    const k = parts[1] || m[1];
    files[k] = (files[k] || 0) + 1;
  }
});
rl.on('close', () => {
  Object.entries(files).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(n, f));
});
