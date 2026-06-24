import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as tar from 'tar';
import { logMessage } from '../storeManager';
import { calculateFileChecksum } from '../addonDownloader';
import type {
  PyEngineDownloadProgress,
  PyEngineDownloadSource,
  PyEngineManifest,
  PyEngineUpdateInfo,
  RemoteEngineManifest,
} from '../../../types/engine';
import type { PyEngineId, PyEngineVariant } from '../../../types/engine';
import {
  PY_ENGINE_TAG,
  getPyEnginesRoot,
  getEngineDir,
  getEngineArtifactName,
  getEngineDownloadUrl,
  getPyEngineArtifactSuffix,
  getPyEngineChecksumsUrl,
  getPyEngineManifestUrl,
  isRuntimeInstalled,
  getRuntimePythonPath,
  writeEngineManifest,
  readEngineManifest,
  normalizePyEngineVariant,
} from './paths';
import { adhocResignDir } from './macSign';
import { getPythonRuntimeManager, shutdownPythonRuntime } from './index';
import { PythonEngineError } from './manager';
import { isRemoteProtocolInstallable } from './protocolSupport';
import { getSourceFallbackOrder } from '../downloadSourceOrder';
import { MirrorDownloader } from '../download/mirrorDownloader';

interface PyEngineDownloadState {
  url: string;
  destPath: string;
  tempPath: string;
  downloaded: number;
  total: number;
  tag: string;
  source: PyEngineDownloadSource;
  startedAt: string;
  lastUpdatedAt: string;
}

function getDownloadStatePath(engineId: PyEngineId): string {
  return path.join(
    app.getPath('userData'),
    `py-engine-download-state-${engineId}.json`,
  );
}

/** 下載/解壓/備份的臨時根（與各引擎包同盤，保證 rename 原子替換） */
function getPyEngineScratchRoot(): string {
  return path.join(getPyEnginesRoot(), '.cache');
}

function getPyEngineDownloadsDir(): string {
  return path.join(getPyEngineScratchRoot(), 'downloads');
}

function getPyEngineStagingDir(engineId: PyEngineId): string {
  return path.join(getPyEngineScratchRoot(), 'staging', engineId);
}

/** 升級時舊版本備份目錄，自檢通過後刪除，失敗時回滾。 */
function getPyEnginePreviousDir(engineId: PyEngineId): string {
  return path.join(getPyEngineScratchRoot(), 'previous', engineId);
}

function getTempTarPath(engineId: PyEngineId): string {
  return path.join(getPyEngineDownloadsDir(), `${engineId}.tar.gz`);
}

function getArtifactFileName(
  engineId: PyEngineId,
  variant: PyEngineVariant,
): string {
  return getEngineArtifactName(engineId, variant);
}

function parseExpectedChecksum(
  checksumsContent: string,
  artifactName: string,
): string | null {
  for (const line of checksumsContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+\*?\s*(.+)$/);
    if (match && match[2].trim() === artifactName) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

export function readDownloadState(
  engineId: PyEngineId,
): PyEngineDownloadState | null {
  try {
    const statePath = getDownloadStatePath(engineId);
    if (fs.existsSync(statePath)) {
      return JSON.parse(
        fs.readFileSync(statePath, 'utf8'),
      ) as PyEngineDownloadState;
    }
  } catch (error) {
    logMessage(`Error reading py-engine download state: ${error}`, 'error');
  }
  return null;
}

export function saveDownloadState(
  state: PyEngineDownloadState | null,
  engineId: PyEngineId,
): void {
  try {
    const statePath = getDownloadStatePath(engineId);
    if (state === null) {
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
      }
    } else {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    }
  } catch (error) {
    logMessage(`Error saving py-engine download state: ${error}`, 'error');
  }
}

function fetchHttpText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const request = protocol.get(
      url,
      { headers: { 'User-Agent': 'SmartSub-Electron' } },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400
        ) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            fetchHttpText(redirectUrl).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`HTTP Error: ${response.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve(Buffer.concat(chunks).toString('utf8')),
        );
        response.on('error', reject);
      },
    );

    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

export class PyEngineDownloader {
  private engineId: PyEngineId;
  private mainWindow: BrowserWindow | null = null;
  private core: MirrorDownloader;

  constructor(engineId: PyEngineId, mainWindow?: BrowserWindow) {
    this.engineId = engineId;
    this.mainWindow = mainWindow || null;
    this.core = new MirrorDownloader((p) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('py-engine-download-progress', {
          ...(p as PyEngineDownloadProgress),
          engineId: this.engineId,
        });
      }
    });
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getProgress(): PyEngineDownloadProgress {
    return this.core.getProgress() as PyEngineDownloadProgress;
  }

  cancel(): void {
    this.core.cancel();
  }

  /**
   * 安裝/升級：按所選源 + 回退順序依次嘗試。
   * variant 決定下載 CPU 包還是 Full GPU(CUDA) 包；不支持 cuda 的平臺會收斂為 cpu。
   * 用戶取消與協議不支持（protocol_unsupported）屬終止類錯誤，不再換源。
   */
  async download(
    source: PyEngineDownloadSource,
    variant: PyEngineVariant = 'cpu',
  ): Promise<void> {
    const resolvedVariant = normalizePyEngineVariant(variant);
    // 自包含運行時內嵌解釋器，無外部基座依賴，可直接下載。
    return this.core.runWithFallback(
      source,
      (s) => this.downloadFromSource(s, resolvedVariant),
      (error) =>
        (error instanceof Error ? error.message : String(error)) ===
          'Download cancelled' ||
        (error instanceof PythonEngineError &&
          error.code === 'protocol_unsupported'),
      'Py-engine download',
      logMessage,
    );
  }

  private async downloadFromSource(
    source: PyEngineDownloadSource,
    variant: PyEngineVariant,
  ): Promise<void> {
    const resolvedTag = PY_ENGINE_TAG;
    const url = getEngineDownloadUrl(
      source,
      this.engineId,
      variant,
      resolvedTag,
    );
    const tempPath = getTempTarPath(this.engineId);
    const downloadsDir = getPyEngineDownloadsDir();

    // 安裝/升級前協議區間校驗：拉遠端 manifest，超出 app 支持區間則拒裝並提示升級 SmartSub。
    // 老 release 無 manifest.json → 放行（向後兼容）。同時複用 manifest 為本地版本戳。
    const remoteManifest = await this.fetchRemoteManifest(source, resolvedTag);
    if (!isRemoteProtocolInstallable(remoteManifest)) {
      const err = new PythonEngineError(
        'protocol_unsupported',
        `engine protocolVersion=${remoteManifest?.protocolVersion} requires a newer SmartSub`,
      );
      this.core.updateProgress({
        status: 'error',
        error: 'protocol_unsupported',
      });
      logMessage(`Py-engine install blocked: ${err.message}`, 'error');
      throw err;
    }

    fs.mkdirSync(downloadsDir, { recursive: true });

    this.core.resetForDownload();
    this.core.updateProgress({
      status: 'downloading',
      progress: 0,
      downloaded: 0,
      total: 0,
      speed: 0,
      eta: 0,
      error: undefined,
    });

    try {
      const existingState = readDownloadState(this.engineId);
      let startByte = 0;
      let downloadedPath = tempPath;

      if (
        existingState &&
        existingState.url === url &&
        fs.existsSync(existingState.tempPath)
      ) {
        downloadedPath = existingState.tempPath;
        const stat = fs.statSync(downloadedPath);
        startByte = stat.size;

        if (existingState.total > 0 && stat.size >= existingState.total) {
          logMessage(
            'Py-engine download already complete, verifying checksum',
            'info',
          );
          this.core.updateProgress({
            downloaded: stat.size,
            total: existingState.total,
            progress: 100,
            status: 'extracting',
          });
          await this.verifyExtractAndInstall(
            downloadedPath,
            source,
            resolvedTag,
            remoteManifest,
            variant,
          );
          if (fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath);
          saveDownloadState(null, this.engineId);
          this.core.updateProgress({ status: 'completed', progress: 100 });
          return;
        }

        this.core.updateProgress({
          downloaded: startByte,
          total: existingState.total,
        });
        logMessage(
          `Resuming py-engine download from byte ${startByte}`,
          'info',
        );
      } else if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
        logMessage(`Cleaned up old py-engine temp file: ${tempPath}`, 'info');
      }

      const startedAt = new Date().toISOString();
      downloadedPath = await this.core.downloadFile(url, tempPath, startByte, {
        onBytes: (downloaded, total) =>
          saveDownloadState(
            {
              url,
              destPath: tempPath,
              tempPath,
              downloaded,
              total,
              tag: resolvedTag,
              source,
              startedAt,
              lastUpdatedAt: new Date().toISOString(),
            },
            this.engineId,
          ),
      });

      this.core.updateProgress({ status: 'extracting' });
      await this.verifyExtractAndInstall(
        downloadedPath,
        source,
        resolvedTag,
        remoteManifest,
        variant,
      );

      if (fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath);
      saveDownloadState(null, this.engineId);

      this.core.updateProgress({ status: 'completed', progress: 100 });
      logMessage(
        `Py-engine[${this.engineId}] downloaded and installed`,
        'info',
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage === 'Download cancelled') {
        this.core.updateProgress({
          status: 'idle',
          error: 'Download cancelled',
        });
        throw error;
      }
      // 兩類情況必須清掉殘留臨時包與續傳狀態，避免下次一直續傳同一個壞/鎖文件：
      // 1) Windows 文件被鎖（EPERM/EBUSY/EACCES）——否則一直打開同一被鎖文件無法重下；
      // 2) 內容損壞（校驗/解包失敗）——續傳判定只看 URL，而引擎 tag 固定為 latest，
      //    上游 latest 重發或代理忽略 Range 都會讓已下載的臨時包損壞；若不清理，
      //    下次重試會再次命中續傳、把字節拼到壞文件後，導致 sha 反覆不匹配的死循環。
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      const isCorruptArtifact =
        errorMessage.includes('Checksum mismatch') ||
        errorMessage.includes('Invalid engine package') ||
        errorMessage.includes('not found in release checksums');
      if (
        code === 'EPERM' ||
        code === 'EBUSY' ||
        code === 'EACCES' ||
        isCorruptArtifact
      ) {
        try {
          if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
        } catch (cleanupError) {
          logMessage(
            `Failed to remove py-engine temp file: ${cleanupError}`,
            'warning',
          );
        }
        saveDownloadState(null, this.engineId);
      }
      this.core.updateProgress({ status: 'error', error: errorMessage });
      logMessage(`Py-engine download error: ${errorMessage}`, 'error');
      throw error;
    }
  }

  /** 拉取遠端 manifest.json；老 release 不存在時返回 null（向後兼容，不報錯）。 */
  private async fetchRemoteManifest(
    source: PyEngineDownloadSource,
    tag: string = PY_ENGINE_TAG,
  ): Promise<RemoteEngineManifest | null> {
    for (const s of getSourceFallbackOrder(source)) {
      try {
        const text = await fetchHttpText(getPyEngineManifestUrl(s, tag));
        return JSON.parse(text) as RemoteEngineManifest;
      } catch (error) {
        logMessage(
          `py-engine manifest.json from ${s} unavailable: ${error}`,
          'info',
        );
      }
    }
    return null;
  }

  /**
   * 更新檢測：以 checksums.sha256 中本平臺產物的哈希為主信號（完全適配 rolling latest），
   * 與本地 manifest.sha256 比對。同時返回遠端 manifest 供版本展示與協議判定。
   */
  async checkUpdate(
    source: PyEngineDownloadSource,
    variant?: PyEngineVariant,
  ): Promise<PyEngineUpdateInfo> {
    const localManifest = readEngineManifest(this.engineId);
    const installed = isRuntimeInstalled(this.engineId);
    // 未顯式指定時按已安裝變體檢查（老安裝無 variant 字段 → 'cpu' 兜底）。
    const resolvedVariant = normalizePyEngineVariant(
      variant ?? localManifest?.variant,
    );

    let remoteHash: string | null = null;
    for (const s of getSourceFallbackOrder(source)) {
      try {
        const checksumsContent = await fetchHttpText(
          getPyEngineChecksumsUrl(s),
        );
        remoteHash = parseExpectedChecksum(
          checksumsContent,
          getArtifactFileName(this.engineId, resolvedVariant),
        );
        if (remoteHash) break;
      } catch (error) {
        logMessage(
          `checkUpdate: fetch checksums from ${s} failed: ${error}`,
          'warning',
        );
      }
    }

    const remoteManifest = await this.fetchRemoteManifest(source);
    const protocolSupported = isRemoteProtocolInstallable(remoteManifest);

    // 變體切換（已裝 cpu、目標 cuda 或反之）也視為「有更新」，以驅動 UI 的下載入口；
    // 同變體則按哈希比對判斷是否為內容更新。
    const installedVariant = normalizePyEngineVariant(localManifest?.variant);
    const variantSwitch = installed && installedVariant !== resolvedVariant;
    const hasUpdate =
      variantSwitch ||
      !!(
        remoteHash &&
        localManifest?.sha256 &&
        remoteHash.toLowerCase() !== localManifest.sha256.toLowerCase()
      );

    return {
      installed,
      hasUpdate,
      localManifest,
      remoteManifest,
      remoteHash,
      protocolSupported,
      variant: resolvedVariant,
    };
  }

  private buildLocalManifest(
    sha256: string,
    remoteManifest: RemoteEngineManifest | null,
    variant: PyEngineVariant,
  ): PyEngineManifest {
    return {
      version: remoteManifest?.engineVersion ?? PY_ENGINE_TAG,
      platform: getPyEngineArtifactSuffix(),
      sha256,
      installedAt: new Date().toISOString(),
      engineVersion: remoteManifest?.engineVersion,
      protocolVersion: remoteManifest?.protocolVersion,
      builtAt: remoteManifest?.builtAt,
      gitSha: remoteManifest?.gitSha,
      engineId: this.engineId,
      pythonAbi: remoteManifest?.pythonAbi ?? 'cp312',
      variant,
    };
  }

  private async verifyExtractAndInstall(
    tarPath: string,
    source: PyEngineDownloadSource,
    tag: string,
    remoteManifest: RemoteEngineManifest | null,
    variant: PyEngineVariant,
  ): Promise<void> {
    const artifactName = getArtifactFileName(this.engineId, variant);
    const checksumsUrl = getPyEngineChecksumsUrl(source, tag);
    const checksumsContent = await fetchHttpText(checksumsUrl);
    const expectedChecksum = parseExpectedChecksum(
      checksumsContent,
      artifactName,
    );

    if (!expectedChecksum) {
      throw new Error(
        `Checksum for ${artifactName} not found in release checksums`,
      );
    }

    const actualChecksum = await calculateFileChecksum(tarPath);
    if (actualChecksum.toLowerCase() !== expectedChecksum) {
      throw new Error(
        `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
      );
    }

    const stagingDir = getPyEngineStagingDir(this.engineId);
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stagingDir, { recursive: true });

    await tar.extract({
      file: tarPath,
      cwd: stagingDir,
    });

    // 自包含運行時：歸檔頂層即 內嵌解釋器 + main.py + site-packages/（無外部基座）。
    const stagingMain = path.join(stagingDir, 'main.py');
    const stagingSite = path.join(stagingDir, 'site-packages');
    const stagingPython = getRuntimePythonPath(stagingDir);
    if (
      !fs.existsSync(stagingMain) ||
      !fs.existsSync(stagingSite) ||
      !fs.existsSync(stagingPython)
    ) {
      throw new Error(
        'Invalid runtime package: missing embedded interpreter, main.py, or site-packages after extraction',
      );
    }

    await this.installFromStaging(
      stagingDir,
      expectedChecksum,
      remoteManifest,
      variant,
    );
  }

  /**
   * 安全替換：先停機解鎖（依賴 Phase 0 無孤兒進程）→ 備份 current→previous → swap →
   * 寫 manifest → ping 自檢；自檢失敗回滾舊版，成功刪除備份。
   */
  private async installFromStaging(
    stagingDir: string,
    sha256: string,
    remoteManifest: RemoteEngineManifest | null,
    variant: PyEngineVariant,
  ): Promise<void> {
    const currentDir = getEngineDir(this.engineId);
    const previousDir = getPyEnginePreviousDir(this.engineId);
    const hadPrevious = fs.existsSync(currentDir);

    // 1. 停機解 Windows 文件鎖
    await shutdownPythonRuntime();

    // 2. 備份 current → previous（previous 殘留先清；manifest 在包目錄內隨之備份）
    if (fs.existsSync(previousDir)) {
      fs.rmSync(previousDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(previousDir), { recursive: true });
    if (hadPrevious) {
      fs.renameSync(currentDir, previousDir);
    }

    // 3. swap staging → current（失敗立即還原備份）
    fs.mkdirSync(path.dirname(currentDir), { recursive: true });
    try {
      fs.renameSync(stagingDir, currentDir);
    } catch (swapError) {
      if (
        hadPrevious &&
        !fs.existsSync(currentDir) &&
        fs.existsSync(previousDir)
      ) {
        fs.renameSync(previousDir, currentDir);
      }
      throw swapError;
    }

    // 3b. macOS 無證書兜底：對換入的原生庫 ad-hoc 重籤
    adhocResignDir(currentDir);

    // 4. 寫新 manifest（寫在引擎包目錄內，隨目錄一起 swap/rollback）
    writeEngineManifest(
      this.buildLocalManifest(sha256, remoteManifest, variant),
      this.engineId,
    );

    // 5. 自檢：啟動 + ping（ensureStarted 內含協議區間校驗）
    try {
      this.core.updateProgress({ status: 'verifying' });
      await getPythonRuntimeManager().ensureStarted(this.engineId);
    } catch (selfCheckError) {
      logMessage(
        `Py-engine self-check failed, rolling back: ${selfCheckError}`,
        'error',
      );
      await this.rollback(hadPrevious);
      throw selfCheckError;
    }

    // 6. 成功：刪除備份
    if (fs.existsSync(previousDir)) {
      fs.rmSync(previousDir, { recursive: true, force: true });
    }
    logMessage('Py-engine installed and self-check passed', 'info');
  }

  private async rollback(hadPrevious: boolean): Promise<void> {
    const currentDir = getEngineDir(this.engineId);
    const previousDir = getPyEnginePreviousDir(this.engineId);

    // 先停機，釋放剛失敗的 current/ 句柄
    await shutdownPythonRuntime();

    if (fs.existsSync(currentDir)) {
      fs.rmSync(currentDir, { recursive: true, force: true });
    }

    if (hadPrevious && fs.existsSync(previousDir)) {
      // 舊包目錄內含其 manifest，整目錄還原即恢復版本戳
      fs.renameSync(previousDir, currentDir);
      try {
        await getPythonRuntimeManager().ensureStarted(this.engineId);
        logMessage('Py-engine rolled back to previous version', 'info');
      } catch (restartError) {
        logMessage(
          `Py-engine rollback restart failed: ${restartError}`,
          'error',
        );
      }
    }
    // 無舊版可退（首次安裝失敗）：current 已刪除即回到未安裝態（manifest 隨目錄消失）
  }
}

const downloaderInstances = new Map<PyEngineId, PyEngineDownloader>();

export function getPyEngineDownloader(
  engineId: PyEngineId,
  mainWindow?: BrowserWindow,
): PyEngineDownloader {
  let instance = downloaderInstances.get(engineId);
  if (!instance) {
    instance = new PyEngineDownloader(engineId, mainWindow);
    downloaderInstances.set(engineId, instance);
  } else if (mainWindow) {
    instance.setMainWindow(mainWindow);
  }
  return instance;
}
