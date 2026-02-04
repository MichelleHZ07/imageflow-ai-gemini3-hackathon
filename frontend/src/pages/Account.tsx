import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../context/AuthContext";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import AlertModal from "../components/AlertModal";

const db = getFirestore();
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
}

interface GenerationHistory {
  id: string;
  thumbnail: string | null;
  prompt: string;
  productCategory: string;
  createdAt: number;
  imageCount: number;
  cost: number;
}

export default function Account() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [credits, setCredits] = useState(0);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [history, setHistory] = useState<GenerationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ title?: string; message?: string }>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ✅ Success message on return from Stripe
  useEffect(() => {
    if (searchParams.get("success") === "true") {
      setAlert({
        title: "Payment Successful",
        message: "Your purchase was completed. Credits will be added to your account shortly.",
      });
      navigate("/account", { replace: true });
    }
  }, [searchParams, navigate]);

  // ✅ Real-time credits listener
  useEffect(() => {
    const handleCreditsUpdate = (e: CustomEvent) => {
      if (typeof e.detail === "number") {
        setCredits(e.detail);
        // Broadcast to NavBar
        window.dispatchEvent(new CustomEvent("creditsUpdate", { detail: e.detail }));
      }
    };
    window.addEventListener("creditsChanged", handleCreditsUpdate as EventListener);
    return () => {
      window.removeEventListener("creditsChanged", handleCreditsUpdate as EventListener);
    };
  }, []);

  // ✅ Fetch all account data
  const fetchAccountData = useCallback(async () => {
    if (!user?.uid) return;

    try {
      setLoading(true);

      // 1. Fetch subscriptions from API
      const subsRes = await fetch(`${API_BASE}/api/subscription-status?uid=${user.uid}`);
      const subsData = await subsRes.json();
      
      // ✅ Handle both array and single object response
      const subsArray = Array.isArray(subsData) ? subsData : subsData ? [subsData] : [];
      setSubscriptions(subsArray);

      console.log(`✅ Loaded ${subsArray.length} subscription(s) for user ${user.uid}`);

      // 2. Fetch generation history from Firestore
      const historyRef = collection(db, "users", user.uid, "generations");
      const historyQuery = query(historyRef, orderBy("createdAt", "desc"), limit(20));
      const historySnap = await getDocs(historyQuery);

      const historyData: GenerationHistory[] = historySnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as GenerationHistory));

      setHistory(historyData);
      console.log(`✅ Loaded ${historyData.length} generation(s)`);

      // 3. Get credits from Firestore (real-time updates via AuthContext)
      // Credits are already being updated via creditsChanged event
    } catch (err: any) {
      console.error("❌ Failed to fetch account data:", err);
      setAlert({
        title: "Error",
        message: "Failed to load account data. Please refresh the page.",
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAccountData();

    // ✅ Listen for updates from generation page
    const handleUpdate = () => {
      console.log("🔄 Account update triggered");
      fetchAccountData();
    };
    window.addEventListener("accountUpdate", handleUpdate);
    return () => window.removeEventListener("accountUpdate", handleUpdate);
  }, [fetchAccountData]);

  // ✅ Cancel a specific subscription
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
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to cancel subscription");
      }

      setAlert({
        title: "Subscription Canceled",
        message: "Your subscription will remain active until the end of the current billing period.",
      });

      // Refresh data
      await fetchAccountData();
    } catch (err: any) {
      console.error("❌ Cancel failed:", err);
      setAlert({
        title: "Error",
        message: err.message || "Failed to cancel subscription. Please try again.",
      });
    } finally {
      setActionLoading(null);
    }
  };

  // ✅ Resume a specific subscription
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
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to resume subscription");
      }

      setAlert({
        title: "Subscription Resumed",
        message: "Your subscription will continue as normal.",
      });

      await fetchAccountData();
    } catch (err: any) {
      console.error("❌ Resume failed:", err);
      setAlert({
        title: "Error",
        message: err.message || "Failed to resume subscription. Please try again.",
      });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <Page>
        <Container>
          <LoadingCard>Loading your account...</LoadingCard>
        </Container>
      </Page>
    );
  }

  return (
    <>
      <Page>
        <Container>
          {/* User Info Card */}
          <UserCard>
            <Avatar>{user?.email?.[0]?.toUpperCase() || "M"}</Avatar>
            <UserInfo>
              <UserName>Your Account</UserName>
              <UserEmail>{user?.email}</UserEmail>
            </UserInfo>
            <CreditsBox>
              <CreditsNumber>{credits.toLocaleString()}</CreditsNumber>
              <CreditsLabel>credits</CreditsLabel>
            </CreditsBox>
          </UserCard>

          {/* Subscriptions Section */}
          <Section>
            <SectionHeader>
              <SectionTitle>Subscriptions</SectionTitle>
              {subscriptions.length === 0 && (
                <UpgradeLink href="/pricing">Get a plan →</UpgradeLink>
              )}
            </SectionHeader>

            {subscriptions.length === 0 ? (
              <EmptyCard>
                <EmptyTitle>No active subscriptions</EmptyTitle>
                <EmptyText>
                  Subscribe to a plan to get monthly credits and continuous access.
                </EmptyText>
              </EmptyCard>
            ) : (
              <SubGrid>
                {subscriptions.map((sub) => (
                  <SubCard key={sub.subscriptionId}>
                    <SubHeader>
                      <SubPlanName>{sub.planName}</SubPlanName>
                      <StatusBadge $status={sub.status}>
                        {sub.cancelAtPeriodEnd ? "Canceling" : sub.status}
                      </StatusBadge>
                    </SubHeader>

                    <SubDetails>
                      <SubDetailRow>
                        <SubLabel>Price:</SubLabel>
                        <SubValue>${sub.planPrice} / {sub.cycle}</SubValue>
                      </SubDetailRow>
                      <SubDetailRow>
                        <SubLabel>Credits:</SubLabel>
                        <SubValue>{sub.credits.toLocaleString()} / {sub.cycle}</SubValue>
                      </SubDetailRow>
                      <SubDetailRow>
                        <SubLabel>Next billing:</SubLabel>
                        <SubValue>
                          {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                        </SubValue>
                      </SubDetailRow>
                    </SubDetails>

                    <SubActions>
                      {sub.cancelAtPeriodEnd ? (
                        <ResumeBtn
                          onClick={() => handleResume(sub.subscriptionId)}
                          disabled={actionLoading === sub.subscriptionId}
                        >
                          {actionLoading === sub.subscriptionId
                            ? "Resuming..."
                            : "Resume Subscription"}
                        </ResumeBtn>
                      ) : (
                        <CancelBtn
                          onClick={() => handleCancel(sub.subscriptionId)}
                          disabled={actionLoading === sub.subscriptionId}
                        >
                          {actionLoading === sub.subscriptionId
                            ? "Canceling..."
                            : "Cancel Subscription"}
                        </CancelBtn>
                      )}
                    </SubActions>
                  </SubCard>
                ))}
              </SubGrid>
            )}
          </Section>

          {/* Generation History Gallery */}
          <Section>
            <SectionHeader>
              <SectionTitle>
                Generation History
                {history.length > 0 && <CountBadge>{history.length}</CountBadge>}
              </SectionTitle>
            </SectionHeader>

            {history.length === 0 ? (
              <EmptyCard>
                <EmptyTitle>No generations yet</EmptyTitle>
                <EmptyText>
                  Your generated images will appear here. Go to the App page to create your first generation.
                </EmptyText>
              </EmptyCard>
            ) : (
              <HistoryGrid>
                {history.map((item) => (
                  <HistoryCard key={item.id}>
                    {item.thumbnail ? (
                      <HistoryThumbnail src={item.thumbnail} alt="Generated" />
                    ) : (
                      <HistoryPlaceholder>No preview</HistoryPlaceholder>
                    )}
                    <HistoryInfo>
                      <HistoryPrompt>{item.prompt || "Untitled"}</HistoryPrompt>
                      <HistoryMeta>
                        <HistoryMetaItem>
                          {item.productCategory || "Unknown"}
                        </HistoryMetaItem>
                        <HistoryMetaItem>
                          {item.imageCount} image{item.imageCount !== 1 ? "s" : ""}
                        </HistoryMetaItem>
                        <HistoryMetaItem>{item.cost} credits</HistoryMetaItem>
                      </HistoryMeta>
                      <HistoryDate>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </HistoryDate>
                    </HistoryInfo>
                  </HistoryCard>
                ))}
              </HistoryGrid>
            )}
          </Section>
        </Container>
      </Page>

      {alert.message && (
        <AlertModal
          title={alert.title}
          message={alert.message}
          onClose={() => setAlert({})}
        />
      )}
    </>
  );
}

/* ============ Styles ============ */

const Page = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  min-height: calc(100vh - 80px);
  padding: 40px 20px;
`;

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 32px;
`;

const LoadingCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 60px;
  text-align: center;
  font-size: 18px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

/* User Card */
const UserCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 32px;
  display: flex;
  align-items: center;
  gap: 24px;

  @media (max-width: 768px) {
    flex-direction: column;
    text-align: center;
  }
`;

const Avatar = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 800;
`;

const UserInfo = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const UserName = styled.h2`
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const UserEmail = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
`;

const CreditsBox = styled.div`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 20px 32px;
  text-align: center;
  min-width: 140px;
`;

const CreditsNumber = styled.div`
  font-size: 32px;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 4px;
`;

const CreditsLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  opacity: 0.9;
`;

/* Section */
const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  align-items: center;
  gap: 12px;
`;

const CountBadge = styled.span`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 700;
`;

const UpgradeLink = styled.a`
  color: ${({ theme }) => theme.colors.accent};
  font-weight: 700;
  font-size: 14px;
  text-decoration: none;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

/* Subscriptions */
const SubGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const SubCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const SubHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
`;

const SubPlanName = styled.h4`
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const StatusBadge = styled.div<{ $status: string }>`
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: ${({ $status, theme }) =>
    $status === "active"
      ? "#4caf5020"
      : $status === "canceled"
      ? "#f4433620"
      : theme.colors.inner};
  color: ${({ $status }) =>
    $status === "active" ? "#2e7d32" : $status === "canceled" ? "#c62828" : "#757575"};
`;

const SubDetails = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SubDetailRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SubLabel = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 600;
`;

const SubValue = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const SubActions = styled.div`
  display: flex;
  gap: 8px;
  margin-top: auto;
`;

const CancelBtn = styled.button`
  flex: 1;
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 16px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const ResumeBtn = styled(CancelBtn)`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
`;

/* Empty State */
const EmptyCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 48px 32px;
  text-align: center;
`;

const EmptyTitle = styled.h4`
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const EmptyText = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
`;

/* Generation History Gallery */
const HistoryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;

  @media (max-width: 768px) {
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }
`;

const HistoryCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
`;

const HistoryThumbnail = styled.img`
  width: 100%;
  height: 200px;
  object-fit: cover;
  background: ${({ theme }) => theme.colors.inner};
`;

const HistoryPlaceholder = styled.div`
  width: 100%;
  height: 200px;
  background: ${({ theme }) => theme.colors.inner};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.muted};
  font-size: 14px;
  font-weight: 600;
`;

const HistoryInfo = styled.div`
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const HistoryPrompt = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const HistoryMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const HistoryMetaItem = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 600;
`;

const HistoryDate = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  margin-top: 4px;
`;