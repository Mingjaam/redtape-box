// node_modules → renderer/vendor 로 three.js 와 폰트(woff2만)를 복사한다.
// npm install 후 자동 실행(postinstall). 오프라인에서도 앱이 돌도록 모든 자산을 로컬에 둔다.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'renderer', 'vendor');

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// three.js (module 빌드는 three.core.js 를 상대경로로 import 한다)
for (const f of ['three.module.js', 'three.core.js']) {
  copy(path.join(nm, 'three', 'build', f), path.join(out, f));
}
copy(path.join(nm, 'three', 'LICENSE'), path.join(out, 'three.LICENSE.txt'));

// 폰트: woff2 만 남기고 css 의 woff 대체 경로를 제거
function font(pkg, cssFiles, dstName) {
  const base = path.join(nm, '@fontsource', pkg);
  let css = '';
  for (const c of cssFiles) css += fs.readFileSync(path.join(base, c), 'utf8') + '\n';
  css = css.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, '');
  const dstDir = path.join(out, 'fonts', dstName);
  fs.mkdirSync(path.join(dstDir, 'files'), { recursive: true });
  fs.writeFileSync(path.join(dstDir, 'font.css'), css);
  for (const f of fs.readdirSync(path.join(base, 'files'))) {
    if (f.endsWith('.woff2')) copy(path.join(base, 'files', f), path.join(dstDir, 'files', f));
  }
  // SIL OFL 1.1: 폰트를 함께 배포할 때 라이선스 전문을 동봉
  if (fs.existsSync(path.join(base, 'LICENSE'))) copy(path.join(base, 'LICENSE'), path.join(dstDir, 'LICENSE.txt'));
}
font('nanum-pen-script', ['index.css'], 'pen');
font('nanum-gothic-coding', ['400.css', '700.css'], 'coding');

console.log('vendor assets copied →', path.relative(root, out));
