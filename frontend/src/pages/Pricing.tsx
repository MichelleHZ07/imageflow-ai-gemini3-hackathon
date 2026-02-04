import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";

// 一次性购买（Credit Packs）
const packs = [
  { id: "starter", name: "Starter", usd: 9, credits: 900, priceId: "price_1SPv8NCe5koWjB0tMumOgeez" },
  { id: "creator", name: "Creator", usd: 29, credits: 3000, priceId: "price_1SPv9QCe5koWjB0tozRqXyv1" },
  { id: "studio", name: "Studio", usd: 99, credits: 11000, priceId: "price_1SPvA6Ce5koWjB0tXOBRxa4h" },
];

// 订阅计划（Subscription）
const subscriptions = [
  { id: "starter-sub", name: "Starter", usd: 9, credits: 1200, priceId: "price_1SPv8NCe5koWjB0ttiIxjMab" },
  { id: "creator-sub", name: "Creator", usd: 27, credits: 4000, priceId: "price_1SPv9QCe5koWjB0tIkMtUcMf" },
  { id: "studio-sub", name: "Studio", usd: 99, credits: 15000, priceId: "price_1SPvA6Ce5koWjB0tDO3844lx" },
];

// 档位排序映射
const TIER_BY_PRICE: Record<string, number> = {
  "price_1SPv8NCe5koWjB0ttiIxjMab": 1, // Starter
  "price_1SPv9QCe5koWjB0tIkMtUcMf": 2, // Creator
  "price_1SPvA6Ce5koWjB0tDO3844lx": 3, // Studio
};

export default function Pricing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  /* ✅ 初始化 URL 模式 */
  const getModeFromURL = (): "credit" | "subscription" => {
    const urlMode = searchParams.get("mode");
    if (urlMode === "credit" || urlMode === "subscription") return urlMode;
    return "subscription";
  };
  const [mode, setMode] = useState<"credit" | "subscription">(getModeFromURL());

  const [currentPriceId, setCurrentPriceId] = useState<string | null>(null);
  const [expired, setExpired] = useState<boolean>(true);

  /* ✅ 新增：清理多余 URL 参数（防止 ?cancel=true 这种） */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("cancel")) {
      params.delete("cancel");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  /* ✅ 从后端安全加载当前订阅（带超时防卡死） */
  useEffect(() => {
    if (!user?.uid) {
      setCurrentPriceId(null);
      setExpired(true);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    (async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/user-subscription?uid=${user.uid}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data?.planPriceId) {
          setCurrentPriceId(data.planPriceId);
          setExpired(!!data.expired);
        } else {
          setCurrentPriceId(null);
          setExpired(true);
        }
      } catch (err: any) {
        console.warn("⚠️ Subscription info fetch failed:", err.message);
        setCurrentPriceId(null);
        setExpired(true);
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => controller.abort();
  }, [user?.uid]);

  /* ✅ URL 模式监听（防止循环） */
  useEffect(() => {
    const urlMode = getModeFromURL();
    if (urlMode !== mode) {
      setMode(urlMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  /* ✅ 切换模式时更新 URL（加判断防止循环刷新） */
  const handleModeChange = (newMode: "credit" | "subscription") => {
    if (newMode !== mode) {
      setMode(newMode);
      setSearchParams({ mode: newMode });
    }
  };

  /* ------------------ 按钮文字逻辑 ------------------ */
  const getButtonText = (priceId: string) => {
    if (!currentPriceId || expired) return "Subscribe";
    if (priceId === currentPriceId) return "Current Plan";

    const curTier = TIER_BY_PRICE[currentPriceId] ?? 0;
    const newTier = TIER_BY_PRICE[priceId] ?? 0;

    if (newTier > curTier) return "Upgrade Now";
    if (newTier < curTier) return "Switch";
    return "Subscribe";
  };

  const isDisabled = (priceId: string) =>
    !!currentPriceId && !expired && priceId === currentPriceId;

  /* ------------------ 购买逻辑 ------------------ */
  const buy = async (p: any) => {
    try {
      const endpoint =
        mode === "credit"
          ? `${import.meta.env.VITE_API_BASE}/api/create-checkout-session`
          : `${import.meta.env.VITE_API_BASE}/api/create-subscription-session`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: p.priceId,
          uid: user?.uid || "",
          email: user?.email || "",
        }),
      });
      const data = await res.json();
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      console.error("Checkout failed:", err);
      alert("Payment failed. Please try again.");
    }
  };

  /* ------------------ 切换/升级逻辑 ------------------ */
  const switchPlan = async (p: any) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE}/api/switch-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: user?.uid,
          email: user?.email,
          newPriceId: p.priceId,
        }),
      });
      const data = await res.json();
      if (data?.url) window.location.href = data.url;
      else throw new Error(data?.error || "No checkout URL");
    } catch (err) {
      alert("Failed to switch subscription.");
      console.error(err);
    }
  };

  /* ------------------ 按钮点击 ------------------ */
  const handleClick = async (p: any) => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`${window.location.pathname}?mode=${mode}`)}`);
      return;
    }

    if (mode === "credit") {
      await buy(p);
      return;
    }

    const text = getButtonText(p.priceId);
    if (text === "Current Plan") return;
    if (text === "Upgrade Now" || text === "Switch") {
      await switchPlan(p);
    } else {
      await buy(p);
    }
  };

  const activePlans = mode === "credit" ? packs : subscriptions;

  /* ------------------ 页面渲染 ------------------ */
  return (
    <Page>
      <Container>
        <Header>
          <Title>Pricing</Title>
          <Subtitle>
            {mode === "credit"
              ? "Get credits for your generations"
              : "Subscribe for continuous access and bonus credits"}
          </Subtitle>

          <ToggleWrapper>
            <Slider $mode={mode} />
            <ToggleButton
              $active={mode === "subscription"}
              onClick={() => handleModeChange("subscription")}
            >
              Subscription
            </ToggleButton>
            <ToggleButton
              $active={mode === "credit"}
              onClick={() => handleModeChange("credit")}
            >
              Credit Packs
            </ToggleButton>
          </ToggleWrapper>
        </Header>

        <Grid>
          {activePlans.map((p) => {
            const text = mode === "subscription" ? getButtonText(p.priceId) : "Buy Now";
            const disabled = mode === "subscription" && isDisabled(p.priceId);

            return (
              <PricingCard key={p.id}>
                <PlanName>{p.name}</PlanName>
                <PriceRow>
                  <Price>${p.usd}</Price>
                  <PerUnit>{mode === "credit" ? "one-time" : "per month"}</PerUnit>
                </PriceRow>
                <Credits>
                  {p.credits.toLocaleString()} credits
                  {mode === "subscription" && " / month"}
                </Credits>

                {!user ? (
                  <BuyButton
                    onClick={() =>
                      navigate(`/login?redirect=${encodeURIComponent(`${window.location.pathname}?mode=${mode}`)}`)
                    }
                  >
                    Sign In to Get Started
                  </BuyButton>
                ) : (
                  <BuyButton disabled={disabled} onClick={() => handleClick(p)}>
                    {text}
                  </BuyButton>
                )}
              </PricingCard>
            );
          })}
        </Grid>

        <Footer>
          Need more? <span>Contact us for custom plans.</span>
        </Footer>
      </Container>
    </Page>
  );
}

/* ---------------- Styles ---------------- */
const Page = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  min-height: calc(100vh - 80px);
  padding: 40px 20px;
`;
const Container = styled.div`max-width: 1000px; margin: 0 auto;`;
const Header = styled.div`text-align: center; margin-bottom: 48px;`;
const Title = styled.h1`
  margin: 0 0 12px 0;
  font-size: 42px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;
const Subtitle = styled.p`
  margin: 0 0 24px 0;
  font-size: 16px;
  color: ${({ theme }) => theme.colors.muted};
`;
const ToggleWrapper = styled.div`
  position: relative;
  display: inline-flex;
  background: ${({ theme }) => theme.colors.inner || theme.colors.card};
  border-radius: 50px;
  overflow: hidden;
  margin-top: 16px;
  box-shadow: inset 0 0 0 1px ${({ theme }) => theme.colors.border};
`;
const ToggleButton = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 10px 28px;
  border: none;
  background: transparent;
  font-weight: 700;
  font-size: 15px;
  color: ${({ $active, theme }) => ($active ? theme.colors.white : theme.colors.text)};
  cursor: pointer;
  z-index: 2;
  transition: color 0.3s ease;
`;
const Slider = styled.div<{ $mode: "credit" | "subscription" }>`
  position: absolute;
  top: 3px;
  left: ${({ $mode }) => ($mode === "subscription" ? "3px" : "50%")};
  width: 50%;
  height: calc(100% - 6px);
  background: ${({ theme }) => theme.colors.accent};
  border-radius: 50px;
  transition: all 0.3s ease;
  z-index: 1;
`;
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
  margin: 40px auto;
`;
const PricingCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
`;
const PlanName = styled.h3`margin: 0 0 20px 0; font-size: 22px; font-weight: 800; color: ${({ theme }) => theme.colors.text};`;
const PriceRow = styled.div`display: flex; align-items: baseline; gap: 6px; margin-bottom: 12px;`;
const Price = styled.div`font-size: 48px; font-weight: 800; color: ${({ theme }) => theme.colors.accent};`;
const PerUnit = styled.div`font-size: 14px; font-weight: 600; color: ${({ theme }) => theme.colors.muted};`;
const Credits = styled.div`font-size: 16px; font-weight: 600; color: ${({ theme }) => theme.colors.text}; margin-bottom: 24px;`;
const BuyButton = styled.button<{ disabled?: boolean }>`
  background: ${({ theme, disabled }) => (disabled ? theme.colors.border : theme.colors.accent)};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 14px 32px;
  font-weight: 700;
  font-size: 15px;
  cursor: ${({ disabled }) => (disabled ? "not-allowed" : "pointer")};
  transition: all 0.2s ease;
  width: 100%;
  opacity: ${({ disabled }) => (disabled ? 0.6 : 1)};
  &:hover { opacity: ${({ disabled }) => (disabled ? 0.6 : 0.9)}; }
`;
const Footer = styled.div`text-align: center; color: ${({ theme }) => theme.colors.muted}; font-size: 14px; margin-top: 48px; span { font-weight: 600; }`;