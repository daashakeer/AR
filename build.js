import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else if (exists) {
    fs.copyFileSync(src, dest);
  }
}

const filesToCopy = ['index.html', 'style.css', 'app.js', 'README.md', 'package.json'];
for (const file of filesToCopy) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(distDir, file));
    console.log(`Copied ${file} -> dist/${file}`);
  }
}

if (fs.existsSync('images')) {
  copyRecursiveSync('images', path.join(distDir, 'images'));
  console.log('Copied images directory -> dist/images/');
}

console.log('Build finished successfully for Cloudflare Pages / Static Hosting.');
