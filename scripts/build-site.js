// 소개 사이트 빌드: site/ 와 실제 앱 화면(renderer/)을 _site/ 로 모은다.
// _site/app/ 은 웹 미리보기(브라우저 데모 모드)로 동작한다. GitHub Pages 워크플로가 이 결과를 배포한다.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, '_site'));

// fs.cpSync 는 Windows 의 한글 경로에서 node 가 죽는 경우가 있어 직접 복사한다
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(out, { recursive: true, force: true });
copyDir(path.join(root, 'site'), out);
copyDir(path.join(root, 'renderer'), path.join(out, 'app'));
if (!fs.existsSync(path.join(out, 'app', 'vendor', 'three.module.js'))) {
  console.error('renderer/vendor 가 비어 있어요. 먼저 npm install (또는 node scripts/vendor.js) 을 실행하세요.');
  process.exit(1);
}
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(out, 'media', 'icon.png'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('site built →', path.relative(root, out));
