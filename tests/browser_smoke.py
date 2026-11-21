"""Local browser-level SDK contract check; no DB or external network used."""
import json, threading, pathlib
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
received=[]
snapshots=[]
class H(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path.startswith('/api/events/config'):
            return self.reply(200, {'settings': {'analytics':True,'heatmaps':True,'sessionReplay':False},'definitions':[]})
        if self.path == '/sdk/vision.js':
            b=(ROOT/'sdk/vision.js').read_bytes()
            self.send_response(200); self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
        if self.path == '/products':
            b=b'''<!doctype html><html><body style="margin:0"><main><h1>Products</h1>
              <button id="buy" style="position:absolute;left:200px;top:250px;width:220px;height:60px">Add to Basket</button>
              <div style="height:1500px"></div></main>
              <script>window.visionHeatmapCapture=async(_,options)=>{const c=document.createElement('canvas');c.width=options.width;c.height=options.height;return c}</script>
              <script src="/sdk/vision.js" data-project-id="vis-test" data-api-base="http://127.0.0.1:8237" data-heatmap-capture="true"></script>
              </body></html>'''
            self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
        return self.reply(404,{})
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
        if self.path=='/api/events':
            received.extend(data.get('events',[])); return self.reply(201, {'inserted':len(data.get('events',[]))})
        if self.path=='/api/events/heatmap-snapshots':
            snapshots.append(data);return self.reply(201, {'key':data['key']})
        return self.reply(404,{})
    def reply(self,status,obj):
        b=json.dumps(obj).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Access-Control-Allow-Origin','*');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
server=ThreadingHTTPServer(('127.0.0.1',8237),H)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    page.goto('http://127.0.0.1:8237/products')
    page.wait_for_function('window.vision?.getFeatures()?.heatmaps===true',timeout=12000)
    for i in range(40):page.locator('#buy').click()
    page.wait_for_timeout(2900)
    page.evaluate('window.vision.flush()')
    page.wait_for_timeout(700)
    clicks=[e for e in received if e['event']=='heatmap_click']
    assert len(clicks)==40, (len(clicks),len(received))
    assert clicks[0]['properties']['xPx']==310, clicks[0]['properties']
    assert clicks[0]['properties']['yPx']==280, clicks[0]['properties']
    assert clicks[0]['properties']['coordinateSpace']=='document-px-v4'
    assert snapshots, 'no matching layout snapshot generated'
    assert clicks[0]['properties']['layoutKey']==snapshots[0]['key']
    print('Browser smoke PASS: 40 clicks, exact coordinate, matched layout snapshot')
    browser.close()
server.shutdown()
