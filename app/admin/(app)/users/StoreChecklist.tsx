type Option = { value: string; label: string };

/**
 * 担当店舗の選択。
 *
 * 何も選ばないと「全店舗」になる。店長・スタッフなど店舗の指定が必須の
 * ロールはサーバー側で弾くが、画面でもその意味を隠さず伝える。
 */
export function StoreChecklist({
  stores,
  selected = [],
  idPrefix = 'new',
}: {
  stores: Option[];
  selected?: string[];
  idPrefix?: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">担当店舗</legend>
      <div className="mt-2 flex flex-wrap gap-3">
        {stores.map((s) => (
          <label key={s.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="storeIds"
              value={s.value}
              id={`${idPrefix}-${s.value}`}
              defaultChecked={selected.includes(s.value)}
            />
            {s.label}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        何も選ばないと全店舗が対象になります。店長・スタッフ・エリアマネージャーは1つ以上必須です。
      </p>
    </fieldset>
  );
}
