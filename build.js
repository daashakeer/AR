import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const filesToCopy = ['index.html', 'style.css', 'app.js', 'README.md'];
for (const file of filesToCopy) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(distDir, file));
    console.log(`Copied ${file} -> dist/${file}`);
  }
}
console.log('Build finished successfully for Cloudflare Pages / Static Hosting.');
