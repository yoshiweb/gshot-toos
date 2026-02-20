#!/usr/bin/env node

const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const targetUrl = process.argv[2];

if (!targetUrl) {
  console.error('エラー: URLを指定してください。');
  console.error('使用法: node gshot.js <URL>');
  process.exit(1);
}

// --- 設定 ---
const VIEWPORT_WIDTH = 1280; // CSSピクセルとしての幅
const VIEWPORT_HEIGHT = 800; // CSSピクセルとしての高さ（スクロール単位）
const SCROLL_DELAY = 500;    // スクロール後の待機時間(ms)
const SCALE = 2;             // 【変更点】高画質化 (deviceScaleFactor)

(async () => {
  console.log(`[Info] 起動中 (High Quality Mode)... Target: ${targetUrl}`);
  
  // ブラウザ起動時に高画質設定を適用
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: SCALE // Retina相当の描画
  });

  try {
    console.log('[Info] ページを読み込んでいます...');
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000); // 初期レンダリング待機

    // --- 追従要素（固定ヘッダー/フッター）を隠す処理 ---
    console.log('[Info] 固定配置の要素(header/footer等)を非表示にしています...');
    await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }
    });
    await page.waitForTimeout(500);

    // --- ページ情報の取得 ---
    const { totalHeight } = await page.evaluate(() => {
      return { totalHeight: document.documentElement.scrollHeight };
    });
    console.log(`[Info] ページ全体の高さ(CSS px): ${totalHeight}px`);
    console.log(`[Info] 出力画像の高さ(Physical px): ${totalHeight * SCALE}px`);

    // --- スクロール撮影ループ ---
    const screenshots = [];
    let currentY = 0;
    let count = 1;

    console.log('[Info] スクロール撮影を開始します...');

    while (currentY < totalHeight) {
      // 指定位置へスクロール
      await page.evaluate((y) => window.scrollTo(0, y), currentY);
      await page.waitForTimeout(SCROLL_DELAY);

      console.log(`  - 撮影中: パート${count} (Y: ${currentY})`);
      
      // 撮影（データは deviceScaleFactor: 2 なので2倍サイズで返ってくる）
      const buffer = await page.screenshot({ fullPage: false });
      
      screenshots.push({
        buffer: buffer,
        top: currentY * SCALE // 【重要】結合時のY座標もスケール倍する
      });

      currentY += VIEWPORT_HEIGHT;
      count++;
    }

    // --- 画像の結合処理 ---
    console.log('[Info] 画像を結合しています...');
    
    // ベース画像もスケール倍のサイズで作成
    const baseImage = sharp({
      create: {
        width: VIEWPORT_WIDTH * SCALE,
        height: totalHeight * SCALE,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    });

    const composites = screenshots.map(shot => ({
      input: shot.buffer,
      top: shot.top,
      left: 0,
      gravity: 'north'
    }));

    // メタデータ制限（巨大画像エラー防止）を解除して処理
    const finalImageBuffer = await baseImage
      .composite(composites)
      .png()
      .toBuffer();

    // --- 【変更点】ファイル名生成ロジック ---
    const urlObj = new URL(targetUrl);
    
    // URL全体（プロトコルを含む）をベースにする
    let safeName = urlObj.href;

    // クエリパラメータ（?以降）やハッシュ（#以降）を考慮して拡張子を除去
    safeName = safeName.replace(/\.(html|htm|php|jsp|asp)(?=$|\?|#)/i, '');

    // コロン(:)、スラッシュ(/)、クエスチョン(?)、アンパサンド(&)、イコール(=)、ハッシュ(#)をアンダースコア(_)に置換
    safeName = safeName.replace(/[:\/?&=#]/g, '_');

    // 連続するアンダースコアを整理 & 末尾整理
    safeName = safeName.replace(/_+/g, '_').replace(/^_|_$/g, '');

    // 万が一空ならindex
    if (!safeName) safeName = 'index';

    // 現在日時の取得とフォーマット (yyyyMMdd-HHmmss.SSS)
    const now = new Date();
    const yyyy = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const SSS = String(now.getMilliseconds()).padStart(3, '0');

    // ハイフンやドットを含めたタイムスタンプ文字列の生成
    const timestamp = `-${yyyy}${MM}${dd}-${HH}${mm}${ss}.${SSS}`;

    // 拡張子 .png を付与し、その直前にタイムスタンプを結合
    const filename = `${safeName}${timestamp}.png`;
    // -------------------------------------------------------

    fs.writeFileSync(filename, finalImageBuffer);
    console.log(`[Success] 完了: ${filename} に保存しました。`);

  } catch (error) {
    console.error(`[Error] 失敗しました: ${error.message}`);
  } finally {
    await browser.close();
  }
})();