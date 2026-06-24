import path from 'path';
import fs from 'fs';
import { logMessage } from './storeManager';
import { createMessageSender } from './messageHandler';
import { getSrtFileName } from './utils';
import {
  extractAudioFromVideo,
  probeEmbeddedSubtitles,
  extractEmbeddedSubtitle,
} from './audioProcessor';
import { canHaveEmbeddedSubtitle, srtHasCues } from './embeddedSubtitleParser';
import { routeTranscription } from './transcriptionRouter';
import {
  getDesiredChineseScript,
  convertChineseText,
  removeChineseSubtitlePunctuation,
} from './chineseConvert';
import translate from '../translate';
import { ensureTempDir, getMd5 } from './fileUtils';
import { IFiles } from '../../types';
import {
  convertSubtitleContent,
  getFormatExtension,
  isSupportedSubtitleFormat,
  SubtitleFormat,
} from './subtitleFormats';
import {
  throwIfTaskCancelled,
  isTaskCancelled,
  isTaskCancelledError,
  isWhisperAbortError,
  TaskCancelledError,
} from './taskContext';

/**
 * 處理任務錯誤
 */
function onError(event, file, key, error) {
  const errorMsg = error?.message || error?.toString() || '未知錯誤';
  logMessage(`${key} error: ${errorMsg}`, 'error');
  event.sender.send('taskStatusChange', file, key, 'error');
  event.sender.send('taskErrorChange', file, key, errorMsg);

  // 發送錯誤消息通知
  createMessageSender(event.sender).send('message', {
    type: 'error',
    message: errorMsg,
  });
}

/**
 * 生成字幕
 */
async function generateSubtitle(
  event,
  file: IFiles,
  formData,
  hasOpenAiWhisper,
) {
  try {
    return await routeTranscription({
      event,
      file,
      formData,
      hasOpenAiWhisper,
    });
  } catch (error) {
    if (isTaskCancelledError(error) || isWhisperAbortError(error)) {
      throw error instanceof TaskCancelledError
        ? error
        : new TaskCancelledError();
    }
    onError(event, file, 'extractSubtitle', error);
    throw error; // 繼續拋出錯誤，以便上層函數知道發生了錯誤
  }
}

/**
 * 解析用戶選擇的輸出字幕格式，非法值回退為 srt。
 */
function resolveOutputFormat(formData): SubtitleFormat {
  const fmt = formData?.subtitleOutputFormat;
  return isSupportedSubtitleFormat(fmt) ? fmt : 'srt';
}

/**
 * 將規範 SRT 交付字幕轉換為目標格式，寫入新擴展名文件並刪除原 .srt。
 * 整個處理流程內部始終使用 SRT，僅在最終交付物上做一次格式轉換，
 * 以隔離各格式差異、最大限度降低對既有流程的影響。
 * 返回轉換後的新文件路徑。
 */
async function convertDeliverable(
  srtPath: string,
  format: SubtitleFormat,
): Promise<string> {
  const ext = getFormatExtension(format);
  const newPath = srtPath.replace(/\.srt$/i, ext);
  const content = await fs.promises.readFile(srtPath, 'utf-8');
  const converted = convertSubtitleContent(content, 'srt', format);
  await fs.promises.writeFile(newPath, converted, 'utf-8');
  if (newPath !== srtPath) {
    try {
      fs.unlinkSync(srtPath);
    } catch (err) {
      logMessage(`刪除中間 srt 文件失敗: ${err}`, 'warning');
    }
  }
  return newPath;
}

/**
 * 源字幕中文標點去除（issue #330）：把中文標點替換為空格並清理空白，原位寫回。
 * 僅清理文本；SRT 序號/時間碼為 ASCII，不受 CJK 標點正則影響。失敗僅告警，不阻斷主流程。
 */
async function stripSourceSubtitlePunctuation(
  srtFile: string,
  fileName: string,
): Promise<void> {
  try {
    throwIfTaskCancelled();
    const original = await fs.promises.readFile(srtFile, 'utf-8');
    const cleaned = removeChineseSubtitlePunctuation(original);
    if (cleaned !== original) {
      await fs.promises.writeFile(srtFile, cleaned, 'utf-8');
      logMessage(
        `removed Chinese punctuation from source subtitle: ${fileName}`,
        'info',
      );
    }
  } catch (error) {
    if (isTaskCancelledError(error) || isTaskCancelled()) throw error;
    logMessage(`source punctuation removal failed: ${error}`, 'warning');
  }
}

/**
 * 翻譯字幕
 */
async function translateSubtitle(event, file: IFiles, formData, provider) {
  // 強制發送翻譯開始狀態
  event.sender.send('taskFileChange', {
    ...file,
    translateSubtitle: 'loading',
    translateSubtitleProgress: 0,
  });

  // 強制發送初始進度
  event.sender.send('taskProgressChange', file, 'translateSubtitle', 0);

  const onProgress = (progress) => {
    const normalizedProgress = Math.min(Math.max(progress, 0), 100);
    event.sender.send(
      'taskProgressChange',
      file,
      'translateSubtitle',
      normalizedProgress,
    );
  };

  try {
    await translate(event, file, formData, provider, onProgress);

    // 確保最終狀態的正確發送
    event.sender.send('taskProgressChange', file, 'translateSubtitle', 100);
    event.sender.send('taskFileChange', {
      ...file,
      translateSubtitle: 'done',
      translateSubtitleProgress: 100,
    });

    logMessage(
      `Translation completed successfully for ${file.fileName}`,
      'info',
    );
  } catch (error) {
    if (isTaskCancelledError(error) || isTaskCancelled()) {
      // 用戶取消：翻譯階段回退為待處理，不計錯誤，並中止後續流程
      event.sender.send('taskFileChange', {
        ...file,
        translateSubtitle: '',
        translateSubtitleProgress: 0,
      });
      throw new TaskCancelledError();
    }
    // 確保錯誤狀態下也發送當前進度（從文件狀態獲取）
    onError(event, file, 'translateSubtitle', error);
  }
}

/**
 * 處理文件
 */
export async function processFile(
  event,
  file: IFiles,
  formData,
  hasOpenAiWhisper,
  provider,
) {
  const {
    sourceLanguage,
    targetLanguage,
    sourceSrtSaveOption,
    customSourceSrtFileName,
    model,
    translateProvider,
    saveAudio,
    taskType,
  } = formData || {};

  // 進入處理前清理上一輪殘留的階段狀態/進度/錯誤。後續 taskFileChange 習慣鋪開整個 file
  // （`{ ...file, extractSubtitle: 'loading' }`），若 file 仍帶著舊值——尤其取消時回灌的空串
  // ——渲染層 `{ ...prev, ...res }` 合併會把剛置好的新狀態覆蓋回去，造成「取消→重啟」時
  // 提取格子被打回灰色、進度永遠卡 50%。清成「無此鍵」後，鋪開就不會再攜帶陳舊階段狀態。
  for (const k of [
    'extractAudio',
    'extractSubtitle',
    'prepareSubtitle',
    'translateSubtitle',
    'extractAudioProgress',
    'extractSubtitleProgress',
    'translateSubtitleProgress',
    'extractAudioError',
    'extractSubtitleError',
    'translateSubtitleError',
  ]) {
    delete (file as any)[k];
  }

  try {
    const { filePath, fileName, fileExtension, directory } = file;
    console.log('filePath', file);

    const isSubtitleFile = ['.srt', '.vtt', '.ass', '.ssa', '.lrc'].includes(
      fileExtension,
    );
    logMessage(`begin process ${fileName} with task type: ${taskType}`, 'info');

    // 確定是否需要生成字幕
    const shouldGenerateSubtitle =
      taskType === 'generateAndTranslate' || taskType === 'generateOnly';

    // 確定是否需要翻譯字幕
    const shouldTranslateSubtitle =
      taskType === 'generateAndTranslate' || taskType === 'translateOnly';

    // 處理非字幕文件 - 需要生成字幕的情況
    if (!isSubtitleFile && shouldGenerateSubtitle) {
      const templateData = {
        fileName,
        sourceLanguage,
        targetLanguage,
        model,
        translateProvider: provider?.name || '',
      };

      const sourceSrtFileName = getSrtFileName(
        sourceSrtSaveOption,
        fileName,
        sourceLanguage,
        customSourceSrtFileName,
        templateData,
      );

      file.srtFile = path.join(directory, `${sourceSrtFileName}.srt`);

      // 優先嚐試直接抽取內封文本軟字幕：命中則複用「提取/聽寫」兩節點、跳過抽音頻 + ASR
      let usedEmbedded = false;
      if (canHaveEmbeddedSubtitle(fileExtension)) {
        try {
          throwIfTaskCancelled();
          const textTracks = (await probeEmbeddedSubtitles(filePath)).filter(
            (t) => t.isText,
          );
          if (textTracks.length > 0) {
            const picked = textTracks[0];
            logMessage(
              `found ${textTracks.length} embedded text subtitle(s) in ${fileName}, extracting track s:${picked.subIndex} (${picked.codec})`,
              'info',
            );
            // 提取節點：抽第一條文本軌
            event.sender.send('taskFileChange', {
              ...file,
              extractAudio: 'loading',
            });
            await extractEmbeddedSubtitle(
              filePath,
              picked.subIndex,
              file.srtFile,
              event,
              file,
            );
            const srtContent = fs.readFileSync(file.srtFile, 'utf-8');
            if (!srtHasCues(srtContent)) {
              throw new Error('extracted embedded subtitle has no cues');
            }
            event.sender.send('taskFileChange', {
              ...file,
              extractAudio: 'done',
            });
            // 聽寫節點：字幕文件已就緒
            event.sender.send('taskFileChange', {
              ...file,
              extractSubtitle: 'loading',
            });
            event.sender.send('taskFileChange', {
              ...file,
              extractSubtitle: 'done',
              embeddedSubtitle: true,
            });
            usedEmbedded = true;
          }
        } catch (error) {
          if (isTaskCancelledError(error) || isTaskCancelled()) {
            event.sender.send('taskFileChange', {
              ...file,
              extractAudio: '',
              extractSubtitle: '',
            });
            throw new TaskCancelledError();
          }
          logMessage(
            `embedded subtitle extraction failed for ${fileName}, fallback to ASR: ${error}`,
            'warning',
          );
        }
      }

      if (!usedEmbedded) {
        try {
          // 提取音頻
          logMessage(`extract audio for ${fileName}`, 'info');
          event.sender.send('taskFileChange', {
            ...file,
            extractAudio: 'loading',
            embeddedSubtitle: false,
          });
          throwIfTaskCancelled();
          const tempAudioFile = await extractAudioFromVideo(event, file);
          event.sender.send('taskFileChange', {
            ...file,
            extractAudio: 'done',
          });

          // 如果開啟了保存音頻選項，則複製一份到影片同目錄
          if (saveAudio) {
            const audioFileName = `${fileName}.wav`;
            const targetAudioPath = path.join(directory, audioFileName);
            file.audioFile = targetAudioPath;
            logMessage(`Saving audio file to: ${targetAudioPath}`, 'info');
            fs.copyFileSync(tempAudioFile, targetAudioPath);
          }

          // 生成字幕
          logMessage(`generate subtitle ${file.srtFile}`, 'info');
          throwIfTaskCancelled();
          await generateSubtitle(event, file, formData, hasOpenAiWhisper);
        } catch (error) {
          if (isTaskCancelledError(error) || isTaskCancelled()) {
            // 用戶取消：把本輪 loading 階段回退為待處理
            event.sender.send('taskFileChange', {
              ...file,
              extractAudio: '',
              extractSubtitle: '',
            });
            throw new TaskCancelledError();
          }
          // 如果是提取音頻或生成字幕過程中出錯，已經在各自的函數中處理了錯誤狀態
          // 這裡只需要繼續拋出錯誤，中斷後續流程
          throw error;
        }
      }
    } else if (isSubtitleFile) {
      // 處理字幕文件
      file.srtFile = filePath;
      try {
        event.sender.send('taskFileChange', {
          ...file,
          prepareSubtitle: 'loading',
        });
        // 這裡可以添加字幕格式轉換的邏輯，如果需要的話
        event.sender.send('taskFileChange', {
          ...file,
          prepareSubtitle: 'done',
        });
      } catch (error) {
        onError(event, file, 'prepareSubtitle', error);
        throw error;
      }
    } else if (!isSubtitleFile && !shouldGenerateSubtitle) {
      // 非字幕文件且不需要生成字幕的情況（只翻譯模式下傳入了影片文件）
      const errorMsg = '只翻譯模式下不能處理影片文件，請提供字幕文件';
      onError(event, file, 'processFile', new Error(errorMsg));
      throw new Error(errorMsg);
    }

    // 中文簡繁歸一：僅對「轉寫/內封提取生成」的源字幕生效（不動用戶導入的字幕文件）。
    // 源語言選中文時，按其簡/繁取向把產物統一字形；檢測到相反字形才實際改寫。
    if (!isSubtitleFile && shouldGenerateSubtitle && file.srtFile) {
      const desiredScript = getDesiredChineseScript(sourceLanguage);
      if (desiredScript) {
        try {
          throwIfTaskCancelled();
          const original = await fs.promises.readFile(file.srtFile, 'utf-8');
          const { text, converted } = convertChineseText(
            original,
            desiredScript,
          );
          if (converted) {
            await fs.promises.writeFile(file.srtFile, text, 'utf-8');
            logMessage(
              `normalized source subtitle to ${desiredScript} Chinese: ${fileName}`,
              'info',
            );
          }
        } catch (error) {
          if (isTaskCancelledError(error) || isTaskCancelled()) throw error;
          // 轉換失敗不應阻斷主流程：記錄告警並沿用原始字幕
          logMessage(
            `chinese script normalization failed: ${error}`,
            'warning',
          );
        }
      }
    }

    // 源字幕中文標點去除 · generateOnly：轉寫後即剝離（無翻譯下游，零風險）
    if (
      !isSubtitleFile &&
      shouldGenerateSubtitle &&
      taskType === 'generateOnly' &&
      file.srtFile &&
      formData?.removeChinesePunctuation === true &&
      getDesiredChineseScript(sourceLanguage)
    ) {
      await stripSourceSubtitlePunctuation(file.srtFile, fileName);
    }

    // 翻譯字幕（取消後不再進入）
    throwIfTaskCancelled();
    if (shouldTranslateSubtitle && translateProvider !== '-1') {
      if (!provider) {
        // '-1' 歷史殘留或服務商已被刪除：明確報錯而非深層崩潰
        const errorMsg = `translate provider not found: ${translateProvider}`;
        onError(event, file, 'translateSubtitle', new Error(errorMsg));
        throw new Error(errorMsg);
      }
      logMessage(`translate subtitle ${file.srtFile}`, 'info');
      await translateSubtitle(event, file, formData, provider);
    }

    // 源字幕中文標點去除 · generateAndTranslate：翻譯完成後再剝離源交付物，
    // 保留翻譯輸入的標點以護斷句；noSave 時源字幕隨後會被清理，無需處理。
    if (
      !isSubtitleFile &&
      shouldGenerateSubtitle &&
      taskType === 'generateAndTranslate' &&
      sourceSrtSaveOption !== 'noSave' &&
      file.srtFile &&
      fs.existsSync(file.srtFile) &&
      formData?.removeChinesePunctuation === true &&
      getDesiredChineseScript(sourceLanguage)
    ) {
      await stripSourceSubtitlePunctuation(file.srtFile, fileName);
    }

    // 將交付字幕轉換為用戶選擇的輸出格式（內部流程始終為 SRT，此處僅轉換最終交付物）
    const outputFormat = resolveOutputFormat(formData);
    if (outputFormat !== 'srt') {
      // 源字幕：僅在由 ASR 生成且需要保存時轉換（noSave 時源字幕會被清理，保持 srt）
      if (
        !isSubtitleFile &&
        shouldGenerateSubtitle &&
        sourceSrtSaveOption !== 'noSave' &&
        file.srtFile &&
        fs.existsSync(file.srtFile)
      ) {
        try {
          file.srtFile = await convertDeliverable(file.srtFile, outputFormat);
          logMessage(`source subtitle converted to ${outputFormat}`, 'info');
        } catch (err) {
          logMessage(`轉換源字幕格式失敗: ${err}`, 'error');
        }
      }
      // 翻譯字幕交付物
      if (
        shouldTranslateSubtitle &&
        translateProvider !== '-1' &&
        file.translatedSrtFile &&
        fs.existsSync(file.translatedSrtFile)
      ) {
        try {
          file.translatedSrtFile = await convertDeliverable(
            file.translatedSrtFile,
            outputFormat,
          );
          logMessage(
            `translated subtitle converted to ${outputFormat}`,
            'info',
          );
        } catch (err) {
          logMessage(`轉換翻譯字幕格式失敗: ${err}`, 'error');
        }
      }
      event.sender.send('taskFileChange', file);
    }

    // 清理臨時文件：僅在「生成並翻譯」且確實產生了譯文交付物時才刪除源字幕。
    // 「僅生成字幕」任務的源字幕是最終交付物，絕不能因 noSave 而被刪除。
    if (
      !isSubtitleFile &&
      sourceSrtSaveOption === 'noSave' &&
      shouldGenerateSubtitle &&
      shouldTranslateSubtitle &&
      translateProvider !== '-1'
    ) {
      const { srtFile } = file;
      logMessage(`delete temp subtitle ${srtFile}`, 'warning');
      // 緩存一份到臨時文件，用於字幕校對
      const tempDir = ensureTempDir();
      const md5FileName = getMd5(filePath);
      const tempSrtFile = path.join(tempDir, `${md5FileName}.srt`);
      file.tempSrtFile = tempSrtFile;
      // 清除已刪除文件的路徑，確保校對時使用臨時目錄的文件
      file.srtFile = undefined;
      event.sender.send('taskFileChange', file);
      fs.copyFileSync(srtFile, tempSrtFile);
      fs.unlink(srtFile, (err) => {
        if (err) console.log(err);
      });
    }

    logMessage(`process file done ${fileName}`, 'info');
  } catch (error) {
    if (isTaskCancelledError(error) || isTaskCancelled()) {
      logMessage(`processing cancelled: ${file.fileName}`, 'warning');
      event.sender.send('taskFileChange', {
        ...file,
        extractAudio: '',
        extractSubtitle: '',
        translateSubtitle: '',
      });
      return;
    }
    // 使用通用錯誤處理方法
    createMessageSender(event.sender).send('message', {
      type: 'error',
      message: error,
    });
  }
}
