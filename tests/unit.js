'use strict';
/*
 * 单元测试：直接从 index.html 里抽出解析模块与统计函数，在 Node 里跑断言。
 * 不依赖浏览器，也不依赖任何 npm 包。
 *
 *   node tests/unit.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { APP } = require('./lib');

const html = fs.readFileSync(APP, 'utf8');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- 1. 内联脚本语法检查 ---------- */
const sm = html.match(/<script>([\s\S]*?)<\/script>/);
if (!sm) { console.log('FAIL: index.html 里找不到内联脚本'); process.exit(1); }
try {
  new vm.Script(sm[1]);
  pass++; console.log('PASS 脚本语法检查 (' + sm[1].split('\n').length + ' 行)');
} catch (e) {
  fail++; console.log('FAIL 脚本语法错误: ' + e.message);
}

/* ---------- 2. 抽出解析模块 ---------- */
const pm = html.match(/\/\* ==PARSER_START== \*\/([\s\S]*?)\/\* ==PARSER_END== \*\//);
if (!pm) { console.log('FAIL: 找不到解析模块（==PARSER_START== 标记）'); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(pm[1], ctx);
const { parseScoreText, parseTableText, cleanCourseName, classifyNumbers, scoreToGpa, normalizeDigits,
        gpaFromBands, setActiveBands, RULE_PRESETS } = ctx;

/* ---------- 3. 工具函数 ---------- */
console.log('\n-- 工具函数 --');
ok(scoreToGpa(92) === 4.0 && scoreToGpa(86) === 3.7 && scoreToGpa(83) === 3.3 && scoreToGpa(59) === 0, 'scoreToGpa 折算');
ok(normalizeDigits('１２３．５') === '123.5', '全角数字归一化', normalizeDigits('１２３．５'));

/* ---------- 3b. 可自定义的换算规则 ---------- */
console.log('\n-- 换算规则 --');
ok(RULE_PRESETS.length >= 4, '内置预设数量', RULE_PRESETS.length);
const strict = [{ min: 85, gpa: 4.0 }, { min: 75, gpa: 3.0 }, { min: 60, gpa: 1.0 }, { min: 0, gpa: 0 }];
ok(gpaFromBands(90, strict) === 4.0 && gpaFromBands(84, strict) === 3.0 && gpaFromBands(70, strict) === 1.0, '自定义规则匹配');
ok(gpaFromBands(90, [{ min: 0, gpa: 0 }, { min: 85, gpa: 4.0 }]) === 4.0, '乱序分档也能正确匹配（内部会排序）');
ok(gpaFromBands(50, strict) === 0 && gpaFromBands(null, strict) === null, '低于最低档记 0 / 空分数返回 null');
setActiveBands(strict);
ok(scoreToGpa(88) === 4.0 && scoreToGpa(80) === 3.0, '切换规则后 scoreToGpa 跟着变');
const parseStrict = parseScoreText('大学化学 3 88 4.0\n大学物理 4 70');
ok(parseStrict[1].gpa === 1.0, '解析时缺绩点按当前规则折算', parseStrict[1]);
setActiveBands(RULE_PRESETS[0].bands);
ok(scoreToGpa(88) === 3.7, '恢复默认规则');

ok(cleanCourseName('1 高等数学(上) 必修') === '高等数学(上)', '清理序号与课程性质', cleanCourseName('1 高等数学(上) 必修'));
ok(cleanCourseName('工程实践') === '工程实践', '不误删「工程实践」', cleanCourseName('工程实践'));
ok(eq(classifyNumbers([5, 92, 4.0]), { credits: 5, gpa: 4, score: 92, warn: false }), '三段数字分类', classifyNumbers([5, 92, 4.0]));
ok(eq(classifyNumbers([3, 3.7]), { credits: 3, gpa: 3.7, score: null, warn: false }), '学分+绩点', classifyNumbers([3, 3.7]));

/* ---------- 4. OCR 文本解析 ---------- */
console.log('\n-- OCR 文本解析 --');
const ocr = [
  '课程名称        学分   成绩   绩点',
  '1 高等数学(上)    5.0    92    4.0',
  '2 大学英语(一)     3     86    3.7',
  '3 工程图学        2.5    83',
  '4 体育            1     优秀',
  '5 线性代数        3.0    95    4.0',
  '合计             14.5   356    3.9',
  '---------------- 第 1 页 ----------------'
].join('\n');
const rows = parseScoreText(ocr);
ok(rows.length === 5, '解析出 5 门课（表头/合计/页码被忽略）', rows.map(r => r.name));
ok(rows[0].name === '高等数学(上)' && rows[0].credits === 5 && rows[0].gpa === 4 && rows[0].score === 92, '第 1 行正确', rows[0]);
ok(rows[1].name === '大学英语(一)' && rows[1].credits === 3 && rows[1].gpa === 3.7, '第 2 行正确', rows[1]);
ok(rows[2].name === '工程图学' && rows[2].gpa === 3.3 && rows[2].warn === true, '缺绩点时按成绩折算并标记待核对', rows[2]);
ok(rows[3].name === '体育' && rows[3].gpa === 4.0 && rows[3].scoreLabel === '优', '五级制「优秀」→4.0', rows[3]);
ok(rows[4].name === '线性代数' && rows[4].gpa === 4, '第 5 行正确', rows[4]);

const full = parseScoreText('大学物理　４　７９　３.０');
ok(full.length === 1 && full[0].credits === 4 && full[0].score === 79 && full[0].gpa === 3, '全角数字 + 全角空格', full[0]);
const two = parseScoreText('数据结构 3 3.5');
ok(two.length === 1 && two[0].credits === 3 && two[0].gpa === 3.5 && two[0].score === null, '仅学分+绩点', two[0]);
const dup = parseScoreText('高等数学 5 92 4.0\n高等数学 5 92 4.0');
ok(dup.length === 1, '重复行去重', dup.length);
const empty = parseScoreText('第一学期\n学号 2024001\n共 10 门');
ok(empty.length === 0, '无关行不产生课程', empty);

/* ---------- 5. 真实 OCR 输出回归（取自无头 Chrome 端到端测试的实际识别结果）---------- */
console.log('\n-- 真实 OCR 文本回归 --');
const realOcr = [
  '课程 名 称 学 分 ”成 绩 绩 点',
  '高 等 数学 (上 ) 5.0 92 4.0',
  '大 学 英语 (一 ) 3.0 86 3.7',
  '线性 代数 3.0 95 4.0',
  '大 学 物理 4.0 79 3.0',
  '程序 设计 基础 3.0 88 3.7'
].join('\n');
const ro = parseScoreText(realOcr);
ok(ro.length === 5, '真实 OCR 文本解析出 5 门课', ro.map(r => r.name));
ok(ro[0].name === '高等数学(上)', 'OCR 字间空格被还原：高等数学(上)', ro[0].name);
ok(ro[1].name === '大学英语(一)' && ro[1].credits === 3 && ro[1].gpa === 3.7 && ro[1].score === 86, '大学英语(一) 完整', ro[1]);
ok(ro[2].name === '线性代数' && ro[3].name === '大学物理' && ro[4].name === '程序设计基础', '其余课程名还原', ro.map(r => r.name));
const roGpa = ro.reduce((a, r) => a + r.credits * r.gpa, 0) / ro.reduce((a, r) => a + r.credits, 0);
ok(Math.abs(roGpa - 3.6778) < 0.001, 'OCR 结果总平均绩点 3.68', roGpa);

/* ---------- 6. Excel / 网页表格粘贴 ---------- */
console.log('\n-- Excel / 网页表格粘贴 --');
const tsv = ['课程名称\t学分\t成绩\t绩点', '高等数学\t5\t92\t4.0', '大学英语\t3\t86', '体育\t1\t优'].join('\n');
const tr = parseTableText(tsv);
ok(tr.length === 3, 'TSV 解析出 3 行', tr.length);
ok(tr[0].name === '高等数学' && tr[0].credits === 5 && tr[0].gpa === 4, 'TSV 第 1 行', tr[0]);
ok(tr[1].name === '大学英语' && tr[1].credits === 3 && tr[1].gpa === 3.7, 'TSV 缺绩点时折算', tr[1]);
ok(tr[2].name === '体育' && tr[2].gpa === 4, 'TSV 五级制', tr[2]);

/* ---------- 7. 绩点统计 ---------- */
console.log('\n-- 绩点统计 --');
function grab(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到函数: ' + name);
  const i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('括号不匹配: ' + name);
}
vm.runInContext(grab(html, 'semStats') + '\n' + grab(html, 'aggregate'), ctx);
const semA = { courses: [
  { credits: 5, gpa: 4.0, score: 92, counted: true },
  { credits: 3, gpa: 3.0, score: 80, counted: true },
  { credits: 2, gpa: 5.0, score: 100, counted: false },   // 不计入
  { credits: 4, gpa: null, score: null, counted: true }   // 缺绩点
]};
const stA = ctx.semStats(semA);
ok(stA.credits === 12, '学分合计（含缺绩点课）', stA.credits);
ok(Math.abs(stA.gpa - 3.625) < 1e-9, '学期绩点只按有绩点的学分加权', stA.gpa);
ok(Math.abs(stA.avg - 87.5) < 1e-9, '加权均分', stA.avg);
ok(stA.missing === 1 && stA.count === 3, '缺绩点计数 / 计入门数', [stA.missing, stA.count]);

const semB = { courses: [{ credits: 2, gpa: 4.5, score: 90, counted: true }] };
const all = ctx.aggregate([semA, semB]);
ok(Math.abs(all.gpa - (5 * 4 + 3 * 3 + 2 * 4.5) / (5 + 3 + 2)) < 1e-9, '总平均绩点 = Σ(学分×绩点)/Σ学分', all.gpa);
ok(all.credits === 14 && all.count === 4, '总学分 / 总门数', [all.credits, all.count]);
ok(ctx.aggregate([{ courses: [] }]).gpa === null, '空数据返回 null（界面显示 --）');

console.log('\n=========================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
