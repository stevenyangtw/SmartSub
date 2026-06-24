/**
 * 內封軟字幕：純解析邏輯（無 ffmpeg / 無 electron 依賴，便於單測）。
 * 僅負責：容器擴展名預過濾、ffmpeg stderr 字幕流解析、SRT 是否含字幕塊判定。
 */

export interface EmbeddedSubtitleStream {
  /** 字幕流相對序號（第幾條 Subtitle 行，從 0 起），用於 ffmpeg -map 0:s:N */
  subIndex: number;
  /** 小寫編碼名，如 subrip / ass / mov_text / hdmv_pgs_subtitle */
  codec: string;
  /** 語言標籤（如 eng / chi）；缺失或 und 時為 undefined */
  language?: string;
  /** 是否為可直接轉 SRT 的文本字幕 */
  isText: boolean;
  isDefault: boolean;
  isForced: boolean;
}

/** 可能內封文本軟字幕的容器擴展名（不含點、小寫） */
export const EMBEDDED_SUBTITLE_CONTAINERS = new Set([
  'mkv',
  'webm',
  'mp4',
  'm4v',
  'mov',
  'ts',
  'm2ts',
  'mts',
  'ogm',
  'ogv',
]);

/** 可直接 -c:s srt 轉寫的文本字幕編碼 */
export const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'mov_text',
  'webvtt',
  'text',
]);

/** 擴展名預過濾：僅對可能內封字幕的容器才值得 spawn 探測 */
export function canHaveEmbeddedSubtitle(ext: string): boolean {
  if (!ext) return false;
  return EMBEDDED_SUBTITLE_CONTAINERS.has(ext.replace(/^\./, '').toLowerCase());
}

const SUBTITLE_LINE =
  /Stream #\d+:(\d+)(?:\[0x[0-9a-fA-F]+\])?(?:\(([^)]*)\))?:\s*Subtitle:\s*([A-Za-z0-9_]+)/;

/** 解析 `ffmpeg -i` 的 stderr，按出現順序返回所有字幕流信息 */
export function parseSubtitleStreams(stderr: string): EmbeddedSubtitleStream[] {
  const streams: EmbeddedSubtitleStream[] = [];
  const lines = (stderr || '').split(/\r?\n/);
  let subIndex = 0;
  for (const line of lines) {
    const m = line.match(SUBTITLE_LINE);
    if (!m) continue;
    const lang = m[2];
    const codec = m[3].toLowerCase();
    streams.push({
      subIndex,
      codec,
      language: lang && lang !== 'und' ? lang : undefined,
      isText: TEXT_SUBTITLE_CODECS.has(codec),
      isDefault: /\(default\)/.test(line),
      isForced: /\(forced\)/.test(line),
    });
    subIndex++;
  }
  return streams;
}

/** SRT 是否至少含一條字幕塊（用時間碼箭頭判定，空/全空白為 false） */
export function srtHasCues(content: string): boolean {
  if (!content) return false;
  return /-->/.test(content);
}
