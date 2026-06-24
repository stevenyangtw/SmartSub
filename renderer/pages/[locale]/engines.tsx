import React from 'react';
import { useTranslation } from 'next-i18next';
import PageHeader from '@/components/PageHeader';
import EngineModelTab from '@/components/resources/EngineModelTab';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';

/**
 * 「引擎與模型」頂級頁（原資源中心 engines Tab 平移為整頁）。
 * 含轉寫引擎運行時管理、語音模型清單，以及 builtin 的 GPU 加速（見 fold-gpu-into-builtin）。
 */
const EnginesPage = () => {
  const { t } = useTranslation('common');
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <PageHeader
        title={t('enginesAndModels')}
        description={t('enginesAndModelsDesc')}
      />
      <div className="min-h-0 flex-1">
        <EngineModelTab />
      </div>
    </div>
  );
};

export default EnginesPage;

export const getStaticProps = makeStaticProperties([
  'common',
  'resources',
  'modelsControl',
  'settings',
  'parameters',
]);
export { getStaticPaths };
