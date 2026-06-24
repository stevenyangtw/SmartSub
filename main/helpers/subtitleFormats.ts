/**
 * 字幕格式編解碼模塊（零依賴，純函數，便於單元測試）。
 *
 * 統一支持常見字幕格式的解析（導入）與序列化（導出）：
 *   - srt：SubRip，應用內部規範格式
 *   - vtt：WebVTT
 *   - ass/ssa：Advanced SubStation Alpha
 *   - lrc：歌詞格式（僅有起始時間）
 *   - txt：純文本（無時間軸，僅用於導出）
 *
 * 設計要點：
 *   - 內部統一用毫秒（ms）表示時間，避免各格式時間精度差異導致的累積誤差。
 *   - 解析結果對齊應用既有的 Subtitle 模型 { id, startEndTime, content[] }，
 *     其中 startEndTime 始終是 SRT 風格字符串，保證下游（播放器/校對/合併）無需改動取值方式。
 *   - 同時提供「整文件序列化」與「逐條追加序列化」兩套接口，
 *     以兼容翻譯流程邊翻譯邊寫入（流式追加）的既有實現。
 */

export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'lrc' | 'txt';

export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string; // 多行以 \n 連接
}

// 與應用既有 Subtitle 模型結構兼容（main/translate/types、renderer/hooks/useSubtitles）
export interface SubtitleEntry {
  id: string;
  startEndTime: string;
  content: string[];
}

export const SUPPORTED_SUBTITLE_FORMATS: SubtitleFormat[] = [
  'srt',
  'vtt',
  'ass',
  'lrc',
  'txt',
];

// 可作為「導入」來源的格式（txt 無時間軸，不支持導入）
export const IMPORTABLE_SUBTITLE_FORMATS: SubtitleFormat[] = [
  'srt',
  'vtt',
  'ass',
  'lrc',
];

const EXT_TO_FORMAT: Record<string, SubtitleFormat> = {
  '.srt': 'srt',
  '.vtt': 'vtt',
  '.ass': 'ass',
  '.ssa': 'ass',
  '.lrc': 'lrc',
  '.txt': 'txt',
};

const FORMAT_TO_EXT: Record<SubtitleFormat, string> = {
  srt: '.srt',
  vtt: '.vtt',
  ass: '.ass',
  lrc: '.lrc',
  txt: '.txt',
};

/** 根據文件路徑/擴展名推斷字幕格式，未知時回退為 srt。 */
export function detectSubtitleFormat(filePath: string): SubtitleFormat {
  const match = /\.[^.\\/]+$/.exec(filePath || '');
  const ext = match ? match[0].toLowerCase() : '';
  return EXT_TO_FORMAT[ext] || 'srt';
}

/** 獲取某格式對應的文件擴展名（含點）。 */
export function getFormatExtension(format: SubtitleFormat): string {
  return FORMAT_TO_EXT[format] || '.srt';
}

export function isSupportedSubtitleFormat(
  format: string,
): format is SubtitleFormat {
  return (SUPPORTED_SUBTITLE_FORMATS as string[]).includes(format);
}

// ----------------------------- 時間處理 -----------------------------

function pad(n: number, len = 2): string {
  return String(Math.max(0, Math.floor(n))).padStart(len, '0');
}

interface TimeParts {
  h: number;
  m: number;
  s: number;
  ms: number;
}

function splitMs(input: number): TimeParts {
  let ms = Math.max(0, Math.round(input));
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  return { h, m, s, ms };
}

/**
 * 將各種字幕時間字符串解析為毫秒。
 * 支持：HH:MM:SS,mmm | HH:MM:SS.mmm | H:MM:SS.cc(ASS 釐秒) | MM:SS.xx | [mm:ss.xx](LRC)
 */
export function parseTimeToMs(raw: string): number {
  if (!raw) return 0;
  let s = raw.trim();
  // 去除 LRC 方括號
  s = s.replace(/^\[/, '').replace(/\]$/, '');
  // 逗號統一成點
  s = s.replace(',', '.');
  const parts = s.split(':');
  let h = 0;
  let m = 0;
  let sec = 0;
  if (parts.length === 3) {
    h = parseInt(parts[0], 10) || 0;
    m = parseInt(parts[1], 10) || 0;
    sec = parseFloat(parts[2]) || 0;
  } else if (parts.length === 2) {
    m = parseInt(parts[0], 10) || 0;
    sec = parseFloat(parts[1]) || 0;
  } else {
    sec = parseFloat(parts[0]) || 0;
  }
  return Math.round((h * 3600 + m * 60 + sec) * 1000);
}

export function formatSrtTime(ms: number): string {
  const t = splitMs(ms);
  return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)},${pad(t.ms, 3)}`;
}

export function formatVttTime(ms: number): string {
  const t = splitMs(ms);
  return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}.${pad(t.ms, 3)}`;
}

export function formatAssTime(ms: number): string {
  const t = splitMs(ms);
  const cs = Math.floor(t.ms / 10); // ASS 使用釐秒
  return `${t.h}:${pad(t.m)}:${pad(t.s)}.${pad(cs, 2)}`;
}

export function formatLrcTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${pad(minutes)}:${pad(seconds)}.${pad(cs, 2)}`;
}

/** 解析 "HH:MM:SS,mmm --> HH:MM:SS,mmm" 形式的起止時間。 */
export function parseStartEndTime(startEndTime: string): {
  startMs: number;
  endMs: number;
} {
  const parts = (startEndTime || '').split('-->');
  return {
    startMs: parseTimeToMs(parts[0] || ''),
    endMs: parseTimeToMs(parts[1] || ''),
  };
}

/** 生成 SRT 風格的起止時間字符串（應用內部規範）。 */
export function toSrtTimeRange(startMs: number, endMs: number): string {
  return `${formatSrtTime(startMs)} --> ${formatSrtTime(endMs)}`;
}

// ----------------------------- 解析（導入） -----------------------------

const TIMING_LINE_REGEX = /-->/;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeLineEndings(text: string): string {
  return stripBom(text).replace(/\r\n?/g, '\n');
}

/** 解析 SRT / VTT（兩者塊結構一致，時間分隔符不同，統一處理）。 */
function parseSrtVtt(content: string): SubtitleCue[] {
  let text = normalizeLineEndings(content);
  // 去除 VTT 頭部（WEBVTT 行及其後元數據，直到首個空行）
  if (/^WEBVTT/.test(text)) {
    const firstBlank = text.indexOf('\n\n');
    text = firstBlank >= 0 ? text.slice(firstBlank + 2) : '';
  }
  const blocks = text.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    // VTT 的 NOTE / STYLE / REGION 塊跳過
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const timingIndex = lines.findIndex((l) => TIMING_LINE_REGEX.test(l));
    if (timingIndex === -1) continue;
    const timingLine = lines[timingIndex];
    const [startPart, endPartRaw] = timingLine.split('-->');
    if (endPartRaw === undefined) continue;
    // VTT 時間行尾部可能帶 cue setting（如 align:start position:50%），取第一個時間 token
    const endPart = endPartRaw.trim().split(/\s+/)[0];
    const startMs = parseTimeToMs(startPart);
    const endMs = parseTimeToMs(endPart);
    const textLines = lines.slice(timingIndex + 1);
    if (textLines.length === 0) continue;
    cues.push({ startMs, endMs, text: textLines.join('\n') });
  }
  return cues;
}

/** 清理 ASS 文本中的覆蓋標籤與轉義。 */
function cleanAssText(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '') // 覆蓋標籤 {\...}
    .replace(/\\N/gi, '\n') // 硬換行
    .replace(/\\h/g, ' ') // 硬空格
    .trim();
}

function parseAss(content: string): SubtitleCue[] {
  const lines = normalizeLineEndings(content).split('\n');
  const cues: SubtitleCue[] = [];
  let inEvents = false;
  let formatFields: string[] = [];
  let idxStart = -1;
  let idxEnd = -1;
  let idxText = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[.*\]$/.test(trimmed)) {
      inEvents = /^\[events\]$/i.test(trimmed);
      continue;
    }
    if (!inEvents) continue;

    if (/^Format\s*:/i.test(trimmed)) {
      formatFields = trimmed
        .slice(trimmed.indexOf(':') + 1)
        .split(',')
        .map((f) => f.trim().toLowerCase());
      idxStart = formatFields.indexOf('start');
      idxEnd = formatFields.indexOf('end');
      idxText = formatFields.indexOf('text');
      continue;
    }

    if (/^Dialogue\s*:/i.test(trimmed)) {
      if (idxText === -1) continue; // 沒有 Format 行無法解析
      const body = trimmed.slice(trimmed.indexOf(':') + 1);
      // 文本字段是最後一個且可能包含逗號，因此按字段數限制切分
      const parts = splitWithLimit(body, ',', formatFields.length);
      const startMs = parseTimeToMs(parts[idxStart] || '');
      const endMs = parseTimeToMs(parts[idxEnd] || '');
      const text = cleanAssText(parts[idxText] || '');
      if (!text) continue;
      cues.push({ startMs, endMs, text });
    }
  }
  return cues;
}

/** 按分隔符切分為最多 limit 段，最後一段保留剩餘所有內容（含分隔符）。 */
function splitWithLimit(str: string, sep: string, limit: number): string[] {
  if (limit <= 0) return [str];
  const result: string[] = [];
  let rest = str;
  for (let i = 0; i < limit - 1; i++) {
    const idx = rest.indexOf(sep);
    if (idx === -1) {
      result.push(rest);
      rest = '';
      return result;
    }
    result.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  result.push(rest);
  return result;
}

function parseLrc(content: string): SubtitleCue[] {
  const lines = normalizeLineEndings(content).split('\n');
  const tagRegex = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
  let offsetMs = 0;
  const entries: { startMs: number; text: string }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // offset 元數據
    const offsetMatch = /^\[offset:\s*([+-]?\d+)\s*\]$/i.exec(trimmed);
    if (offsetMatch) {
      offsetMs = parseInt(offsetMatch[1], 10) || 0;
      continue;
    }
    // 跳過其它純元數據標籤，如 [ar:] [ti:] [al:] [by:] [length:]
    if (/^\[[a-z]+:.*\]$/i.test(trimmed)) continue;

    tagRegex.lastIndex = 0;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = tagRegex.exec(trimmed)) !== null) {
      const min = parseInt(m[1], 10) || 0;
      const sec = parseFloat(m[2].replace(':', '.')) || 0;
      times.push(min * 60000 + Math.round(sec * 1000));
    }
    if (times.length === 0) continue;
    const lyric = trimmed.replace(tagRegex, '').trim();
    for (const t of times) {
      entries.push({ startMs: t, text: lyric });
    }
  }

  entries.sort((a, b) => a.startMs - b.startMs);
  const cues: SubtitleCue[] = [];
  for (let i = 0; i < entries.length; i++) {
    const startMs = Math.max(0, entries[i].startMs + offsetMs);
    const endMs =
      i + 1 < entries.length
        ? Math.max(startMs, entries[i + 1].startMs + offsetMs)
        : startMs + 4000; // 末行給一個預設時長
    if (entries[i].text === '') continue;
    cues.push({ startMs, endMs, text: entries[i].text });
  }
  return cues;
}

/** 將字幕內容解析為時間軸 cue 列表。 */
export function parseSubtitleCues(
  content: string,
  format: SubtitleFormat,
): SubtitleCue[] {
  switch (format) {
    case 'ass':
      return parseAss(content);
    case 'lrc':
      return parseLrc(content);
    case 'txt':
      return []; // 純文本無時間軸，不支持導入
    case 'srt':
    case 'vtt':
    default:
      return parseSrtVtt(content);
  }
}

/** 將字幕內容解析為應用內部的 Subtitle 列表。 */
export function parseSubtitleEntries(
  content: string,
  format: SubtitleFormat,
): SubtitleEntry[] {
  const cues = parseSubtitleCues(content, format);
  return cues.map((cue, index) => ({
    id: String(index + 1),
    startEndTime: toSrtTimeRange(cue.startMs, cue.endMs),
    content: cue.text.split('\n'),
  }));
}

// ----------------------------- 序列化（導出） -----------------------------

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
Collisions: Normal
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,30,30,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

/** 文件頭（僅 vtt/ass 需要），用於流式追加寫入前先寫頭部。 */
export function getSubtitleFileHeader(format: SubtitleFormat): string {
  if (format === 'vtt') return 'WEBVTT\n\n';
  if (format === 'ass') return ASS_HEADER;
  return '';
}

/** 序列化單條 cue（用於流式追加寫入）。 */
export function serializeCue(
  cue: { id?: string; startMs: number; endMs: number; text: string },
  format: SubtitleFormat,
): string {
  const text = (cue.text || '').trim();
  switch (format) {
    case 'vtt':
      return `${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.endMs)}\n${text}\n\n`;
    case 'ass':
      return `Dialogue: 0,${formatAssTime(cue.startMs)},${formatAssTime(
        cue.endMs,
      )},Default,,0,0,0,,${text.replace(/\n/g, '\\N')}\n`;
    case 'lrc':
      return `[${formatLrcTime(cue.startMs)}]${text.replace(/\n/g, ' ')}\n`;
    case 'txt':
      return `${text}\n\n`;
    case 'srt':
    default:
      return `${cue.id ?? ''}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(
        cue.endMs,
      )}\n${text}\n\n`;
  }
}

/** 整文件序列化 cue 列表。 */
export function serializeSubtitleCues(
  cues: SubtitleCue[],
  format: SubtitleFormat,
): string {
  const header = getSubtitleFileHeader(format);
  const body = cues
    .map((cue, index) =>
      serializeCue({ ...cue, id: String(index + 1) }, format),
    )
    .join('');
  return header + body;
}

/**
 * 將「已渲染好文本」的條目列表序列化為目標格式整文件。
 * 用於導出已合併好的（含雙語）字幕。
 */
export function serializeSubtitleEntries(
  entries: { id?: string; startEndTime: string; text: string }[],
  format: SubtitleFormat,
): string {
  const header = getSubtitleFileHeader(format);
  const body = entries
    .map((entry, index) => {
      const { startMs, endMs } = parseStartEndTime(entry.startEndTime);
      return serializeCue(
        { id: entry.id ?? String(index + 1), startMs, endMs, text: entry.text },
        format,
      );
    })
    .join('');
  return header + body;
}

/** 在不同字幕格式之間轉換整文件內容。 */
export function convertSubtitleContent(
  content: string,
  fromFormat: SubtitleFormat,
  toFormat: SubtitleFormat,
): string {
  const cues = parseSubtitleCues(content, fromFormat);
  return serializeSubtitleCues(cues, toFormat);
}
