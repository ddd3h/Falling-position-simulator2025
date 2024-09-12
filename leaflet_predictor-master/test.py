#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler, test #HTTPサーバーの起動
# http.serverって確か動作確認に使うやつだと思ってた。
import sys

class CORSRequestHandler (SimpleHTTPRequestHandler): #CORSポリシー??? ➡　異なるオリジンからのアクセスを許可できる仕組み
    def end_headers (self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'text/html; charset=utf-8') # Content-TypeヘッダーにUTF-8を指定
        SimpleHTTPRequestHandler.end_headers(self)

if __name__ == '__main__':
    test(CORSRequestHandler, HTTPServer, port=int(sys.argv[1]) if len(sys.argv) > 1 else 8080)