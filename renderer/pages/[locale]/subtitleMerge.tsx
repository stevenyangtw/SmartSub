/**
 * 影片合併字幕頁面
 */

import React from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
import { SubtitleMergePanel } from '@/components/subtitleMerge';
import PageHeader from '@/components/PageHeader';

export default function SubtitleMergePage() {
  const { t } = useTranslation('subtitleMerge');
  const router = useRouter();

  // 合成成功/失敗均由面板內預覽浮層呈現，不再額外彈 toast

  // 等 query 就緒再掛載面板，保證銜接入口的預填參數能進入初始狀態
  if (!router.isReady) return null;

  const initialVideoPath =
    typeof router.query.video === 'string' ? router.query.video : undefined;
  const initialSubtitlePath =
    typeof router.query.subtitle === 'string'
      ? router.query.subtitle
      : undefined;

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      <PageHeader title={t('pageTitle')} description={t('pageDesc')} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <SubtitleMergePanel
          initialVideoPath={initialVideoPath}
          initialSubtitlePath={initialSubtitlePath}
        />
      </div>
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common', 'subtitleMerge']);
export { getStaticPaths };
