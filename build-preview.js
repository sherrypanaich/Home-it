// Makes preview/: the same screen with sample data and no server behind it, to try in any browser.
//   node build-preview.js      then open preview/index.html
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, 'preview');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'art'), { recursive: true });
let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
html = html.replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/g, '').replace('<script src="home.js"></script>', '<script>window.HOMEIT_DEMO = true;</script>\n<script src="home.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
let phone = fs.readFileSync(path.join(__dirname, 'public', 'phone.html'), 'utf8');
phone = phone.replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/g, '').replace('<script src="home.js"></script>', '<script>window.HOMEIT_DEMO = true;</script>\n<script src="home.js"></script>');
fs.writeFileSync(path.join(out, 'phone.html'), phone);
fs.copyFileSync(path.join(__dirname, 'home.js'), path.join(out, 'home.js'));
for (const f of fs.readdirSync(path.join(__dirname, 'public', 'art'))) fs.copyFileSync(path.join(__dirname, 'public', 'art', f), path.join(out, 'art', f));
console.log('Preview written to ' + out);
