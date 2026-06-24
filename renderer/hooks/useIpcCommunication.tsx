import { useEffect, useRef } from 'react';
import { IFiles } from '../../types';

export default function useIpcCommunication(
  setFiles,
  appendFiles?: (incoming: IFiles[]) => void,
) {
  // 始終調用最新的 appendFiles（含去重邏輯），避免事件訂閱閉包過期
  const appendFilesRef = useRef(appendFiles);
  appendFilesRef.current = appendFiles;

  useEffect(() => {
    const cleanupFileSelected = window?.ipc?.on(
      'file-selected',
      (res: IFiles[]) => {
        if (appendFilesRef.current) {
          appendFilesRef.current(res);
        } else {
          setFiles((prevFiles) => [...prevFiles, ...res]);
        }
      },
    );

    const handleTaskStatusChange = (
      res: IFiles,
      key: string,
      status: string,
    ) => {
      setFiles((prevFiles) => {
        const updatedFiles = prevFiles.map((file) =>
          file.uuid === res?.uuid ? { ...file, [key]: status } : file,
        );
        return updatedFiles;
      });
    };

    const handleTaskProgressChange = (
      res: IFiles,
      key: string,
      progress: number,
    ) => {
      // 驗證進度值的合理性
      const normalizedProgress = Math.min(Math.max(progress || 0, 0), 100);

      setFiles((prevFiles) => {
        const progressKey = `${key}Progress`;
        const updatedFiles = prevFiles.map((file) => {
          if (file.uuid === res?.uuid) {
            const currentProgress = file[progressKey] || 0;

            // 防止進度回退，除非是重新開始（進度為0）
            if (
              normalizedProgress === 0 ||
              normalizedProgress >= currentProgress
            ) {
              return { ...file, [progressKey]: normalizedProgress };
            }

            // 如果進度回退了，記錄警告但仍然更新（可能是重試）
            console.warn(
              `Progress rollback detected for ${key}: ${currentProgress} -> ${normalizedProgress}`,
            );
            return { ...file, [progressKey]: normalizedProgress };
          }
          return file;
        });
        return updatedFiles;
      });
    };

    const handleTaskErrorChange = (
      res: IFiles,
      key: string,
      errorMsg: string,
    ) => {
      setFiles((prevFiles) => {
        const errorKey = `${key}Error`;
        const updatedFiles = prevFiles.map((file) =>
          file.uuid === res?.uuid ? { ...file, [errorKey]: errorMsg } : file,
        );
        return updatedFiles;
      });
    };

    const handleFileChange = (res: IFiles) => {
      setFiles((prevFiles) => {
        const updatedFiles = prevFiles.map((file) => {
          if (file.uuid === res?.uuid) {
            const updatedFile = { ...file, ...res };

            // 狀態一致性檢查：如果狀態變為 'done'，確保進度為100%
            Object.keys(res).forEach((key) => {
              if (key.endsWith('Subtitle') && res[key] === 'done') {
                const progressKey = `${key}Progress`;
                if (
                  !updatedFile[progressKey] ||
                  updatedFile[progressKey] < 100
                ) {
                  updatedFile[progressKey] = 100;
                }
              }

              // 如果狀態變為 'error'，保持當前進度不變
              if (key.endsWith('Subtitle') && res[key] === 'error') {
                const progressKey = `${key}Progress`;
                // 保持原有進度，不重置
              }

              // 如果狀態變為 'loading'，確保有初始進度
              if (key.endsWith('Subtitle') && res[key] === 'loading') {
                const progressKey = `${key}Progress`;
                if (!updatedFile[progressKey]) {
                  updatedFile[progressKey] = 0;
                }
              }
            });

            return updatedFile;
          }
          return file;
        });
        return updatedFiles;
      });
    };

    const cleanups = [
      cleanupFileSelected,
      window?.ipc?.on('taskStatusChange', handleTaskStatusChange),
      window?.ipc?.on('taskProgressChange', handleTaskProgressChange),
      window?.ipc?.on('taskErrorChange', handleTaskErrorChange),
      window?.ipc?.on('taskFileChange', handleFileChange),
    ];
    return () => {
      cleanups.forEach((cleanup) => cleanup?.());
    };
  }, []);
}
