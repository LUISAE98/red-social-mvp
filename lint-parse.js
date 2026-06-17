const fs = require('fs');
const content = fs.readFileSync('lint-output-v2.txt', 'utf8');
const lines = content.split('\n');
const rule = process.argv[2] || 'no-unused-vars';
const fileErrors = {};
let currentFile = null;

for (const line of lines) {
  const trimmed = line.trim();
  // Match Windows absolute paths (C:\ or c:\)
  if (/^[A-Za-z]:.*\.(tsx?|ts|js|jsx|mjs)$/.test(trimmed)) {
    currentFile = trimmed;
  } else if (currentFile && trimmed.includes(rule)) {
    if (!fileErrors[currentFile]) fileErrors[currentFile] = [];
    fileErrors[currentFile].push(trimmed);
  }
}

const sorted = Object.entries(fileErrors).sort((a, b) => b[1].length - a[1].length);
for (const [file, errors] of sorted) {
  const short = file.split('red-social-mvp').pop() || file;
  console.log('\n--- ' + errors.length + ' --- ' + short);
  errors.forEach(e => {
    const parts = e.trim().split(/\s{2,}/);
    console.log('  ' + parts.slice(0, 3).join('  '));
  });
}
