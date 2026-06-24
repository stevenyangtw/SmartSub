import React from 'react';
import { useTranslation } from 'next-i18next';
import { GpuAccelerationCard } from '@/components/settings';

/**
 * builtin（whisper.cpp）引擎面板。
 *
 * GPU 加速（whisper.cpp 的 CUDA/Vulkan addon）只服務本引擎，故摺疊進此面板內聯呈現
 * （`variant="embedded"`：緊湊狀態摘要常駐 + 「管理/高級」預設收起；CUDA 下載抽屜從頁面內
 * 打開，絕不出現彈窗內再開抽屜的嵌套）。
 */
const BuiltinPanel: React.FC = () => {
  const { t } = useTranslation('resources');
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('engines.builtin.desc')}
      </p>
      <div className="border-t pt-4">
        <GpuAccelerationCard variant="embedded" />
      </div>
    </div>
  );
};

export default BuiltinPanel;
