'use strict';
/*
 * 集成测试：把一段测试脚本注入 index.html 的副本，用无头 Chrome 真实点击操作，
 * 校验学期 / 学年 / 总绩点、手动改绩点、加课、取消计入、粘贴表格、导入弹窗、换算规则等。
 *
 *   node tests/integration.js
 */
const fs = require('fs');
const path = require('path');
const { APP, TMP, openPage } = require('./lib');

const html = fs.readFileSync(APP, 'utf8');

/* 注入到页面里的测试脚本：只通过 DOM 操作，走真实用户路径 */
const HARNESS = `
<script>
window.addEventListener('load', function(){
  var log = [], pass = 0, fail = 0;
  function q(s){ return document.querySelector(s); }
  function qa(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function ROWS(){ return qa('#panel tbody tr'); }
  function YBARS(){ return qa('#yearBars .bar-row'); }
  function is(actual, expected, label){
    if (String(actual) === String(expected)) { pass++; log.push('PASS ' + label + ' = ' + actual); }
    else { fail++; log.push('FAIL ' + label + '  期望 ' + expected + ' 实际 ' + actual); }
  }
  function fire(el, type){ el.dispatchEvent(new Event(type, { bubbles: true })); }
  function finish(){
    log.push('-----------------------------');
    log.push('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    var pre = document.createElement('pre');
    pre.id = 'TESTOUT';
    pre.textContent = log.join('\\n');
    document.body.appendChild(pre);
  }

  try {
    var storeOK = 'no';
    try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); storeOK = 'yes'; } catch(e){ storeOK = 'NO (' + e.name + ')'; }
    log.push('本地存储可用: ' + storeOK);

    // ---- 1. 载入示例（3 个学期 / 2 个学年）----
    window.confirm = function(){ return true; };
    q('#btnDemo').click();
    if (qa('#panel thead th').length === 6) q('[data-act="togglescore"]').click();
    is(q('#overallGpa').textContent, '3.55', '示例总平均绩点');
    is(q('#semGpa').textContent, '3.75', '示例学期平均绩点(大一上)');
    is(q('#yearGpa').textContent, '3.65', '示例学年平均绩点(大一)');
    is(YBARS().length, 2, '学年分组数');
    is(qa('.tab').length, 4, '学期标签数(3学期+新增按钮)');
    is(ROWS().length, 4, '课程行数');

    // ---- 2. 手动修改绩点 ----
    var g1 = q('#panel tbody tr [data-f="gpa"]');
    g1.value = '2.0'; fire(g1, 'input');
    is(q('#semGpa').textContent, '2.80', '手改绩点后学期绩点');
    is(q('#yearGpa').textContent, '3.25', '手改绩点后学年绩点(大一)');
    is(q('#overallGpa').textContent, '3.27', '手改绩点后总绩点');

    // ---- 3. 新增课程并填值 ----
    q('[data-act="addrow"]').click();
    var rows = ROWS();
    var last = rows[rows.length - 1];
    is(rows.length, 5, '新增一行');
    var cIn = last.querySelector('[data-f="credits"]');
    var gIn = last.querySelector('[data-f="gpa"]');
    var nIn = last.querySelector('[data-f="name"]');
    cIn.value = '4'; fire(cIn, 'input');
    gIn.value = '4.0'; fire(gIn, 'input');
    nIn.value = '新课程'; fire(nIn, 'input');
    is(q('#overallGpa').textContent, '3.34', '加课(4学分/4.0)后总绩点');
    is(q('#yearGpa').textContent, '3.35', '加课后学年绩点');
    is(q('#semCredits').textContent, '14.5', '学期学分合计');
    is(last.querySelector('[data-f="name"]').value, '新课程', '课程名输入未被重绘打断');

    // ---- 4. 取消计入 ----
    var cb = q('#panel tbody tr [data-f="counted"]');
    cb.checked = false; fire(cb, 'input');
    is(q('#semGpa').textContent, '3.72', '取消计入后学期绩点');
    is(q('#yearGpa').textContent, '3.63', '取消计入后学年绩点');
    is(q('#overallGpa').textContent, '3.54', '取消计入后总绩点');
    cb.checked = true; fire(cb, 'input');
    is(q('#overallGpa').textContent, '3.34', '重新计入后还原');

    // ---- 5. 切换学期 ----
    qa('.tab')[1].click();
    is(q('#semGpa').textContent, '3.57', '切到「大一下」学期绩点');
    is(q('#semName').value, '大一下', '学期名正确');
    is(q('#yearGpa').textContent, '3.35', '「大一下」显示的是大一学年绩点');
    is(q('#semYear').value, '大一', '学年字段已带出');

    // ---- 5b. 点学年条跳转 ----
    YBARS()[1].click();
    is(q('#semName').value, '大二上', '点学年条跳到该学年第一个学期');
    is(q('#yearGpa').textContent, '3.31', '大二学年平均绩点');
    qa('.tab')[1].click();
    is(q('#semName').value, '大一下', '回到大一下');

    // ---- 6. 显示成绩列 / 加权均分 ----
    q('[data-act="togglescore"]').click();
    is(qa('#panel thead th').length, 6, '显示成绩列后表头列数');
    is(q('#semAvg').textContent, '86.67', '加权平均分');

    // ---- 7. 粘贴 Excel 多行（制表符）----
    var dt = new DataTransfer();
    dt.setData('text', '操作系统\\t4\\t91\\t4.0\\n编译原理\\t3\\t84\\t3.3');
    var pev = new Event('paste', { bubbles: true });
    pev.clipboardData = dt;
    q('#panel').dispatchEvent(pev);
    is(ROWS().length, 6, '粘贴后课程行数');
    var names = ROWS().map(function(tr){ return tr.querySelector('[data-f="name"]').value; });
    is(names.indexOf('操作系统') >= 0 && names.indexOf('编译原理') >= 0, true, '粘贴解析出的课程名');
    var op = ROWS()[4];
    is(op.querySelector('[data-f="credits"]').value, '4', '粘贴行学分');
    is(op.querySelector('[data-f="gpa"]').value, '4', '粘贴行绩点');

    // ---- 8. 导入弹窗：文本解析 + 追加 ----
    q('[data-act="import"]').click();
    is(q('#importModal').className.indexOf('open') >= 0, true, '弹窗打开');
    q('#rawText').value = '大学化学 3.5 88 3.7\\n大学化学实验 1 90 4.0\\n合计 4.5 178 3.8';
    q('#btnReparse').click();
    is(qa('#preview tbody tr').length, 2, '解析预览行数');
    is(q('#parseInfo').textContent.indexOf('2 行') >= 0, true, '解析提示文案');
    var before = ROWS().length;
    q('#btnAppend').click();
    is(ROWS().length, before + 2, '追加到当前学期');
    is(q('#importModal').className.indexOf('open') >= 0, false, '导入后弹窗关闭');

    // ---- 9. 成绩→绩点 ----
    q('[data-act="addrow"]').click();
    var l2 = ROWS()[ROWS().length - 1];
    var s2 = l2.querySelector('[data-f="score"]');
    s2.value = '87'; fire(s2, 'input');
    q('[data-act="convert"]').click();
    is(ROWS()[ROWS().length - 1].querySelector('[data-f="gpa"]').value, '3.7', '成绩→绩点折算写入');

    // ---- 10. 新增 / 改学年 / 删除学期 ----
    q('[data-addsem]').click();
    is(qa('.tab').length, 5, '新增第四个学期');
    is(q('#semGpa').textContent, '--', '新学期无数据');
    is(q('#semYear').value, '大二', '第 4 个学期默认学年（每两个学期一学年）');
    is(YBARS().length, 2, '新学期并入默认学年后分组数不变');
    var yi = q('#semYear');
    yi.value = '大三'; fire(yi, 'input');
    is(YBARS().length, 3, '改学年后多出一个学年分组');
    yi.value = '大二'; fire(yi, 'input');
    is(YBARS().length, 2, '改回后分组还原');
    q('[data-act="delsem"]').click();
    is(qa('.tab').length, 4, '删除学期后标签数');

    // ---- 11. 重新进入导入弹窗时应清空上次的识别记录 ----
    q('[data-act="import"]').click();
    q('#rawText').value = '大学化学 3.5 88 3.7';
    q('#btnReparse').click();
    is(qa('#preview tbody tr').length, 1, '先解析出 1 行');
    is(q('#parseInfo').textContent.indexOf('1 行') >= 0, true, '解析状态已更新');
    q('#importModal [data-close]').click();
    is(q('#importModal').className.indexOf('open') >= 0, false, '关闭导入弹窗');
    q('[data-act="import"]').click();
    is(q('#rawText').value, '', '再次进入：识别原文已清空');
    is(qa('#preview tbody tr').length, 0, '再次进入：解析预览已清空');
    is(q('#preview').className.indexOf('show') >= 0, false, '再次进入：预览区已隐藏');
    is(q('#parseInfo').textContent, '尚未解析', '再次进入：解析状态已重置');
    is(q('#ocrStatus').textContent, '', '再次进入：识别状态已清空');
    q('#importModal [data-close]').click();

    // ---- 12. 换算规则可修改 ----
    q('[data-act="rule"]').click();
    is(q('#ruleModal').className.indexOf('open') >= 0, true, '换算规则弹窗打开');
    is(qa('#ruleTable .rule-row').length, 10, '默认规则 10 档');
    is(q('#rulePreset').value, 'g40', '默认选中常用 4.0 制');
    var minIn = qa('#ruleTable [data-rf="min"]')[0];
    minIn.value = '86'; fire(minIn, 'input');
    is(q('#rulePreset').value, 'custom', '手改分档后自动切到「自定义」');
    q('#btnRuleReset').click();
    is(qa('#ruleTable .rule-row').length, 10, '恢复默认后回到 10 档');
    is(q('#rulePreset').value, 'g40', '恢复默认后预设回到常用 4.0 制');
    q('#btnAddBand').click();
    is(qa('#ruleTable .rule-row').length, 11, '添加一档');
    is(qa('#ruleTable [data-rf="min"]')[10].value, '55', '新增档默认取最低档再低 5 分');
    var dupIn = qa('#ruleTable [data-rf="min"]')[10];
    dupIn.value = '85'; fire(dupIn, 'input');
    q('#btnRuleSave').click();
    is(q('#ruleModal').className.indexOf('open') >= 0, true, '下界重复时拒绝保存');
    is(q('#toast').textContent.indexOf('重复') >= 0, true, '给出重复提示');
    q('#btnRuleReset').click();
    is(qa('#ruleTable .rule-row').length, 10, '恢复默认');
    q('#btnAddBand').click();
    var nm = qa('#ruleTable [data-rf="min"]')[10];
    nm.value = '55'; fire(nm, 'input');
    var ng = qa('#ruleTable [data-rf="gpa"]')[10];
    ng.value = '0.5'; fire(ng, 'input');
    q('#btnRuleSave').click();
    is(q('#ruleModal').className.indexOf('open') >= 0, false, '自定义规则可以保存');
    is(q('[data-act="rule"]').title.indexOf('自定义') >= 0, true, '按钮提示显示「自定义规则」');
    q('[data-act="rule"]').click();
    is(qa('#ruleTable .rule-row').length, 11, '重开弹窗带出自定义规则');
    is(q('#rulePreset').value, 'custom', '自定义规则对应「自定义」选项');
    var sel = q('#rulePreset');
    sel.value = 'g40x'; fire(sel, 'change');
    is(qa('#ruleTable .rule-row').length, 5, '套用「严格 4.0 制」预设');
    is(q('#rulePreview').textContent.indexOf('88→4') >= 0, true, '预览随规则变化');
    q('#btnRuleSave').click();
    is(q('#ruleModal').className.indexOf('open') >= 0, false, '保存后弹窗关闭');
    is(q('[data-act="rule"]').title.indexOf('严格') >= 0, true, '按钮提示已显示新规则名');
    q('[data-act="addrow"]').click();
    var lr = ROWS()[ROWS().length - 1];
    var sc = lr.querySelector('[data-f="score"]');
    sc.value = '88'; fire(sc, 'input');
    q('[data-act="convert"]').click();
    is(ROWS()[ROWS().length - 1].querySelector('[data-f="gpa"]').value, '4', '88 分按严格 4.0 制折算成 4.0（默认规则是 3.7）');
    is(q('#toast').textContent.indexOf('严格') >= 0, true, '折算提示里带上规则名');

    // ---- 13. 数据持久化（等待 250ms 防抖写入）----
    setTimeout(function(){
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem('gpa_calculator_v1')); } catch(e){}
      is(!!(saved && saved.semesters && saved.semesters.length === 3), true, '数据已写入 localStorage');
      is(saved && saved.showScore === true, true, '显示成绩列的偏好被记住');
      is(!!(saved && saved.semesters[0].year === '大一' && saved.semesters[2].year === '大二'), true, '学年分组被保存');
      is(!!(saved && saved.gpaRule && saved.gpaRule.name === '严格 4.0 制（85 才满绩）'), true, '换算规则被保存');
      finish();
    }, 700);

  } catch (e) {
    fail++; log.push('EXCEPTION: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]);
    finish();
  }
});
<\/script>
`;

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const page = path.join(TMP, 'integration.html');
  const patched = html.replace('</body>', HARNESS + '</body>');
  if (patched === html) throw new Error('无法注入测试脚本（index.html 结构变了？）');
  fs.writeFileSync(page, patched, 'utf8');

  let out = null;
  let runner = null;
  try {
    runner = await openPage(page);
    console.log('浏览器: ' + runner.browser);
    out = await runner.waitForText('#TESTOUT', 90000);
  } finally {
    if (runner) runner.close();
  }

  console.log(out);
  const m = out.match(/失败\s+(\d+)\s+项/);
  process.exit(m && Number(m[1]) === 0 ? 0 : 1);
})().catch(err => {
  console.error('集成测试执行失败: ' + err.message);
  process.exit(1);
});
