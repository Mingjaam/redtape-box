// macOS 빌드.
//   node scripts/dist-mac.js          → 키체인/CSC_LINK 의 Developer ID 인증서로 서명 (+ APPLE_API_* 가 있으면 공증)
//   node scripts/dist-mac.js --adhoc  → 인증서 없이 ad-hoc 서명 (처음 열 때 Gatekeeper 경고가 뜸)
const builder = require('electron-builder');
const pkg = require('../package.json');

const adhoc = process.argv.includes('--adhoc');
const mac = adhoc
  ? { ...pkg.build.mac, identity: '-', hardenedRuntime: false, notarize: false }
  : pkg.build.mac;

builder
  .build({ targets: builder.Platform.MAC.createTarget(), config: { ...pkg.build, mac }, publish: 'never' })
  .then((files) => console.log(adhoc ? 'ad-hoc 서명 빌드 완료' : '서명 빌드 완료', '\n' + files.join('\n')))
  .catch((e) => { console.error(e); process.exit(1); });
