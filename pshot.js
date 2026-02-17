#!/usr/bin/env node

const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const targetUrl = process.argv[2];

if (!targetUrl) {
  console.error('エラー: URLを指定してください。');
  console.error('使用法: node pshot.js <URL>');
  process.exit(1);
}

// --- 設定 ---
const VIEWPORT_WIDTH = 1280; //撮影幅
const VIEWPORT_HEIGHT = 800; // 1回の撮影高さ（スクロール単位）
const SCROLL_DELAY = 500; // スクロール後の待機時間(ms)

(async () => {
  console.log(`[Info] 起動中... Target: ${targetUrl}`);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

    console.log('[Info] ページを読み込んでいます...');
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000); // 初期レンダリング待機

    // --- 【重要】追従要素（固定ヘッダー/フッター）を隠す処理 ---
    console.log('[Info] 固定配置の要素(header/footer等)を非表示にしています...');
    await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        // position: fixed または sticky の要素を見つける
        if (style.position === 'fixed' || style.position === 'sticky') {
          // レイアウト崩れを抑えつつ見えなくする
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }
    });
    await page.waitForTimeout(500); // 反映待機

    // --- ページ情報の取得 ---
    const { totalHeight } = await page.evaluate(() => {
      return { totalHeight: document.documentElement.scrollHeight };
    });
    console.log(`[Info] ページ全体の高さ: ${totalHeight}px`);

    // --- スクロール撮影ループ ---
    const screenshots = [];
    let currentY = 0;
    let count = 1;

    console.log('[Info] スクロール撮影を開始します...');

    while (currentY < totalHeight) {
      // 指定位置へスクロール
      await page.evaluate((y) => window.scrollTo(0, y), currentY);
      await page.waitForTimeout(SCROLL_DELAY); // 描画待ち

      // 現在のビューポートを撮影
      console.log(`  - 撮影中: パート${count} (Y: ${currentY})`);
      const buffer = await page.screenshot({ fullPage: false }); // ※fullPage: falseを明示
      
      screenshots.push({
        buffer: buffer,
        top: currentY // この画像が全体のどこに位置するか
      });

      currentY += VIEWPORT_HEIGHT;
      count++;
    }

    // --- 画像の結合処理 (Sharp使用) ---
    console.log('[Info] 画像を結合しています...');
    
    // ベースとなる巨大な空画像を作成
    const baseImage = sharp({
      create: {
        width: VIEWPORT_WIDTH,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    });

    // 撮影した画像を合成するための設定を作成
    const composites = screenshots.map(shot => ({
      input: shot.buffer,
      top: shot.top,
      left: 0,
      // 最後の画像がページからはみ出る場合の対策（gravity: northで上合わせにする）
      gravity: 'north'
    }));

    // 合成実行
    const finalImageBuffer = await baseImage
      .composite(composites)
      .png() // PNG形式
      .toBuffer();

    // --- ファイル保存 ---
    let filename = path.basename(new URL(targetUrl).pathname);
    if (!filename || filename === '/') filename = 'index';
    if (!path.extname(filename)) filename += '.png';
    // 拡張子が.htmlなどだった場合は.pngに置換
    filename = filename.replace(/\.(html|htm|php)$/i, '') + '.png';

    fs.writeFileSync(filename, finalImageBuffer);
    console.log(`[Success] 完了: ${filename} に保存しました。`);

  } catch (error) {
    console.error(`[Error] 失敗しました: ${error.message}`);
  } finally {
    await browser.close();
  }
})();