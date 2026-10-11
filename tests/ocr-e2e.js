'use strict';
/*
 * OCR 端到端测试：在页面里画一张仿真成绩单图片 → 塞进「图片 / 文本导入」的文件输入框
 * → 点「开始识别」→ 等 tesseract.js 识别 → 点「重新解析」→ 追加到学期，检查结果。
 *
 * 需要联网（首次要下载识别引擎和中文语言包），耗时通常十几秒到几分钟。
 *
 *   node tests/ocr-e2e.js
 */
const { APP, openPage } = require('./lib');

const SCRIPT = `(async () => {
  const out = { steps: [], recognize: null, parsed: null, error: null };
  const log = m => out.steps.push(m);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    // 1) 画一张仿真成绩单
    const cv = document.createElement('canvas');
    cv.width = 1120; cv.height = 430;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    ctx.font = '33px "Microsoft YaHei","SimHei",sans-serif';
    const X = [50, 640, 780, 950];
    ['课程名称','学分','成绩','绩点'].forEach((t, i) => ctx.fillText(t, X[i], 62));
    ctx.fillRect(40, 84, 1040, 3);
    const rows = [
      ['高等数学(上)','5.0','92','4.0'],
      ['大学英语(一)','3.0','86','3.7'],
      ['线性代数','3.0','95','4.0'],
      ['大学物理','4.0','79','3.0'],
      ['程序设计基础','3.0','88','3.7']
    ];
    rows.forEach((r, ri) => {
      const y = 140 + ri * 62;
      r.forEach((t, i) => ctx.fillText(t, X[i], y));
    });
    log('已生成测试图片 ' + cv.width + 'x' + cv.height);

    // 2) 走真实入口：塞进 file input 并触发 change
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = new File([blob], '成绩单.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('fileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(50);
    const thumbs = document.querySelectorAll('#thumbs .thumb').length;
    log('缩略图数量=' + thumbs);
    if (!thumbs) throw new Error('图片未进入待识别队列');

    // 3) 点「开始识别」并轮询状态
    document.getElementById('btnOcr').click();
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      const st = document.getElementById('ocrStatus').textContent;
      const raw = document.getElementById('rawText').value;
      if (st.indexOf('识别完成') >= 0 || st.indexOf('识别失败') >= 0) break;
      if (raw.trim() && st.indexOf('识别第') < 0 && st.indexOf('准备') < 0) break;
      await sleep(500);
    }
    out.recognize = { status: document.getElementById('ocrStatus').textContent, ms: Date.now() - t0 };
    const raw = document.getElementById('rawText').value;
    out.rawText = raw.slice(0, 600);
    out.rawLen = raw.length;
    if (!raw.trim()) throw new Error('识别未产生文本：' + out.recognize.status);
    log('识别完成，用时 ' + Math.round((Date.now() - t0) / 1000) + ' 秒');

    // 4) 解析
    document.getElementById('btnReparse').click();
    await sleep(100);
    out.parsed = {
      info: document.getElementById('parseInfo').textContent,
      rows: Array.prototype.map.call(document.querySelectorAll('#preview tbody tr'), tr =>
        Array.prototype.map.call(tr.children, td => td.textContent.trim()))
    };
    log('解析：' + out.parsed.info);

    // 5) 追加到学期并检查表格
    document.getElementById('btnAppend').click();
    await sleep(100);
    out.table = Array.prototype.map.call(document.querySelectorAll('#panel tbody tr'), tr => ({
      name: tr.querySelector('[data-f="name"]').value,
      credits: tr.querySelector('[data-f="credits"]').value,
      gpa: tr.querySelector('[data-f="gpa"]').value
    }));
    out.overall = document.getElementById('overallGpa').textContent;
    log('导入后总平均绩点=' + out.overall + '，课程数=' + out.table.length);
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
})()`;

(async () => {
  let runner = null;
  let result = null;
  try {
    runner = await openPage(APP, { settleMs: 1200 });
    console.log('浏览器: ' + runner.browser);
    await runner.waitForText('#panel', 20000);   // 等应用初始化完成
    result = await runner.cdp.eval(SCRIPT, 330000);
  } finally {
    if (runner) runner.close();
  }

  console.log('\n================ 结果 ================');
  if (!result) { console.log('无结果'); process.exit(1); }
  if (result.error) console.log('错误: ' + result.error);
  console.log('--- 步骤 ---');
  (result.steps || []).forEach(s => console.log('  ' + s));
  console.log('--- 识别 ---');
  console.log('  状态: ' + JSON.stringify(result.recognize));
  console.log('  原文长度: ' + result.rawLen);
  console.log('  原文:');
  console.log((result.rawText || '').split('\n').map(l => '    | ' + l).join('\n'));
  console.log('--- 解析 ---');
  if (result.parsed) {
    console.log('  ' + result.parsed.info);
    result.parsed.rows.forEach(r => console.log('    ' + r.join(' | ')));
  }
  console.log('--- 导入后的表格 ---');
  (result.table || []).forEach(r => console.log('    ' + JSON.stringify(r)));
  console.log('  总平均绩点: ' + result.overall);

  const bad = !!(result.error || !result.parsed || !result.parsed.rows.length || result.table.length !== 5 || result.overall !== '3.68');
  process.exit(bad ? 1 : 0);
})().catch(err => {
  console.error('OCR 端到端测试执行失败: ' + err.message);
  process.exit(1);
});
