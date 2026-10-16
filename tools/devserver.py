# 开发用本机服务（只监听 127.0.0.1:8765）：
#   GET  /              开发页：插件在这一页上接受 af:dev-reload 事件并重新加载自己（见 ui/panel.js、background.js DEV_RELOAD）
#   GET  /src/...       只读提供插件源码（在真实申请页上注入调试用）
#   POST /?name=文件名   把页面上抓到的字段清单等存到 /tmp/afcap/（只存结构，用于整理成 test/cases/）
# 用法：python3 tools/devserver.py
import http.server, urllib.parse, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAP = '/tmp/afcap'
DEV_PAGE = '''<!doctype html><meta charset="utf-8"><title>网申助手 开发页</title>
<p>网申助手开发页。插件版本：<b id="v">（未加载）</b></p>
<script>setTimeout(()=>{document.getElementById('v').textContent=document.documentElement.dataset.afDev||'未加载'},800)</script>'''.encode('utf-8')


class H(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def do_GET(self):
        p = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if p == '/form':
            # 不属于任何已适配平台的普通表单：检查兜底（模拟点击）引擎没被重构弄坏
            html = '''<!doctype html><meta charset="utf-8"><title>普通表单</title><h2>基本信息</h2>
<p><label>姓名 <input name="n"></label></p><p><label>手机号码 <input name="p"></label></p>
<p><label>邮箱 <input name="e"></label></p><p><label>民族 <select name="m"><option value="">请选择</option><option>汉族</option><option>蒙古族</option></select></label></p>
<p><label>出生日期 <input type="date" name="b"></label></p><p><label>政治面貌 <select name="z"><option value="">请选择</option><option>中共党员</option><option>群众</option></select></label></p>'''
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(html.encode('utf-8')); return
        if p in ('/', '/dev'):
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(DEV_PAGE); return
        f = os.path.realpath(os.path.join(ROOT, p.lstrip('/')))
        if not f.startswith(os.path.join(ROOT, 'src') + os.sep) or not os.path.isfile(f):
            self.send_response(404); self.cors(); self.end_headers(); return
        data = open(f, 'rb').read()
        self.send_response(200); self.cors(); self.send_header('Content-Type', 'text/javascript; charset=utf-8'); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = os.path.basename(q.get('name', ['dump'])[0])
        data = self.rfile.read(int(self.headers['Content-Length']))
        os.makedirs(CAP, exist_ok=True)
        open(os.path.join(CAP, name), 'wb').write(data)
        self.send_response(200); self.cors(); self.end_headers(); self.wfile.write(b'ok')

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
