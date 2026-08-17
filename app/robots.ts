import type { MetadataRoute } from 'next';

/**
 * 共有URL（dev / demo）を検索結果に出さない。
 *
 * URLを知っている人だけに見せる前提なので、クロールされて索引に載ると
 * その前提が崩れる。本番公開時は RECEPTION_ALLOW_INDEXING=1 で解除する。
 */
export default function robots(): MetadataRoute.Robots {
  const allowIndexing = process.env.RECEPTION_ALLOW_INDEXING === '1';

  return allowIndexing
    ? { rules: [{ userAgent: '*', allow: '/' }] }
    : { rules: [{ userAgent: '*', disallow: '/' }] };
}
