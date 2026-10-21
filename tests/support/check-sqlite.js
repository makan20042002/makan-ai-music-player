const cp = require('child_process');
try {
  const out = cp.execSync('npx electron -e "try { const s = require(\x27node:sqlite\x27); console.log(\x27SQLITE_OK:\x27, typeof s.DatabaseSync); } catch(e) { console.log(\x27SQLITE_ERR:\x27, e.message); }"', {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }).toString();
  console.log('Result:', out);
} catch (err) {
  console.error('Error running electron:', err);
}
