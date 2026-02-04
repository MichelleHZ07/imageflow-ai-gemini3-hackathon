import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";
import SkuRuleModal, { SkuRule } from "../components/SkuRuleModal";
import SkuManagementModal from "../components/SkuManagementModal";
import AlertModal from "../components/AlertModal";
import {
  getUserSkuTemplates,
  saveSkuTemplate,
  deleteSkuTemplate,
} from "../lib/skuTemplateUtils";

const db = getFirestore();

export default function AccountSettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [memberSince, setMemberSince] = useState("");
  
  // SKU Management States
  const [showSkuManagementModal, setShowSkuManagementModal] = useState(false);
  const [showSkuRuleModal, setShowSkuRuleModal] = useState(false);
  const [skuTemplates, setSkuTemplates] = useState<Record<string, SkuRule>>({});
  const [editingTemplate, setEditingTemplate] = useState<SkuRule | undefined>(undefined);
  const [alert, setAlert] = useState<{ title?: string; message?: string }>({});

  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);

    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const creditsValue = data?.credits || 0;
          const createdAt = data?.createdAt?.toDate?.()
            ? data.createdAt.toDate().toLocaleDateString()
            : "—";
          setCredits(creditsValue);
          setMemberSince(createdAt);
          
          window.dispatchEvent(
            new CustomEvent("creditsChanged", { detail: creditsValue })
          );
        }
        setLoading(false);
      },
      (error) => {
        console.error("Failed to load credits:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Load SKU templates from subcollection
  useEffect(() => {
    if (!user?.uid) return;

    const loadTemplates = async () => {
      try {
        const templates = await getUserSkuTemplates(user.uid);
        setSkuTemplates(templates);
        console.log("📥 Loaded SKU templates:", Object.keys(templates));
      } catch (error) {
        console.error("❌ Failed to load SKU templates:", error);
      }
    };

    loadTemplates();
  }, [user?.uid]);

  const handleOpenSkuManagement = () => {
    setShowSkuManagementModal(true);
  };

  const handleCreateNewTemplate = () => {
    setEditingTemplate(undefined);
    setShowSkuManagementModal(false);
    setShowSkuRuleModal(true);
  };

  const handleEditTemplate = (template: SkuRule) => {
    setEditingTemplate(template);
    setShowSkuManagementModal(false);
    setShowSkuRuleModal(true);
  };

  const handleSaveSkuRule = async (rule: SkuRule) => {
    if (!user?.uid) return;
    
    try {
      // Save template to subcollection and set as active
      await saveSkuTemplate(user.uid, rule, true);
      
      // Reload templates
      const updatedTemplates = await getUserSkuTemplates(user.uid);
      setSkuTemplates(updatedTemplates);
      setShowSkuRuleModal(false);
      setEditingTemplate(undefined);
      
      // Show success alert
      setAlert({
        title: "Success",
        message: `Template "${rule.templateName}" saved successfully!`,
      });
      
      // Reopen management modal after alert is closed
      setTimeout(() => setShowSkuManagementModal(true), 100);
    } catch (error) {
      console.error("❌ Failed to save SKU template:", error);
      setAlert({
        title: "Save Failed",
        message: "Could not save SKU template. Please try again.",
      });
    }
  };

  const handleDeleteTemplate = async (templateName: string) => {
    if (!user?.uid) return;
    
    try {
      await deleteSkuTemplate(user.uid, templateName);
      
      // Reload templates
      const updatedTemplates = await getUserSkuTemplates(user.uid);
      setSkuTemplates(updatedTemplates);
      
      setAlert({
        title: "Success",
        message: `Template "${templateName}" deleted successfully!`,
      });
    } catch (error) {
      console.error("❌ Failed to delete SKU template:", error);
      setAlert({
        title: "Delete Failed",
        message: "Could not delete SKU template. Please try again.",
      });
    }
  };

  return (
    <Container>
      <PageHeader>
        <TitleSection>
          <PageTitle>Account Settings</PageTitle>
          <PageSubtitle>Manage your profile and preferences</PageSubtitle>
        </TitleSection>
      </PageHeader>

      <ContentGrid>
        {/* ===== Left: Main Info ===== */}
        <MainColumn>
          <SectionCard>
            <SectionHeader>
              <SectionTitle>Credits Balance</SectionTitle>
            </SectionHeader>

            {loading ? (
              <CreditsDisplay>
                <CreditsNumber>Loading...</CreditsNumber>
              </CreditsDisplay>
            ) : (
              <>
                <CreditsDisplay>
                  <CreditsBadge>
                    <CreditsIcon>
                      <svg
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </CreditsIcon>
                    <CreditsAmount>
                      <CreditsNumber>{credits.toLocaleString()}</CreditsNumber>
                      <CreditsLabel>available credits</CreditsLabel>
                    </CreditsAmount>
                  </CreditsBadge>
                </CreditsDisplay>

                <CreditsInfo>
                  Each image generation costs 10 credits. Visit the Pricing page
                  to purchase more credits or subscribe to a monthly plan.
                </CreditsInfo>

                <ActionButton
                  onClick={() => (window.location.href = "/pricing")}
                >
                  Get More Credits
                </ActionButton>
              </>
            )}
          </SectionCard>

          <SectionCard>
            <SectionHeader>
              <SectionTitle>Profile Information</SectionTitle>
            </SectionHeader>

            <InfoList>
              <InfoItem>
                <InfoLabel>Email Address</InfoLabel>
                <InfoValue>{user?.email}</InfoValue>
              </InfoItem>

              <InfoDivider />

              <InfoItem>
                <InfoLabel>Account Type</InfoLabel>
                <InfoValue>Pro User</InfoValue>
              </InfoItem>

              <InfoDivider />

              <InfoItem>
                <InfoLabel>Account Status</InfoLabel>
                <StatusBadge>Active</StatusBadge>
              </InfoItem>
            </InfoList>
          </SectionCard>
        </MainColumn>

        {/* ===== Right: Actions ===== */}
        <SideColumn>
          <SectionCard>
            <SectionHeader>
              <SectionTitle>Quick Actions</SectionTitle>
            </SectionHeader>

            <ActionsList>
              <ActionLink
                onClick={() => navigate("/account/subscriptions")}
              >
                <ActionIconBox>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                    <line x1="1" y1="10" x2="23" y2="10" />
                  </svg>
                </ActionIconBox>
                <ActionText>
                  <ActionTitle>Manage Subscriptions</ActionTitle>
                  <ActionDesc>View and update your plans</ActionDesc>
                </ActionText>
              </ActionLink>

              <ActionLink
                onClick={() => navigate("/account/history")}
              >
                <ActionIconBox>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </ActionIconBox>
                <ActionText>
                  <ActionTitle>Generation History</ActionTitle>
                  <ActionDesc>Review past generations</ActionDesc>
                </ActionText>
              </ActionLink>

              <ActionLink
                onClick={() => navigate("/account/invoices")}
              >
                <ActionIconBox>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                  </svg>
                </ActionIconBox>
                <ActionText>
                  <ActionTitle>Invoices</ActionTitle>
                  <ActionDesc>Download receipts</ActionDesc>
                </ActionText>
              </ActionLink>

              {/* SKU Label Settings - Opens Management Modal */}
              <ActionLink onClick={handleOpenSkuManagement}>
                <ActionIconBox>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
                    <line x1="7" y1="7" x2="7.01" y2="7"/>
                  </svg>
                </ActionIconBox>
                <ActionText>
                  <ActionTitle>SKU Label Settings</ActionTitle>
                  <ActionDesc>Configure product naming rules</ActionDesc>
                </ActionText>
              </ActionLink>

              {/* NEW: Spreadsheet Templates */}
              <ActionLink onClick={() => navigate("/account/csv-templates")}>
                <ActionIconBox>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="16" y2="17" />
                    <line x1="10" y1="9" x2="8" y2="9" />
                  </svg>
                </ActionIconBox>
                <ActionText>
                  <ActionTitle>Spreadsheet Templates</ActionTitle>
                  <ActionDesc>Connect your CSV / Excel product files</ActionDesc>
                </ActionText>
              </ActionLink>
            </ActionsList>
          </SectionCard>

          <SectionCard>
            <SectionHeader>
              <SectionTitle>Feedback</SectionTitle>
            </SectionHeader>
            <FeedbackText>
              We'd love to hear your thoughts! Share your feedback or feature
              ideas to help us improve ImageFlow.
            </FeedbackText>
            <ActionButton
              onClick={() => (window.location.href = "/feedback")}
              style={{ alignSelf: "flex-start", padding: "10px 22px" }}
            >
              Send Feedback
            </ActionButton>
          </SectionCard>
        </SideColumn>
      </ContentGrid>

      {/* SKU Management Modal */}
      {showSkuManagementModal && (
        <SkuManagementModal
          onClose={() => setShowSkuManagementModal(false)}
          templates={skuTemplates}
          onCreateNew={handleCreateNewTemplate}
          onEdit={handleEditTemplate}
          onDelete={handleDeleteTemplate}
        />
      )}

      {/* SKU Rule Modal */}
      {showSkuRuleModal && (
        <SkuRuleModal
          onClose={() => {
            setShowSkuRuleModal(false);
            setEditingTemplate(undefined);
            setShowSkuManagementModal(true); // Reopen management modal
          }}
          onSave={handleSaveSkuRule}
          existingRule={editingTemplate}
        />
      )}

      {/* Alert Modal */}
      {alert.message && (
        <AlertModal
          title={alert.title}
          message={alert.message}
          onClose={() => setAlert({})}
        />
      )}
    </Container>
  );
}

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

const ContentGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 24px;
  align-items: start;

  @media (max-width: 1024px) {
    grid-template-columns: 1fr;
  }
`;

const MainColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const SideColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const SectionCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const CreditsDisplay = styled.div`
  display: flex;
  justify-content: center;
  padding: 32px 24px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
`;

const CreditsBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 20px;
`;

const CreditsIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  flex-shrink: 0;
`;

const CreditsAmount = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const CreditsNumber = styled.div`
  font-size: 42px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  line-height: 1;
`;

const CreditsLabel = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

const CreditsInfo = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.6;
  text-align: center;
`;

const ActionButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 14px 28px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.2s;
  align-self: center;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
`;

const InfoList = styled.div`
  display: flex;
  flex-direction: column;
`;

const InfoItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding: 16px 0;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
`;

const InfoDivider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.border};
`;

const InfoLabel = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

const InfoValue = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  text-align: right;
`;

const StatusBadge = styled.div`
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  background: #4caf5020;
  color: #2e7d32;
`;

const ActionsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ActionLink = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: transparent;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;

  &:hover {
    background: ${({ theme }) => theme.colors.inner};
  }
`;

const ActionIconBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.inner};
  color: ${({ theme }) => theme.colors.accent};
  flex-shrink: 0;
`;

const ActionText = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ActionTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const ActionDesc = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.muted};
`;

const FeedbackText = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.6;
`;