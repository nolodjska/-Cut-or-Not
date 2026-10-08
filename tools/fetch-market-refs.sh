#!/usr/bin/env bash
# 把与《割不割》市场模型相关的高质量开源项目浅克隆到 E:\opensource_study
# 用法：bash tools/fetch-market-refs.sh
# 说明：--depth 1 只取最新快照（研究用途够用，且每个仓库体积降到几十 MB 内）
set -u

ROOT="/e/opensource_study"
mkdir -p "$ROOT"
cd "$ROOT" || exit 1

ok=0; fail=0
cloned() {  # $1=分类目录  $2=owner/repo
  local dir="$1" repo="$2" name
  name="$(basename "$repo")"
  mkdir -p "$dir"
  if [ -d "$dir/$name/.git" ]; then
    echo "  [跳过] $dir/$name 已存在"
    return
  fi
  # 批量克隆时会遇到暂时性网络故障（实测同一仓库单独跑就成功），所以每个最多重试 3 次
  local attempt
  for attempt in 1 2 3; do
    if git clone --depth 1 --quiet "https://github.com/$repo.git" "$dir/$name" 2>/dev/null; then
      local kb
      kb=$(du -sk "$dir/$name" 2>/dev/null | cut -f1)
      echo "  [OK]   $dir/$name  (${kb} KB)$( [ "$attempt" -gt 1 ] && echo "  ← 第 $attempt 次成功")"
      ok=$((ok+1))
      return
    fi
    rm -rf "$dir/$name" 2>/dev/null   # 清掉半成品，否则下次会被"已存在"跳过
    sleep 3
  done
  echo "  [失败] $repo（重试 3 次）"
  fail=$((fail+1))
}

echo "=== 01 订单簿与撮合引擎（限价单簿的实现细节，对标我们的挂单/冲击） ==="
cloned "01-订单簿与撮合" "Crypto-toolbox/HFT-Orderbook"
cloned "01-订单簿与撮合" "i25959341/orderbook"
cloned "01-订单簿与撮合" "joaquinbejar/OrderBook-rs"
cloned "01-订单簿与撮合" "dyn4mik3/OrderBook"
cloned "01-订单簿与撮合" "danielktaylor/PyLimitBook"
cloned "01-订单簿与撮合" "Kautenja/limit-order-book"
cloned "01-订单簿与撮合" "alexey-ernest/go-hft-orderbook"
cloned "01-订单簿与撮合" "ronitgupta138/apex-matching-engine"

echo "=== 02 市场仿真与做市（价格冲击、做市商保留价、逆向选择） ==="
cloned "02-市场仿真与做市" "abides-sim/abides"
cloned "02-市场仿真与做市" "davecliff/BristolStockExchange"
cloned "02-市场仿真与做市" "ezhulenev/orderbook-dynamics"
cloned "02-市场仿真与做市" "cristal-smac/atomPython"
cloned "02-市场仿真与做市" "tfrmma/game-theory-trading-strats"
cloned "02-市场仿真与做市" "tfrmma/realistic-mm-backtester"

echo "=== 03 拍卖与机制设计（我们的暗标/明标/软延时对标这套） ==="
cloned "03-拍卖与机制设计" "ChuaCheowHuan/gym-continuousDoubleAuction"
cloned "03-拍卖与机制设计" "apayne19/DoubleAuctionMarket"
cloned "03-拍卖与机制设计" "erelsgl/double-auction"
cloned "03-拍卖与机制设计" "IOP-Experiments/otree-double-auction"
cloned "03-拍卖与机制设计" "QuantEcon/MatchingMarkets.py"
cloned "03-拍卖与机制设计" "phelps-sg/jasa"

echo "=== 04 计算经济学 / ABM 框架（NPC 群体行为、信贷与资产负债表） ==="
cloned "04-计算经济学与ABM" "AB-CE/abce"
cloned "04-计算经济学与ABM" "AB-CE/abcFinance"
cloned "04-计算经济学与ABM" "INET-Complexity/ESL"
cloned "04-计算经济学与ABM" "uwol/computational-economy"
cloned "04-计算经济学与ABM" "projectmesa/mesa"

echo
echo "===== 完成：成功 $ok 个，失败 $fail 个 ====="
echo "总体积：$(du -sh "$ROOT" 2>/dev/null | cut -f1)"
