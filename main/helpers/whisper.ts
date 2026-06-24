import { spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';
import { isAppleSilicon, isWin32 } from './utils';
import { BrowserWindow, DownloadItem } from 'electron';
import decompress from 'decompress';
import fs from 'fs-extra';
import { store, logMessage } from './storeManager';
import { getEffectivePlatform } from './cudaUtils';
import { loadBestAddon } from './addonLoader';
import { getHfHost } from './config/downloadConfig';
import type { GpuMode } from '../../types/addon';

export const getPath = (key?: string) => {
  const userDataPath = app.getPath('userData');
  const settings = store.get('settings') || {
    modelsPath: path.join(userDataPath, 'whisper-models'),
  };
  // 使用用戶自定義的模型路徑或預設路徑
  const modelsPath =
    settings.modelsPath || path.join(userDataPath, 'whisper-models');
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true });
  }
  const res = {
    userDataPath,
    modelsPath,
  };
  if (key) return res[key];
  return res;
};

export const getModelsInstalled = () => {
  const modelsPath = getPath('modelsPath');
  try {
    const models = fs
      .readdirSync(modelsPath)
      ?.filter((file) => file.startsWith('ggml-') && file.endsWith('.bin'));
    return models.map((model) =>
      model.replace('ggml-', '').replace('.bin', ''),
    );
  } catch (e) {
    return [];
  }
};

export const deleteModel = async (model) => {
  const modelsPath = getPath('modelsPath');
  const modelPath = path.join(modelsPath, `ggml-${model}.bin`);
  const coreMLModelPath = path.join(
    modelsPath,
    `ggml-${model}-encoder.mlmodelc`,
  );

  return new Promise((resolve, reject) => {
    try {
      if (fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
      }
      if (fs.existsSync(coreMLModelPath)) {
        fs.removeSync(coreMLModelPath); // 遞歸刪除目錄
      }
      resolve('ok');
    } catch (error) {
      console.error('刪除模型失敗:', error);
      reject(error);
    }
  });
};

export const downloadModelSync = async (
  model: string,
  source: string,
  onProcess: (progress: number, message: string) => void,
  needsCoreML = true,
) => {
  const modelsPath = getPath('modelsPath');
  const modelPath = path.join(modelsPath, `ggml-${model}.bin`);
  const coreMLModelPath = path.join(
    modelsPath,
    `ggml-${model}-encoder.mlmodelc`,
  );

  // 檢查模型文件是否已存在
  if (fs.existsSync(modelPath)) {
    // 如果不需要CoreML支持，或者不是Apple Silicon，或者CoreML文件已存在，則直接返回
    if (!needsCoreML || !isAppleSilicon() || fs.existsSync(coreMLModelPath)) {
      return;
    }
  }

  const baseUrl = `${getHfHost(source)}/ggerganov/whisper.cpp/resolve/main`;
  const url = `${baseUrl}/ggml-${model}.bin`;

  // 只有在需要CoreML支持且是Apple Silicon時才下載CoreML模型
  const needDownloadCoreML = needsCoreML && isAppleSilicon();
  const coreMLUrl = needDownloadCoreML
    ? `${baseUrl}/ggml-${model}-encoder.mlmodelc.zip`
    : '';

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ show: false });
    let downloadCount = 0;
    const totalDownloads = needDownloadCoreML ? 2 : 1;
    let totalBytes = { normal: 0, coreML: 0 };
    let receivedBytes = { normal: 0, coreML: 0 };

    const willDownloadHandler = (event, item: DownloadItem) => {
      const isCoreML = item.getFilename().includes('-encoder.mlmodelc');

      // 檢查是否為當前模型的下載項
      if (!item.getFilename().includes(`ggml-${model}`)) {
        return; // 忽略不匹配的下載項
      }

      // 如果是CoreML文件但不需要下載CoreML，則取消下載
      if (isCoreML && !needDownloadCoreML) {
        item.cancel();
        return;
      }

      const savePath = isCoreML
        ? path.join(modelsPath, `ggml-${model}-encoder.mlmodelc.zip`)
        : modelPath;
      item.setSavePath(savePath);

      const type = isCoreML ? 'coreML' : 'normal';
      totalBytes[type] = item.getTotalBytes();

      item.on('updated', (event, state) => {
        if (state === 'progressing' && !item.isPaused()) {
          receivedBytes[type] = item.getReceivedBytes();
          const totalProgress =
            (receivedBytes.normal + receivedBytes.coreML) /
            (totalBytes.normal + totalBytes.coreML);
          const percent = totalProgress * 100;
          onProcess(totalProgress, `${percent.toFixed(2)}%`);
        }
      });

      item.once('done', async (event, state) => {
        if (state === 'completed') {
          downloadCount++;

          if (isCoreML) {
            try {
              const zipPath = path.join(
                modelsPath,
                `ggml-${model}-encoder.mlmodelc.zip`,
              );
              await decompress(zipPath, modelsPath);
              fs.unlinkSync(zipPath); // 刪除zip文件
              onProcess(1, `Core ML ${model} 解壓完成`);
            } catch (error) {
              console.error('解壓Core ML模型失敗:', error);
              reject(new Error(`解壓Core ML模型失敗: ${error.message}`));
            }
          }

          if (downloadCount === totalDownloads) {
            onProcess(1, `${model} 下載完成`);
            cleanup();
            resolve(1);
          }
        } else {
          cleanup();
          reject(new Error(`${model} download error: ${state}`));
        }
      });
    };

    const cleanup = () => {
      win.webContents.session.removeListener(
        'will-download',
        willDownloadHandler,
      );
      win.destroy();
    };

    win.webContents.session.on('will-download', willDownloadHandler);
    win.webContents.downloadURL(url);

    // 只有在需要時才下載CoreML模型
    if (needDownloadCoreML) {
      win.webContents.downloadURL(coreMLUrl);
    }
  });
};

export async function checkOpenAiWhisper(): Promise<boolean> {
  return new Promise((resolve) => {
    const command = isWin32() ? 'whisper.exe' : 'whisper';
    const env = { ...process.env, PYTHONIOENCODING: 'UTF-8' };
    const childProcess = spawn(command, ['-h'], { env, shell: true });

    const timeout = setTimeout(() => {
      childProcess.kill();
      resolve(false);
    }, 5000);

    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      console.log('spawn error: ', error);
      resolve(false);
    });

    childProcess.on('exit', (code) => {
      clearTimeout(timeout);
      console.log('exit code: ', code);
      resolve(code === 0);
    });
  });
}

export const reinstallWhisper = async () => {
  const whisperPath = getPath('whisperPath');

  // 刪除現有的 whisper.cpp 目錄
  try {
    await fs.remove(whisperPath);
    return true;
  } catch (error) {
    console.error('刪除 whisper.cpp 目錄失敗:', error);
    throw new Error('刪除 whisper.cpp 目錄失敗');
  }
};

// 判斷模型是否是量化模型
export const isQuantizedModel = (model) => {
  return model.includes('-q5_') || model.includes('-q8_');
};

// 判斷 encoder 模型是否存在
export const hasEncoderModel = (model) => {
  const encoderModelPath = path.join(
    getPath('modelsPath'),
    `ggml-${model}-encoder.mlmodelc`,
  );
  return fs.existsSync(encoderModelPath);
};

/**
 * 加載適合當前系統的 Whisper Addon
 *
 * 實際決策與降級鏈見 addonLoader.resolveCandidates；
 * 此處僅負責組裝 LoadContext（gpuMode + CoreML 可用性）。
 */
export async function loadWhisperAddon(model: string) {
  const settings = store.get('settings');
  const gpuMode: GpuMode = settings?.gpuMode || 'auto';
  const coremlEligible =
    getEffectivePlatform() === 'darwin' &&
    isAppleSilicon() &&
    hasEncoderModel(model);

  return loadBestAddon({ gpuMode, coremlEligible });
}
