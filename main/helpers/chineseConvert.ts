/**
 * 中文簡繁自動歸一：當源語言為中文時，把「轉寫生成」的字幕統一成期望字形。
 *
 * 背景：Whisper 的 `zh` 不區分簡/繁，簡繁由模型解碼傾向決定（tiny/base 強烈傾向繁體），
 * initial_prompt 又壓不住。此處用純 JS 的 opencc-js（詞組級，無原生依賴）做確定性後處理。
 * 僅當檢測到「相反字形」時才實際轉換（轉換前後不同即命中），避免無謂改寫。
 */
import { Converter } from 'opencc-js';

export type ChineseScript = 'simplified' | 'traditional';

type ConvertFn = (text: string) => string;

let t2sConverter: ConvertFn | null = null;
let s2tConverter: ConvertFn | null = null;

/** 繁（OpenCC 標準）→ 簡（大陸）。惰性創建並緩存。 */
function getT2S(): ConvertFn {
  if (!t2sConverter) t2sConverter = Converter({ from: 't', to: 'cn' });
  return t2sConverter;
}

/** 簡（大陸）→ 繁（OpenCC 標準）。惰性創建並緩存。 */
function getS2T(): ConvertFn {
  if (!s2tConverter) s2tConverter = Converter({ from: 'cn', to: 't' });
  return s2tConverter;
}

/**
 * 由源語言代碼推斷期望中文字形：
 * - `zh` / `zh-CN` / `zh-Hans` → 'simplified'
 * - `zh-Hant` / `zh-TW` / `zh-HK` → 'traditional'
 * - 其它（含 `auto`、`yue` 粵語、非中文）→ null（不自動轉換）
 */
export function getDesiredChineseScript(lang?: string): ChineseScript | null {
  if (!lang) return null;
  const c = lang.toLowerCase();
  if (!c.startsWith('zh')) return null;
  if (c.includes('hant') || c.includes('tw') || c.includes('hk')) {
    return 'traditional';
  }
  return 'simplified';
}

/**
 * 按期望字形轉換文本；僅當結果與原文不同（即檢測到相反字形）時標記 converted。
 * 對 SRT 全文安全：序號/時間碼/`-->` 均為 ASCII，OpenCC 不會改動。
 */
export function convertChineseText(
  text: string,
  desired: ChineseScript,
): { text: string; converted: boolean } {
  if (!text) return { text, converted: false };
  const convert = desired === 'simplified' ? getT2S() : getS2T();
  const out = convert(text);
  return { text: out, converted: out !== text };
}

/**
 * 需要被替換為空格的中文/全角標點集合（issue #330）。
 *
 * 僅收錄 CJK/全角標點，刻意不含 ASCII 逗號/句號，避免誤傷數字（1,000 / 3.14）、
 * 縮寫、英文混排等。涵蓋：逗號、句號、頓號、問號、歎號、分號、冒號、省略號、
 * 間隔號、各類引號/括號/書名號、破折號/波浪號等，儘量把成對標點一併清理。
 */
const CJK_PUNCTUATION_CHARS = [
  '\u3000', // 　 表意空格
  '\u3001', // 、 頓號
  '\u3002', // 。 句號
  '\u3003', // 〃 同上符號
  '\u3008',
  '\u3009', // 〈 〉
  '\u300A',
  '\u300B', // 《 》
  '\u300C',
  '\u300D', // 「 」
  '\u300E',
  '\u300F', // 『 』
  '\u3010',
  '\u3011', // 【 】
  '\u3014',
  '\u3015', // 〔 〕
  '\u3016',
  '\u3017', // 〖 〗
  '\u3018',
  '\u3019', // 〘 〙
  '\u301A',
  '\u301B', // 〚 〛
  '\u301C', // 〜 波浪線
  '\u301D',
  '\u301E',
  '\u301F', // 〝 〞 〟 引號
  '\u3030', // 〰 波浪線
  '\uFF01', // ！
  '\uFF02', // ＂
  '\uFF03', // ＃
  '\uFF05', // ％
  '\uFF06', // ＆
  '\uFF07', // ＇
  '\uFF08',
  '\uFF09', // （ ）
  '\uFF0A', // ＊
  '\uFF0C', // ，
  '\uFF0E', // ．
  '\uFF0F', // ／
  '\uFF1A', // ：
  '\uFF1B', // ；
  '\uFF1F', // ？
  '\uFF20', // ＠
  '\uFF3B',
  '\uFF3C',
  '\uFF3D', // ［ ＼ ］
  '\uFF3E', // ＾
  '\uFF40', // ｀
  '\uFF5B',
  '\uFF5C',
  '\uFF5D',
  '\uFF5E', // ｛ ｜ ｝ ～
  '\uFF5F',
  '\uFF60', // ｟ ｠
  '\uFF62',
  '\uFF63', // ｢ ｣ 半角書名號
  '\uFF64', // ､ 半角頓號
  '\uFF65', // ･ 半角間隔號
  '\u00B7', // · 間隔號
  '\u2010',
  '\u2011',
  '\u2012',
  '\u2013',
  '\u2014',
  '\u2015', // 各類連接/破折號
  '\u2018',
  '\u2019', // ‘ ’
  '\u201C',
  '\u201D', // “ ”
  '\u2026', // … 省略號
  '\u2027', // ‧ 連點
  '\u2022', // • 項目符號
  '\u2236', // ∶ 比號（常被當作冒號）
  '\uFE10',
  '\uFE11',
  '\uFE12',
  '\uFE13',
  '\uFE14',
  '\uFE15',
  '\uFE16',
  '\uFE17',
  '\uFE18',
  '\uFE19', // 豎排標點
  '\uFE30',
  '\uFE31',
  '\uFE32',
  '\uFE33', // 豎排連接號
  '\uFE4F', // ﹏ 波浪下劃線
].join('');

const CJK_PUNCTUATION_REGEX = new RegExp(`[${CJK_PUNCTUATION_CHARS}]`, 'g');
// 替換標點後留下的空白（不含換行）壓縮與行首尾修剪
const INLINE_SPACE_RUN_REGEX = /[^\S\r\n]{2,}/g;
const LINE_EDGE_SPACE_REGEX = /^[^\S\r\n]+|[^\S\r\n]+$/g;

/**
 * 把中文/全角標點替換為空格，並清理由此產生的多餘空白（issue #330）。
 *
 * 逐行處理：標點→空格 → 合併連續空白（保留換行）→ 去行首尾空格。
 * 僅作用於傳入的文本（調用方應只傳譯文內容，勿含序號/時間碼）。
 */
export function removeChineseSubtitlePunctuation(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(CJK_PUNCTUATION_REGEX, ' ')
        .replace(INLINE_SPACE_RUN_REGEX, ' ')
        .replace(LINE_EDGE_SPACE_REGEX, ''),
    )
    .join('\n');
}
