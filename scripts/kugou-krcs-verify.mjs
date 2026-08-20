/**
 * 阶段 0 验证脚本：酷狗 krcs 歌词 + 汽水 SEO/volcengine 歌词
 *
 * 用法：
 *   node scripts/kugou-krcs-verify.mjs --hash=<fileHash> [--duration=<ms>]
 *   node scripts/kugou-krcs-verify.mjs --qishui-id=<trackId>
 *   node scripts/kugou-krcs-verify.mjs --all --hash=<hash> --duration=<ms> --qishui-id=<id>
 */

import https from 'node:https';
import http from 'node:http';

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: opts.headers || {} }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
  });
}

async function verifyKugouKrcs(hash, duration) {
  console.log('\n=== 酷狗 krcs 歌词验证 ===');
  console.log(`hash: ${hash}, duration: ${duration || 0}s`);

  // Step 1: krcs search
  const searchUrl = `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=&duration=${duration || 0}&hash=${encodeURIComponent(hash)}&album_audio_id=`;
  console.log(`\n[1] GET ${searchUrl}`);
  const searchRes = await fetch(searchUrl);
  console.log(`    Status: ${searchRes.status}`);
  const searchData = JSON.parse(searchRes.data);
  const candidate = searchData?.candidates?.[0];
  if (!candidate) {
    console.log('    FAIL: 无候选歌词');
    return false;
  }
  console.log(`    PASS: id=${candidate.id}, accesskey=${candidate.accesskey}`);

  // Step 2: krcs download
  const dlUrl = `https://krcs.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=lrc&charset=utf8`;
  console.log(`\n[2] GET ${dlUrl}`);
  const dlRes = await fetch(dlUrl);
  console.log(`    Status: ${dlRes.status}`);
  const dlData = JSON.parse(dlRes.data);
  let content = dlData?.content || '';
  // Try base64 decode
  if (content && !content.includes('[offset=') && !content.includes('[00:')) {
    try {
      content = Buffer.from(content, 'base64').toString('utf-8');
      console.log('    (content was base64, decoded)');
    } catch {
      console.log('    (content is not base64)');
    }
  }
  if (content && (content.includes('[offset=') || content.includes('[00:'))) {
    const lines = content.split('\n').filter(l => l.trim());
    const hasWordLevel = lines.some(l => /\(\d+,\d+/.test(l));
    console.log(`    PASS: ${lines.length} 行, 逐字: ${hasWordLevel ? '✓' : '✗'}`);
    console.log(`    前 3 行: ${lines.slice(0, 3).join(' | ')}`);
    return true;
  }
  console.log('    FAIL: 无有效歌词内容');
  return false;
}

async function verifyQishuiSeo(trackId) {
  console.log('\n=== 汽水 SEO 歌词验证 ===');
  console.log(`trackId: ${trackId}`);

  const url = `https://beta-luna.douyin.com/luna/h5/seo_track?id=${trackId}`;
  console.log(`\n[1] GET ${url}`);
  const res = await fetch(url, { headers: { Referer: 'https://www.qishui.com/' } });
  console.log(`    Status: ${res.status}`);
  const data = JSON.parse(res.data);
  const lrc = data?.lyric_text;
  if (lrc) {
    const lines = lrc.split('\n').filter(l => l.trim());
    const hasWordLevel = lines.some(l => /\(\d+,\d+/.test(l));
    console.log(`    PASS: ${lines.length} 行, 逐字: ${hasWordLevel ? '✓' : '✗'}`);
    console.log(`    前 3 行: ${lines.slice(0, 3).join(' | ')}`);
    if (data?.translated_lyric) {
      console.log(`    翻译: ${data.translated_lyric.substring(0, 80)}...`);
    }
    return true;
  }
  console.log('    FAIL: 无歌词内容');
  return false;
}

async function verifyQishuiVolcengine(trackId) {
  console.log('\n=== 汽水 volcengine 公开目录歌词验证 ===');
  console.log(`trackId: ${trackId}`);

  const url = `https://api-vehicle.volcengine.com/v2/custom/contents?sources=qishui&need_author=true&need_album=true&need_ugc=true&need_stat=true&item_ids=${trackId}`;
  console.log(`\n[1] GET ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mineradio/2.1.0 (Qishui public catalog bridge)' },
  });
  console.log(`    Status: ${res.status}`);
  const data = JSON.parse(res.data);
  const item = data?.data?.[0];
  const lrc = item?.lyric_text;
  if (lrc) {
    const lines = lrc.split('\n').filter(l => l.trim());
    const hasWordLevel = lines.some(l => /\(\d+,\d+/.test(l));
    console.log(`    PASS: ${lines.length} 行, 逐字: ${hasWordLevel ? '✓' : '✗'}`);
    console.log(`    标题: ${item?.title || '(无)'}`);
    console.log(`    前 3 行: ${lines.slice(0, 3).join(' | ')}`);
    return true;
  }
  console.log('    FAIL: 无歌词内容');
  return false;
}

// Parse args
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

async function main() {
  const results = {};
  if (args.hash || args.all) {
    const hash = args.hash || '26B0F99A2C6ABCC5B4FAD5B381E667B2'; // 默认一首免费歌
    const duration = args.duration ? Number(args.duration) : 0;
    results.kugouKrcs = await verifyKugouKrcs(hash, duration);
  }
  if (args['qishui-id'] || args.all) {
    const id = args['qishui-id'] || '7039910455'; // 默认一首歌
    results.qishuiSeo = await verifyQishuiSeo(id);
    results.qishuiVolc = await verifyQishuiVolcengine(id);
  }
  console.log('\n=== 汇总 ===');
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${k}: ${v ? 'PASS' : 'FAIL'}`);
  }
}

main().catch(console.error);
