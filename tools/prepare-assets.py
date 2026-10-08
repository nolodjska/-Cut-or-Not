#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 assets/raw/*.png 处理成 dist/assets/*.webp（游戏实际加载的尺寸）。

为什么要这一步：生图产出是 1~2 MB 的 1k 原图，直接塞进移动端页面会拖垮首屏。
这里按"实际显示尺寸 × 2（照顾高清屏）"重采样并转 WebP，单张降到 20~90 KB。

命名约定（UI 侧按文件名引用，缺失时自动回退到 emoji）：
  icon-<作物>.webp    256×256   作物图标（卡片里显示 ~40px）
  bg-awards.webp      720×960   结算颁奖礼背景
  bg-share.webp       540×960   分享卡底图
  ev-<事件>.webp      640×480   市场事件插图

用法：python tools/prepare-assets.py
"""
import os, sys, glob

try:
    from PIL import Image
except ImportError:
    print("需要 Pillow：python -m pip install Pillow")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets', 'raw')
OUT = os.path.join(ROOT, 'dist', 'assets')

# 文件名里的关键字 -> (输出名, 目标宽, 目标高)
RULES = [
    ('A02-radish',  ('icon-radish',   256, 256)),
    ('A03-chili',   ('icon-chili',    256, 256)),
    ('A04-ginseng', ('icon-ginseng',  256, 256)),
    ('A01-awards',  ('bg-awards',     720, 960)),
    ('A06-share',   ('bg-share',      540, 960)),
    ('A05-drought', ('ev-drought',    640, 480)),
]

def main():
    os.makedirs(OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(RAW, '*.png')))
    if not files:
        print('assets/raw 里没有 png，跳过')
        return
    total_in = total_out = 0
    for f in files:
        base = os.path.basename(f)
        rule = next((r for r in RULES if base.startswith(r[0])), None)
        if not rule:
            print('  ? 没有规则，跳过 ' + base)
            continue
        name, w, h = rule[1]
        im = Image.open(f).convert('RGB')
        # 等比覆盖目标框（生图比例已经按 RULES 定过，这里只做保险）
        scale = max(w / im.width, h / im.height)
        if scale < 1:
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        left = max(0, (im.width - w) // 2)
        top = max(0, (im.height - h) // 2)
        im = im.crop((left, top, left + min(w, im.width), top + min(h, im.height)))
        if im.size != (w, h):
            im = im.resize((w, h), Image.LANCZOS)
        dest = os.path.join(OUT, name + '.webp')
        im.save(dest, 'WEBP', quality=82, method=5)
        a, b = os.path.getsize(f), os.path.getsize(dest)
        total_in += a; total_out += b
        print('  %-14s %5d×%-5d  %6.0f KB → %5.1f KB' % (name, w, h, a / 1024, b / 1024))
    print('\n合计 %.0f KB → %.1f KB（省 %.0f%%）' % (
        total_in / 1024, total_out / 1024, 100 * (1 - total_out / max(1, total_in))))
    print('输出目录：' + OUT)

if __name__ == '__main__':
    main()
