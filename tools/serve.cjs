/* 本机静态服务器：用来在浏览器里试玩 dist/ 下的游戏。
   用法：node tools/serve.cjs  然后开 http://127.0.0.1:8901/
   （浏览器工具不能导航 file:// 协议，所以试玩要走 HTTP。）
   换端口：`PORT=8912 node tools/serve.cjs`（或 PowerShell: $env:PORT=8912; node tools/serve.cjs）

   ⚠ 2026-10-08 修三处真实故障 —— 前两处由试玩子代理实测撞出来（第 2 轮试玩）：
     ① 打开根路径 `/` 返回 404，**玩家第一步就撞墙**。
        根因：`path.join(__dirname,'..','dist','/')` 得到的是**目录本身**，
              `fs.readFile` 读目录必然失败 → 落到 404 分支。
        修法：`/` 直接返回单文件 Demo（它是自包含的，就是玩家的唯一入口）。
     ② 原注释写"开 /demo.html"，但 dist 里的真名是「割不割-demo.html」——
        **照着注释开也必然 404**。现在 `/` 直达，不再需要玩家知道文件名。
     ③ 原写法 `path.join(..., decodeURIComponent(req.url))` 可被 `/../../x`
        逃出 dist/。改为 path.resolve + 前缀校验，越界直接 403。
     ④ 另外：原文件一旦 8901 被占用就整个崩掉（子代理实测 EADDRINUSE），
        现在支持 PORT 环境变量换端口。

   ⚠ 2026-10-08 第 3 轮：补齐标准响应头（本文件本轮唯一改动）。
     现象：panel 里 `file://` 打开 Demo → 视口 992×934、appW430 正常；
          但同一文件走 `http://127.0.0.1:8901/` → 视口塌成 2×2、点击被拒。
     实测（curl -D - / 原始 socket，改造前）：
         HTTP/1.1 200 OK
         Content-Type: text/html;charset=utf-8
         Date: ...
         Connection: keep-alive
         Keep-Alive: timeout=5
         Transfer-Encoding: chunked      ← 没有 Content-Length
     即：整个响应走 chunked 分包，且 404/403/HEAD 同样没有 Content-Length；
     也没有 Cache-Control / ETag / Last-Modified —— 构建产物改名或重建后，
     浏览器可能拿旧缓存，而**没有任何校验头能让它刷新**。
     本轮补齐：Content-Length（显式声明长度，客户端可据此校验完整性）、
     Cache-Control: no-store（每次强制回源，杜绝"旧缓存残留"这条唯一
     可能与 file:// 表现分叉的服务端路径）、Connection: close（长度确定、
     不再依赖分块）、Accept-Ranges + 正确的 206/416（Range 不再是"被忽略"）、
     ETag / Last-Modified、X-Content-Type-Options: nosniff，并支持 HEAD。

     ⚠ 诚实记录：本轮**无法把 panel 的 2×2 复现归因到服务端**。
       - 服务端发出的字节与磁盘**逐字节相同**（SHA256 见验证脚本输出）；
       - 用真实 Chrome 无头版对同一 URL 与 file:// 做 A/B，
         两边自报的视口指标**完全一致**：W974 H838 scrollW974 bodyW974 appW430 dpr1；
       - 且 2×2 是 `window.innerWidth`，它是**视口/窗口**属性，
         任何 HTTP 响应头都改不了它（内容再坏也只会撑出滚动条，不会把窗口压成 2px）。
       所以 2×2 更可能是面板侧窗口尺寸/设备模拟的产物；下面这组头是
       按"标准静态服务器"补齐的加固，顺带把"旧缓存"这条服务端嫌疑彻底排除。 */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', 'dist');
const INDEX = '割不割-demo.html';                 // 单文件 Demo，自包含
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const PORT = Number(process.env.PORT) || 8901;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* 统一的响应出口：所有分支都带 Content-Length，长度由实际字节算出，
   不可能和 body 长度不一致。Connection: close 让"发多少字节"完全确定。 */
function reply(req, res, status, headers, body) {
  const buf = body == null ? Buffer.alloc(0) : Buffer.from(body);
  res.writeHead(status, Object.assign({
    'Content-Length': String(buf.length),
    'Connection': 'close',
  }, headers));
  res.end(req.method === 'HEAD' ? undefined : buf);   // HEAD：头照发，body 不发
}

/* 单段 Range 解析；不合法返回 null（按 200 全量返回，符合 RFC 允许的行为） */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') {                                   // bytes=-N 末尾 N 字节
    start = Math.max(0, size - Number(m[2])); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

http.createServer((req, res) => {
  // 只接受 GET / HEAD（静态服务器不该响应其它方法）
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    reply(req, res, 405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD' }, '405');
    return;
  }

  let rel;
  try { rel = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]); }
  catch (e) { rel = null; }                            // 非法百分号转义 → 400
  if (rel === null || rel.indexOf('\0') !== -1) {
    reply(req, res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, '400');
    return;
  }
  if (rel === '/' || rel === '') rel = '/' + INDEX;    // ① 根路径 → 直接进游戏

  const p = path.resolve(ROOT, '.' + rel);             // ③ 越界校验
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) {
    reply(req, res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, '403');
    return;
  }

  fs.stat(p, (se, st) => {
    if (se || !st.isFile()) {
      reply(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, '404');
      return;
    }
    fs.readFile(p, (e, d) => {
      if (e) {
        reply(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, '404');
        return;
      }
      const headers = {
        'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
        // no-store：每次强制回源。构建产物会原地改名/重建，绝不能吃旧缓存。
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'bytes',
        'ETag': '"' + sha256(d) + '"',                   // 内容哈希，可直接对账
        'Last-Modified': st.mtime.toUTCString(),
      };
      const range = parseRange(req.headers.range, d.length);
      if (req.headers.range && !range) {                 // Range 非法 → 416
        reply(req, res, 416, Object.assign({}, headers, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Range': 'bytes */' + d.length,
        }), '');
        return;
      }
      if (range) {                                       // 合法 Range → 206
        reply(req, res, 206, Object.assign({}, headers, {
          'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + d.length,
        }), d.subarray(range.start, range.end + 1));
        return;
      }
      reply(req, res, 200, headers, d);                  // 常规：全量 + 精确长度
    });
  });
}).on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用。换一个：PORT=8912 node tools/serve.cjs');
    process.exit(1);
  }
  throw err;
}).listen(PORT, '127.0.0.1', () => {
  console.log('serving on http://127.0.0.1:' + PORT + '/   ← 根路径直接进游戏');
});
