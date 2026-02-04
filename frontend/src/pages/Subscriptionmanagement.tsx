import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../context/AuthContext";
import AlertModal from "../components/AlertModal";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

interface Subscription {
  subscriptionId: string;
  planName: string;
  planPrice: number;
  credits: number;
  cycle: string;
  status: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  active: boolean;
  expired?: boolean;
}

export default function SubscriptionManagement() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{
    title?: string;
    message?: string;
    onConfirm?: () => void;
    showCancel?: boolean;
  }>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ✅ 支付成功提示
  useEffect(() => {
    if (searchParams.get("success") === "true") {
      setAlert({
        title: "Payment Successful",
        message:
          "Your subscription was activated successfully. Credits will be added to your account shortly.",
      });
      navigate("/account/subscriptions", { replace: true });
    }
  }, [searchParams, navigate]);

  // ✅ 拉取订阅信息
  const fetchSubscriptions = useCallback(async () => {
    if (!user?.uid) {
      setSubscriptions([]); // 用户登出时清空
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/subscription-status?uid=${user.uid}`);
      const data = await res.json();

      const subsArray = Array.isArray(data)
        ? data.filter((s) => !s.expired && s.status !== "expired")
        : [];

      setSubscriptions(subsArray);
      console.log(`✅ [Frontend] Loaded ${subsArray.length} subscription(s)`);
    } catch (err) {
      console.error("❌ Failed to fetch subscriptions:", err);
      setSubscriptions([]); // 🚀 出错也清空
      setAlert({
        title: "Error",
        message: "Failed to load subscriptions. Please refresh the page.",
      });
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  // ✅ 自动刷新机制
  useEffect(() => {
    fetchSubscriptions();

    const handleUpdate = () => fetchSubscriptions();
    window.addEventListener("accountUpdate", handleUpdate);
    return () => window.removeEventListener("accountUpdate", handleUpdate);
  }, [fetchSubscriptions]);

  // ✅ 取消订阅
  const showCancelConfirmation = (subscriptionId: string, planName: string) => {
    setAlert({
      title: "Cancel Subscription",
      message: `Are you sure you want to cancel your "${planName}" subscription? It will remain active until the end of the current billing period.`,
      showCancel: true,
      onConfirm: () => {
        setAlert({});
        handleCancel(subscriptionId);
      },
    });
  };

  const handleCancel = async (subscriptionId: string) => {
    if (!user?.uid) return;
    setActionLoading(subscriptionId);

    try {
      const res = await fetch(`${API_BASE}/api/cancel-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: user.uid, subscriptionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Cancel failed");

      setAlert({
        title: "Subscription Canceled",
        message: "Your subscription will remain active until the end of the current billing period.",
      });

      await fetchSubscriptions();
    } catch (err: any) {
      console.error("Cancel failed:", err);
      setAlert({
        title: "Error",
        message: err.message || "Failed to cancel subscription. Please try again.",
      });
    } finally {
      setActionLoading(null);
    }
  };

  // ✅ 恢复订阅
  const handleResume = async (subscriptionId: string) => {
    if (!user?.uid) return;
    setActionLoading(subscriptionId);

    try {
      const res = await fetch(`${API_BASE}/api/resume-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: user.uid, subscriptionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Resume failed");

      setAlert({
        title: "Subscription Resumed",
        message: "Your subscription has been successfully resumed.",
      });

      await fetchSubscriptions();
    } catch (err: any) {
      console.error("Resume failed:", err);
      setAlert({
        title: "Error",
        message: err.message || "Failed to resume subscription. Please try again.",
      });
    } finally {
      setActionLoading(null);
    }
  };

  // ✅ Loading 状态
  if (loading) {
    return (
      <Container>
        <PageHeader>
          <TitleSection>
            <PageTitle>Subscription Management</PageTitle>
            <PageSubtitle>Manage your active subscriptions and billing</PageSubtitle>
          </TitleSection>
        </PageHeader>
        <LoadingCard>Loading your subscriptions...</LoadingCard>
      </Container>
    );
  }

  // ✅ 页面渲染
  return (
    <>
      <Container>
        <PageHeader>
          <TitleSection>
            <PageTitle>Subscription Management</PageTitle>
            <PageSubtitle>Manage your active subscriptions and billing</PageSubtitle>
          </TitleSection>
        </PageHeader>

        {subscriptions.length === 0 ? (
          <EmptyCard>
            <EmptyIcon>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                <line x1="1" y1="10" x2="23" y2="10"/>
              </svg>
            </EmptyIcon>
            <EmptyTitle>No Active Subscriptions</EmptyTitle>
            <EmptyText>
              Subscribe to a plan to get monthly credits and continuous access to image generation.
            </EmptyText>
            <EmptyButton onClick={() => (window.location.href = "/pricing")}>
              View Pricing Plans
            </EmptyButton>
          </EmptyCard>
        ) : (
          <SubGrid>
            {subscriptions.map((sub) => (
              <SubCard key={sub.subscriptionId}>
                <SubCardHeader>
                  <SubPlanInfo>
                    <SubPlanName>{sub.planName}</SubPlanName>
                    <SubPlanPrice>${sub.planPrice} / {sub.cycle}</SubPlanPrice>
                  </SubPlanInfo>
                  <StatusBadge
                    $status={sub.cancelAtPeriodEnd ? "canceled" : sub.status}
                  >
                    {sub.cancelAtPeriodEnd ? "Canceled" : sub.status}
                  </StatusBadge>
                </SubCardHeader>

                <SubDetails>
                  <DetailItem>
                    <DetailIcon>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                      </svg>
                    </DetailIcon>
                    <DetailText>
                      <DetailLabel>Monthly Credits</DetailLabel>
                      <DetailValue>{sub.credits.toLocaleString()} credits</DetailValue>
                    </DetailText>
                  </DetailItem>

                  <DetailItem>
                    <DetailIcon>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    </DetailIcon>
                    <DetailText>
                      <DetailLabel>Next Billing Date</DetailLabel>
                      <DetailValue>
                        {new Date(
                          sub.currentPeriodEnd && !isNaN(sub.currentPeriodEnd)
                            ? sub.currentPeriodEnd
                            : Date.now() + 30 * 24 * 60 * 60 * 1000
                        ).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric"
                        })}
                      </DetailValue>
                    </DetailText>
                  </DetailItem>
                </SubDetails>

                <SubActions>
                  {sub.cancelAtPeriodEnd ? (
                    <ActionButton
                      $primary
                      onClick={() => handleResume(sub.subscriptionId)}
                      disabled={actionLoading === sub.subscriptionId}
                    >
                      {actionLoading === sub.subscriptionId
                        ? "Processing..."
                        : "Resume Subscription"}
                    </ActionButton>
                  ) : (
                    <ActionButton
                      $danger
                      onClick={() =>
                        showCancelConfirmation(sub.subscriptionId, sub.planName)
                      }
                      disabled={actionLoading === sub.subscriptionId}
                    >
                      {actionLoading === sub.subscriptionId
                        ? "Processing..."
                        : "Cancel Subscription"}
                    </ActionButton>
                  )}
                </SubActions>
              </SubCard>
            ))}
          </SubGrid>
        )}
      </Container>

      {alert.message && (
        <AlertModal
          title={alert.title}
          message={alert.message}
          onClose={() => setAlert({})}
          onConfirm={alert.onConfirm}
          showCancel={alert.showCancel}
          confirmText={alert.showCancel ? "Yes, Cancel" : "OK"}
          cancelText="Close"
        />
      )}
    </>
  );
}

/* ============ 样式区保持不变 ============ */
/* ============ Styles ============ */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
`;

const PageHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  flex-wrap: wrap;
`;

const TitleSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const PageTitle = styled.h1`
  margin: 0;
  font-size: 32px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  letter-spacing: -0.5px;
`;

const PageSubtitle = styled.p`
  margin: 0;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 500;
`;

const LoadingCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 60px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

const EmptyCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 60px 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
`;

const EmptyIcon = styled.div`
  color: ${({ theme }) => theme.colors.accent};
  opacity: 0.6;
`;

const EmptyTitle = styled.h3`
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const EmptyText = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.6;
  max-width: 440px;
`;

const EmptyButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 14px 32px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 8px;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
`;

const SubGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 24px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const SubCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  transition: all 0.2s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
`;

const SubCardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
`;

const SubPlanInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
`;

const SubPlanName = styled.h4`
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const SubPlanPrice = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

const StatusBadge = styled.div<{ $status: string }>`
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  background: ${({ $status }) =>
    $status === "active" ? "#4caf5020"
      : $status === "canceling" ? "#ff980020"
      : "#9e9e9e20"};
  color: ${({ $status }) =>
    $status === "active" ? "#2e7d32"
      : $status === "canceling" ? "#e65100"
      : "#616161"};
`;

const SubDetails = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 0;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const DetailItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 14px;
`;

const DetailIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.inner};
  color: ${({ theme }) => theme.colors.accent};
  flex-shrink: 0;
`;

const DetailText = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const DetailLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

const DetailValue = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const SubActions = styled.div`
  display: flex;
  gap: 12px;
`;

const ActionButton = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  flex: 1;
  background: ${({ $primary, $danger, theme }) =>
    $primary ? theme.colors.accent
      : $danger ? theme.colors.white
      : theme.colors.white};
  color: ${({ $primary, $danger, theme }) =>
    $primary ? theme.colors.white
      : $danger ? "#d32f2f"
      : theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 14px 20px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
    background: ${({ $danger }) => $danger ? "#d32f2f15" : undefined};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
`;