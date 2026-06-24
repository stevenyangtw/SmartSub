/**
 * 字幕合併核心邏輯
 * 使用 fluent-ffmpeg 實現字幕燒錄到影片
 */

import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { logMessage } from './storeManager';
import { timemarkToSeconds } from './fileUtils';
import type {
  SubtitleStyle,
  MergeConfig,
  MergeProgress,
  VideoInfo,
  SubtitleAlignment,
} from '../../types/subtitleMerge';
import { VIDEO_QUALITY_CRF } from '../../types/subtitleMerge';

// 設置 ffmpeg 路徑
const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
ffmpeg.setFfmpegPath(ffmpegPath);

/** 取消哨兵：渲染層據此把取消與真實錯誤區分開 */
export const MERGE_CANCELLED = 'MERGE_CANCELLED';

// 合成同時只有一個（UI 在處理中禁用入口），單例引用即可
let currentMergeCommand: ReturnType<typeof ffmpeg> | null = null;
let mergeCancelled = false;

/** 取消當前合成：kill ffmpeg；error 回調裡完成半成品清理 */
export function cancelCurrentMerge(): boolean {
  if (!currentMergeCommand) return false;
  mergeCancelled = true;
  try {
    currentMergeCommand.kill('SIGKILL');
    logMessage('字幕合成已被用戶取消', 'warning');
    return true;
  } catch (error) {
    logMessage(`取消合成失敗: ${error}`, 'warning');
    return false;
  }
}

/**
 * 將前端 numpad 風格的 Alignment 轉換為 ASS/SSA 格式
 *
 * 前端 numpad 風格 (我們使用的):
 * 7=左上, 8=中上, 9=右上
 * 4=左中, 5=居中, 6=右中
 * 1=左下, 2=中下, 3=右下
 *
 * ASS/SSA 格式 (FFmpeg libass 使用的):
 * 底部行: 1=左下, 2=中下, 3=右下
 * 中間行: 9=左中, 10=居中, 11=右中
 * 頂部行: 5=左上, 6=中上, 7=右上
 */
function convertAlignment(numpadAlignment: SubtitleAlignment): number {
  const alignmentMap: Record<SubtitleAlignment, number> = {
    // 底部行 (保持不變)
    1: 1, // 左下 -> 1
    2: 2, // 中下 -> 2
    3: 3, // 右下 -> 3
    // 中間行
    4: 9, // 左中 -> 9
    5: 10, // 居中 -> 10
    6: 11, // 右中 -> 11
    // 頂部行
    7: 5, // 左上 -> 5
    8: 6, // 中上 -> 6
    9: 7, // 右上 -> 7
  };
  return alignmentMap[numpadAlignment] || 2;
}

/**
 * 將 CSS 顏色轉換為 ASS 顏色格式
 * CSS: #RRGGBB 或 rgba(r, g, b, a)
 * ASS: &HAABBGGRR (Alpha, Blue, Green, Red)
 */
export function cssColorToAss(cssColor: string, alpha: number = 0): string {
  let r: number, g: number, b: number;

  if (cssColor.startsWith('#')) {
    // 處理 #RRGGBB 格式
    const hex = cssColor.slice(1);
    r = parseInt(hex.substr(0, 2), 16);
    g = parseInt(hex.substr(2, 2), 16);
    b = parseInt(hex.substr(4, 2), 16);
  } else if (cssColor.startsWith('rgb')) {
    // 處理 rgba(r, g, b, a) 格式
    const match = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      r = parseInt(match[1]);
      g = parseInt(match[2]);
      b = parseInt(match[3]);
    } else {
      // 預設白色
      r = 255;
      g = 255;
      b = 255;
    }
  } else {
    // 預設白色
    r = 255;
    g = 255;
    b = 255;
  }

  // 轉換為 ASS 格式: &HAABBGGRR
  const alphaHex = alpha.toString(16).padStart(2, '0').toUpperCase();
  const blueHex = b.toString(16).padStart(2, '0').toUpperCase();
  const greenHex = g.toString(16).padStart(2, '0').toUpperCase();
  const redHex = r.toString(16).padStart(2, '0').toUpperCase();

  return `&H${alphaHex}${blueHex}${greenHex}${redHex}`;
}

/**
 * 構建 force_style 參數字符串
 */
export function buildForceStyle(style: SubtitleStyle): string {
  const parts: string[] = [];

  // 字體設置
  parts.push(`FontName=${style.fontName}`);
  parts.push(`FontSize=${style.fontSize}`);

  // 顏色設置 (ASS 格式)
  parts.push(`PrimaryColour=${cssColorToAss(style.primaryColor)}`);
  parts.push(`OutlineColour=${cssColorToAss(style.outlineColor)}`);
  parts.push(`BackColour=${cssColorToAss(style.backColor, 128)}`);

  // 字體樣式
  if (style.bold) parts.push('Bold=1');
  if (style.italic) parts.push('Italic=1');
  if (style.underline) parts.push('Underline=1');

  // 邊框和陰影
  parts.push(`BorderStyle=${style.borderStyle}`);
  parts.push(`Outline=${style.outline}`);
  parts.push(`Shadow=${style.shadow}`);

  // 對齊位置 (轉換為 ASS 格式)
  const assAlignment = convertAlignment(style.alignment);
  parts.push(`Alignment=${assAlignment}`);

  // 邊距
  parts.push(`MarginL=${style.marginL}`);
  parts.push(`MarginR=${style.marginR}`);
  parts.push(`MarginV=${style.marginV}`);

  return parts.join(',');
}

/**
 * 轉義字幕文件路徑以用於 FFmpeg 濾鏡
 * Windows 路徑需要特殊處理
 */
export function escapeSubtitlePath(subtitlePath: string): string {
  // 將反斜槓轉換為正斜槓
  let escaped = subtitlePath.replace(/\\/g, '/');
  // 轉義特殊字符: : ' [
  // 注意: 先轉義 : 和 [，再轉義 '（避免引入的 \ 被重複轉義）
  // 此時路徑中不應有反斜槓（已全部轉為正斜槓），所以不需要轉義 \
  escaped = escaped
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/'/g, "\\'");
  return escaped;
}

/**
 * 將字幕文件複製到臨時目錄，使用安全的文件名（無特殊字符）
 * 返回臨時文件路徑。調用方需要在使用完畢後清理臨時文件。
 *
 * 這是處理包含特殊字符（如單引號 ' ）路徑的最可靠方式，
 * 因為 ffmpeg 的濾鏡字符串解析在不同版本和不同庫封裝下行為可能不一致。
 */
export function createSafeSubtitleCopy(subtitlePath: string): string {
  const ext = path.extname(subtitlePath);
  const tmpDir = path.join(os.tmpdir(), 'video-subtitle-master');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const safeName = `subtitle_${Date.now()}${ext}`;
  const tmpPath = path.join(tmpDir, safeName);
  fs.copyFileSync(subtitlePath, tmpPath);
  logMessage(`創建臨時字幕文件: ${tmpPath}`, 'info');
  return tmpPath;
}

/**
 * 清理臨時字幕文件
 */
export function cleanupTempSubtitle(tmpPath: string): void {
  try {
    if (tmpPath.includes('video-subtitle-master') && fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
      logMessage(`清理臨時字幕文件: ${tmpPath}`, 'info');
    }
  } catch (err) {
    logMessage(`清理臨時文件失敗: ${err}`, 'warning');
  }
}

/**
 * 判斷路徑是否包含需要特殊處理的字符
 */
function pathNeedsSafeCopy(filePath: string): boolean {
  // 包含單引號、反斜槓（非路徑分隔符）、冒號（非Windows盤符）等特殊字符
  return /['\[\];,]/.test(filePath);
}

// 純拉丁字體（不含 CJK 字形）。中文字幕若用這些字體燒錄，libass 找不到字形會渲染成
// 豆腐塊/亂碼（issue: mac 中文燒錄亂碼）。命中且字幕含 CJK 時回退到平臺 CJK 字體。
const LATIN_ONLY_FONTS = new Set([
  'arial',
  'helvetica',
  'helvetica neue',
  'georgia',
  'times new roman',
  'verdana',
  'roboto',
  'impact',
  'tahoma',
  'courier new',
]);

/** 文本是否包含 CJK（中日韓）字符 */
function containsCJK(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(
    text,
  );
}

/** 選中字體是否為純拉丁字體（無 CJK 字形） */
function isLatinOnlyFont(fontName: string): boolean {
  return LATIN_ONLY_FONTS.has((fontName || '').trim().toLowerCase());
}

/**
 * macOS 上「確有字體文件」的常見 CJK 字體（按優先級）。
 * 關鍵點：PingFang 在部分 macOS 上沒有可被 fontconfig 索引的字體文件
 * （僅 CoreText 可見），libass 解析「PingFang SC」會回退到 Helvetica → 中文渲染成亂碼。
 * 因此燒錄前必須挑一個「文件確實存在」的 CJK 字體，按 family 名交給 libass。
 * family 名取自 libass/fontconfig 對相應文件的實際解析結果（已實測）。
 */
const MAC_CJK_FONTS: Array<{ name: string; files: string[] }> = [
  { name: 'PingFang SC', files: ['/System/Library/Fonts/PingFang.ttc'] },
  {
    name: 'Hiragino Sans GB',
    files: ['/System/Library/Fonts/Hiragino Sans GB.ttc'],
  },
  {
    name: 'Heiti SC',
    files: [
      '/System/Library/Fonts/STHeiti Medium.ttc',
      '/System/Library/Fonts/STHeiti Light.ttc',
    ],
  },
  {
    name: 'Songti SC',
    files: ['/System/Library/Fonts/Supplemental/Songti.ttc'],
  },
  {
    name: 'Arial Unicode MS',
    files: ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf'],
  },
];

let cachedMacCJKFont: string | null = null;

/** macOS：返回第一個字體文件確實存在的 CJK 字體名（結果緩存） */
function resolveMacCJKFont(): string {
  if (cachedMacCJKFont) return cachedMacCJKFont;
  const found = MAC_CJK_FONTS.find((f) =>
    f.files.some((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    }),
  );
  cachedMacCJKFont = found?.name ?? 'Arial Unicode MS';
  return cachedMacCJKFont;
}

/** 該字體在 macOS 上是否為「文件存在」的已知 CJK 字體（可被 libass 正常解析） */
function isMacResolvableCJKFont(fontName: string): boolean {
  const norm = (fontName || '').trim().toLowerCase();
  const matched = MAC_CJK_FONTS.find((f) => f.name.toLowerCase() === norm);
  return Boolean(
    matched &&
      matched.files.some((p) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      }),
  );
}

/** 按運行平臺返回一個穩定可用的 CJK 字體名 */
function getPlatformCJKFont(): string {
  switch (process.platform) {
    case 'darwin':
      return resolveMacCJKFont();
    case 'win32':
      return 'Microsoft YaHei';
    default:
      return 'Noto Sans CJK SC';
  }
}

// 備註：曾嘗試給 libass 傳 fontsdir 兜底，但實測打包版 ffmpeg 的預設 fontconfig
// 已能按 family 名解析系統 CJK 字體（含 Supplemental 目錄），fontsdir 反而會觸發
// 掃描整目錄的無害告警（如 Apple Color Emoji 元數據讀取失敗），故移除。

/**
 * 為「含 CJK 的字幕」決定最終燒錄字體：
 * - 不含 CJK：原樣使用用戶所選字體；
 * - macOS：所選字體若不是「文件存在的已知 CJK 字體」（含用戶預設 PingFang 在本機缺失的情況），
 *   一律換成 resolveMacCJKFont() 解析出的可用 CJK 字體；
 * - 其它平臺：僅當所選為純拉丁字體時回退到平臺 CJK 字體。
 */
function resolveBurnFontName(chosenFont: string, hasCJK: boolean): string {
  if (!hasCJK) return chosenFont;
  if (process.platform === 'darwin') {
    return isMacResolvableCJKFont(chosenFont)
      ? chosenFont
      : resolveMacCJKFont();
  }
  return isLatinOnlyFont(chosenFont) ? getPlatformCJKFont() : chosenFont;
}

/**
 * 獲取影片信息
 */
export function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        logMessage(`獲取影片信息失敗: ${err.message}`, 'error');
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(
        (s) => s.codec_type === 'video',
      );
      const stats = fs.statSync(videoPath);

      resolve({
        path: videoPath,
        fileName: path.basename(videoPath),
        duration: metadata.format.duration || 0,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        size: stats.size,
      });
    });
  });
}

/**
 * 合併字幕到影片
 */
export async function mergeSubtitleToVideo(
  config: MergeConfig,
  onProgress?: (progress: MergeProgress) => void,
): Promise<string> {
  const {
    videoPath,
    subtitlePath,
    outputPath,
    style,
    outputMode = 'hardcode',
    videoQuality = 'original',
  } = config;
  const isSoftMux = outputMode === 'softmux';

  // 獲取影片分辨率，用於顯式設置 original_size
  // 防止濾鏡重新初始化時因自動檢測失敗而報錯
  let originalSize = '';
  // 影片總時長（秒），用於在 progress.percent 不可用時自算合併進度（issue #310）
  let totalDurationSec = 0;
  try {
    const videoInfo = await getVideoInfo(videoPath);
    if (videoInfo.width > 0 && videoInfo.height > 0) {
      originalSize = `:original_size=${videoInfo.width}x${videoInfo.height}`;
    }
    totalDurationSec = videoInfo.duration || 0;
  } catch (err) {
    logMessage(
      `獲取影片分辨率失敗，跳過 original_size 設置: ${err}`,
      'warning',
    );
  }

  // 如果字幕路徑包含特殊字符（如單引號），則複製到臨時目錄使用安全文件名
  // 這是最可靠的方式，因為 ffmpeg 的濾鏡字符串解析對特殊字符的處理在
  // 不同版本、不同平臺、不同庫封裝下行為可能不一致
  // 軟字幕封裝走普通 input 參數（不經濾鏡字符串解析），無需安全副本
  let actualSubPath = subtitlePath;
  let tmpSubPath: string | null = null;
  if (!isSoftMux && pathNeedsSafeCopy(subtitlePath)) {
    tmpSubPath = createSafeSubtitleCopy(subtitlePath);
    actualSubPath = tmpSubPath;
  }

  return new Promise((resolve, reject) => {
    logMessage(
      `開始合併字幕（${isSoftMux ? '軟字幕封裝' : '硬字幕燒錄'}）: ${videoPath}`,
      'info',
    );
    logMessage(`字幕文件: ${subtitlePath}`, 'info');
    if (tmpSubPath) {
      logMessage(`使用臨時字幕文件: ${tmpSubPath}`, 'info');
    }
    logMessage(`輸出文件: ${outputPath}`, 'info');

    // 發送初始進度
    onProgress?.({
      percent: 0,
      timeMark: '00:00:00',
      targetSize: 0,
      status: 'processing',
    });

    // 取消後刪除寫了一半的輸出文件，不留半成品
    const cleanupPartialOutput = () => {
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          logMessage(`已刪除未完成的輸出文件: ${outputPath}`, 'info');
        }
      } catch (cleanupErr) {
        logMessage(`刪除未完成輸出文件失敗: ${cleanupErr}`, 'warning');
      }
    };

    mergeCancelled = false;
    let command: ReturnType<typeof ffmpeg>;
    if (isSoftMux) {
      // 軟字幕封裝：全流複製 + 字幕流轉 srt 進 mkv，秒級完成無畫質損失
      command = ffmpeg(videoPath).input(subtitlePath).outputOptions([
        '-map',
        '0',
        '-map',
        '1',
        '-c',
        'copy', // 影片/音頻流直接複製
        '-c:s',
        'srt', // 字幕流統一轉 srt（mkv 原生支持；ass/vtt 自動轉換）
        '-disposition:s:0',
        'default', // 字幕軌預設開啟
        '-y',
      ]);
    } else {
      // 中文亂碼兜底：字幕含 CJK 時，確保最終字體「文件確實存在且含 CJK 字形」。
      // 典型坑：用戶預設字體 PingFang 在部分 mac 上無字體文件，libass 會回退到 Helvetica
      // 渲染成亂碼（已實測）。這裡換成本機存在的 CJK 字體（如 Hiragino Sans GB）。
      let effectiveStyle = style;
      try {
        const subtitleSample = fs.readFileSync(subtitlePath, 'utf-8');
        const hasCJK = containsCJK(subtitleSample);
        const burnFont = resolveBurnFontName(style.fontName, hasCJK);
        if (burnFont !== style.fontName) {
          effectiveStyle = { ...style, fontName: burnFont };
          logMessage(
            `字幕含中文，但所選字體「${style.fontName}」在本機不可用/無 CJK 字形，已改用「${burnFont}」`,
            'warning',
          );
        }
      } catch (readErr) {
        logMessage(`讀取字幕用於字體檢測失敗（忽略）: ${readErr}`, 'warning');
      }

      const forceStyle = buildForceStyle(effectiveStyle);
      const escapedSubPath = escapeSubtitlePath(actualSubPath);
      const subtitlesFilter = `subtitles='${escapedSubPath}'${originalSize}:force_style='${forceStyle}'`;
      logMessage(`subtitles filter: ${subtitlesFilter}`, 'info');
      // 燒錄必然重編碼影片：顯式指定 CRF 控制畫質，避免沿用 libx264 預設(CRF23)
      // 造成肉眼可見的壓縮與體積驟減（issue #331）。音頻仍直接複製不動。
      const crf = VIDEO_QUALITY_CRF[videoQuality] ?? VIDEO_QUALITY_CRF.original;
      logMessage(
        `hardcode video quality: ${videoQuality} (crf=${crf})`,
        'info',
      );
      command = ffmpeg(videoPath)
        .videoFilters(subtitlesFilter)
        .outputOptions([
          '-crf',
          String(crf), // 畫質檔位 → libx264 CRF
          '-c:a',
          'copy', // 保持音頻編碼不變
          '-y', // 覆蓋輸出文件
        ]);
    }

    command
      .on('start', (cmd) => {
        logMessage(`FFmpeg 命令: ${cmd}`, 'info');
      })
      // 從 ffmpeg 解析到的輸入時長兜底總時長：不依賴 ffprobe（本應用未配置 ffprobe，
      // getVideoInfo 在缺失 ffprobe 的環境會失敗，導致 totalDurationSec=0、進度恆為 0%）。
      .on('codecData', (data: { duration?: string }) => {
        const parsed = timemarkToSeconds(data?.duration || '');
        if (parsed > 0) {
          totalDurationSec = parsed;
          logMessage(
            `codecData 輸入時長: ${data.duration} (${parsed}s)`,
            'info',
          );
        }
      })
      .on('progress', (progress) => {
        let percent = progress.percent;
        if (
          (percent === undefined ||
            percent === null ||
            Number.isNaN(percent) ||
            percent <= 0) &&
          totalDurationSec > 0 &&
          progress.timemark
        ) {
          percent =
            (timemarkToSeconds(progress.timemark) / totalDurationSec) * 100;
        }
        percent = Math.max(percent || 0, 0);
        logMessage(`合併進度: ${percent.toFixed(1)}%`, 'info');
        onProgress?.({
          percent: Math.min(percent, 99),
          timeMark: progress.timemark || '00:00:00',
          targetSize: progress.targetSize || 0,
          status: 'processing',
        });
      })
      .on('end', () => {
        currentMergeCommand = null;
        // 清理臨時文件
        if (tmpSubPath) {
          cleanupTempSubtitle(tmpSubPath);
        }
        logMessage('字幕合併完成', 'info');
        onProgress?.({
          percent: 100,
          timeMark: '',
          targetSize: 0,
          status: 'completed',
        });
        resolve(outputPath);
      })
      .on('error', (err) => {
        currentMergeCommand = null;
        // 清理臨時文件
        if (tmpSubPath) {
          cleanupTempSubtitle(tmpSubPath);
        }
        // 用戶取消：清理半成品、靜默復位（不發 error 進度，不算失敗）
        if (mergeCancelled) {
          mergeCancelled = false;
          cleanupPartialOutput();
          logMessage('字幕合併已取消', 'warning');
          onProgress?.({
            percent: 0,
            timeMark: '',
            targetSize: 0,
            status: 'idle',
          });
          reject(new Error(MERGE_CANCELLED));
          return;
        }
        logMessage(`字幕合併失敗: ${err.message}`, 'error');
        onProgress?.({
          percent: 0,
          timeMark: '',
          targetSize: 0,
          status: 'error',
          errorMessage: err.message,
        });
        reject(err);
      });

    currentMergeCommand = command;
    command.save(outputPath);
  });
}

/**
 * 生成預設輸出路徑
 */
export function generateOutputPath(
  videoPath: string,
  suffix: string = '_subtitled',
): string {
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const baseName = path.basename(videoPath, ext);
  return path.join(dir, `${baseName}${suffix}${ext}`);
}

/**
 * 檢查字幕文件格式
 */
export function getSubtitleFormat(subtitlePath: string): string {
  const ext = path.extname(subtitlePath).toLowerCase();
  const formatMap: Record<string, string> = {
    '.srt': 'srt',
    '.ass': 'ass',
    '.ssa': 'ssa',
    '.vtt': 'vtt',
  };
  return formatMap[ext] || 'unknown';
}

/**
 * 統計字幕條數
 */
export async function countSubtitles(subtitlePath: string): Promise<number> {
  try {
    const content = await fs.promises.readFile(subtitlePath, 'utf-8');
    const format = getSubtitleFormat(subtitlePath);

    if (format === 'srt') {
      // SRT 格式: 通過數字序號計數
      const matches = content.match(/^\d+\s*$/gm);
      return matches ? matches.length : 0;
    } else if (format === 'ass' || format === 'ssa') {
      // ASS/SSA 格式: 通過 Dialogue 行計數
      const matches = content.match(/^Dialogue:/gm);
      return matches ? matches.length : 0;
    } else if (format === 'vtt') {
      // VTT 格式: 通過時間戳行計數
      const matches = content.match(/^\d{2}:\d{2}/gm);
      return matches ? matches.length : 0;
    }

    return 0;
  } catch (error) {
    logMessage(`統計字幕條數失敗: ${error}`, 'error');
    return 0;
  }
}
