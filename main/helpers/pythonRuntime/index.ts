import path from 'path';
import { logMessage } from '../storeManager';
import { getFasterWhisperModelsPath } from '../modelCatalog';
import { PythonRuntimeManager, type EngineCommand } from './manager';
import {
  getRuntimePythonPath,
  getEngineDir,
  getEngineMainPy,
  getEngineSitePackages,
  isRuntimeInstalled,
} from './paths';
import type { PyEngineId } from '../../../types/engine';

export * from './protocol';
export { PythonRuntimeManager, PythonEngineError } from './manager';

const NOT_READY_MSG =
  'Python engine not ready. Download the faster-whisper runtime (Resource Hub > Engines), or set PYTHON_ENGINE_CMD for local development.';

/** 模型緩存環境：faster-whisper 用 HF cache（funasr 已遷移 sherpa 原生庫，不再走 Python）。 */
function resolveEngineEnv(_engineId: PyEngineId): Record<string, string> {
  const modelsPath = getFasterWhisperModelsPath();
  return {
    HF_HOME: modelsPath,
    HF_HUB_CACHE: path.join(modelsPath, 'hub'),
  };
}

function resolveEngineCommand(engineId: PyEngineId): EngineCommand {
  const override = process.env.PYTHON_ENGINE_CMD;
  if (override) {
    const parts = override.split(' ').filter(Boolean);
    return { command: parts[0], args: parts.slice(1) };
  }

  if (!isRuntimeInstalled(engineId)) {
    throw new Error(NOT_READY_MSG);
  }

  // 自包含運行時：內嵌解釋器跑同目錄 main.py，PYTHONHOME=運行時根、PYTHONPATH=其 site-packages。
  const runtimeDir = getEngineDir(engineId);
  return {
    command: getRuntimePythonPath(runtimeDir),
    args: [getEngineMainPy(engineId)],
    cwd: runtimeDir,
    pythonHome: runtimeDir,
    pythonPath: getEngineSitePackages(engineId),
    env: resolveEngineEnv(engineId),
  };
}

let manager: PythonRuntimeManager | null = null;

export function getPythonRuntimeManager(): PythonRuntimeManager {
  if (!manager) {
    manager = new PythonRuntimeManager(resolveEngineCommand, (msg, level) =>
      logMessage(msg, level),
    );
  }
  return manager;
}

export async function shutdownPythonRuntime(): Promise<void> {
  if (manager) {
    await manager.stop();
    manager = null;
  }
}
