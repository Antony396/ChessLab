import { useEffect, useState } from "react";
import { KING_SKINS, useEquippedSkin, setEquippedSkin } from "../skinStore";
import { fetchShopState, purchaseSkin, fetchMe } from "../social/api";
import { GoldPawnIcon } from "./HubWorld";

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
  const [level, setLevel] = useState(0);
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
    Promise.all([reload(), fetchMe(token).then((me) => !cancelled && setLevel(me.level))])
      .catch(() => {
        // Leave currency/ownership/level at their defaults - every card
        // just shows as unaffordable/locked until a retry succeeds.
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
        <span className="shop-currency-badge">
          <GoldPawnIcon /> {loading ? "…" : currency}
        </span>
      </div>
      {error && <p className="shop-panel-error">{error}</p>}
      <div className="skins-grid">
        {SHOP_SKIN_ENTRIES.map(([key, skin]) => {
          const owned = ownedSkins.includes(key);
          const isEquipped = key === equipped;
          const levelLocked = Boolean(skin.requiresLevel) && level < skin.requiresLevel;
          const canAfford = currency >= skin.cost && !levelLocked;
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
                  onClick={() => setEquippedSkin(key, { ownedSkins, level }, token)}
                >
                  {isEquipped ? "Equipped" : "Equip"}
                </button>
              ) : levelLocked ? (
                <button type="button" className="shop-card-btn buy unaffordable" disabled title={`Reach Level ${skin.requiresLevel} to unlock (currently Level ${level})`}>
                  {`Requires Lv ${skin.requiresLevel}`}
                </button>
              ) : (
                <button
                  type="button"
                  className={`shop-card-btn buy${canAfford ? "" : " unaffordable"}`}
                  disabled={!canAfford || isPurchasing}
                  onClick={() => handlePurchase(key)}
                  title={canAfford ? `Buy ${skin.name}` : `Need ${skin.cost - currency} more currency`}
                >
                  {isPurchasing ? (
                    "Buying…"
                  ) : (
                    <>
                      <GoldPawnIcon /> {skin.cost}
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
