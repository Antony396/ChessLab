import { useEffect, useState } from "react";
import { KING_SKINS, useEquippedSkin, setEquippedSkin } from "../skinStore";
import { fetchShopState, purchaseSkin } from "../social/api";

// The skins that actually have a `cost` (see skinStore.js) - everything
// else (free-by-default, or gated by streak/map progress) has nothing to
// do with the shop and isn't shown here.
const SHOP_SKIN_ENTRIES = Object.entries(KING_SKINS).filter(([, skin]) => skin.cost);

// A dedicated browsing surface for PURCHASING skins with currency, separate
// from SkinsPanel (which is "equip what I already have/unlocked"). A
// bought skin immediately shows up unlocked over there too, since both
// read the same server-side owned_skins/currency state.
export default function ShopPanel({ token }) {
  const equipped = useEquippedSkin();
  const [currency, setCurrency] = useState(0);
  const [ownedSkins, setOwnedSkins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasingKey, setPurchasingKey] = useState(null);
  const [error, setError] = useState(null);

  function reload() {
    return fetchShopState(token).then((result) => {
      setCurrency(result.currency);
      setOwnedSkins(result.owned_skins);
    });
  }

  useEffect(() => {
    let cancelled = false;
    reload()
      .catch(() => {
        // Leave currency/ownership at their defaults - every card just
        // shows as unaffordable/unowned until a retry succeeds.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function handlePurchase(key) {
    setError(null);
    setPurchasingKey(key);
    purchaseSkin(token, key)
      .then((result) => {
        setCurrency(result.currency);
        setOwnedSkins(result.owned_skins);
      })
      .catch((e) => setError(e.message))
      .finally(() => setPurchasingKey(null));
  }

  return (
    <div className="shop-panel">
      <div className="shop-panel-header">
        <p className="shop-panel-hint">Spend currency (earned from online wins) on a King skin, permanently.</p>
        <span className="shop-currency-badge">🪙 {loading ? "…" : currency}</span>
      </div>
      {error && <p className="shop-panel-error">{error}</p>}
      <div className="skins-grid">
        {SHOP_SKIN_ENTRIES.map(([key, skin]) => {
          const owned = ownedSkins.includes(key);
          const isEquipped = key === equipped;
          const canAfford = currency >= skin.cost;
          const isPurchasing = purchasingKey === key;
          return (
            <div key={key} className={`skin-card shop-card${isEquipped ? " equipped" : ""}${owned ? "" : " locked"}`}>
              {isEquipped && <span className="skin-card-badge">Equipped</span>}
              <span className="skin-card-preview">
                <img src={skin.src} alt="" className="skin-card-img" />
              </span>
              <span className="skin-card-name">{skin.name}</span>
              {owned ? (
                <button
                  type="button"
                  className="shop-card-btn owned"
                  disabled={isEquipped}
                  onClick={() => setEquippedSkin(key, { ownedSkins }, token)}
                >
                  {isEquipped ? "Equipped" : "Equip"}
                </button>
              ) : (
                <button
                  type="button"
                  className={`shop-card-btn buy${canAfford ? "" : " unaffordable"}`}
                  disabled={!canAfford || isPurchasing}
                  onClick={() => handlePurchase(key)}
                  title={canAfford ? `Buy ${skin.name}` : `Need ${skin.cost - currency} more currency`}
                >
                  {isPurchasing ? "Buying…" : `🪙 ${skin.cost}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
