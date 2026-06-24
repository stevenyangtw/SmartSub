import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { RefreshCw } from 'lucide-react';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';

/**
 * 資源中心已拆為「引擎與模型」(`/engines`) 與「翻譯服務」(`/translation`) 兩個頂級頁
 * （見 split-resource-center-nav）。本頁降級為薄重定向，保住舊 `/resources?tab=*` 深鏈接 / 書籤：
 *
 *   無 tab / overview / engines / models → /engines
 *   providers                            → /translation
 *   acceleration                         → /engines（GPU 已摺疊進 builtin，預選 builtin）
 */
const ResourcesRedirect = () => {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const locale = router.query.locale as string;
    const tab = router.query.tab as string | undefined;

    if (tab === 'providers') {
      router.replace(`/${locale}/translation`);
      return;
    }

    if (tab === 'acceleration') {
      try {
        localStorage.setItem(
          'engineModelSelectedView',
          JSON.stringify('builtin'),
        );
      } catch {
        // 忽略：localStorage 不可用時仍重定向，EngineModelTab 回落預設 builtin
      }
    }
    router.replace(`/${locale}/engines`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return (
    <div className="flex h-full items-center justify-center py-8">
      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
};

export default ResourcesRedirect;

export const getStaticProps = makeStaticProperties(['common']);
export { getStaticPaths };
