/* 미리보기용 정적 서버. 배포에는 필요 없고, 로컬에서 실제 주소처럼
   확인하고 싶을 때만 씁니다.   실행: node dev-server.js [포트] */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const ROOT = path.resolve(__dirname), PORT = Number(process.argv[2] || 8321);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp'
};
http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';
  const file = path.resolve(path.join(ROOT, p));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found: ' + p); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => console.log('http://localhost:' + PORT + ' 에서 실행 중'));
