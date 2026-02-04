import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { useAuth } from "../context/AuthContext";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

interface Invoice {
  id: string;
  number?: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  hosted_invoice_url?: string;
}

export default function Invoices() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    async function fetchInvoices() {
      if (!user?.uid) return;
      setLoading(true);
      setHasError(false);

      try {
        const res = await fetch(`${API_BASE}/api/invoices?uid=${user.uid}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Load failed");
        if (Array.isArray(data)) setInvoices(data);
        else setInvoices([]);
      } catch (err) {
        console.warn("⚠️ Failed to load invoices:", err);
        setHasError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchInvoices();
  }, [user]);

  // -------------------------------
  // ✅ 渲染逻辑
  // -------------------------------
  if (loading) {
    return (
      <Container>
        <PageHeader>
          <TitleSection>
            <PageTitle>Invoices</PageTitle>
            <PageSubtitle>View and download your payment invoices</PageSubtitle>
          </TitleSection>
        </PageHeader>
        <ComingSoonCard>
          <ComingSoonTitle>Loading your invoices...</ComingSoonTitle>
        </ComingSoonCard>
      </Container>
    );
  }

  if (hasError) {
    // 不再红字报错，只显示空状态
    return (
      <Container>
        <PageHeader>
          <TitleSection>
            <PageTitle>Invoices</PageTitle>
            <PageSubtitle>View and download your payment invoices</PageSubtitle>
          </TitleSection>
        </PageHeader>
        <ComingSoonCard>
          <ComingSoonTitle>No Invoices Yet</ComingSoonTitle>
          <ComingSoonText>
            You haven’t made any purchases or subscriptions yet. Your invoices
            will appear here after your first payment.
          </ComingSoonText>
        </ComingSoonCard>
      </Container>
    );
  }

  if (invoices.length === 0) {
    return (
      <Container>
        <PageHeader>
          <TitleSection>
            <PageTitle>Invoices</PageTitle>
            <PageSubtitle>View and download your payment invoices</PageSubtitle>
          </TitleSection>
        </PageHeader>
        <ComingSoonCard>
          <ComingSoonIcon>
            <svg
              width="72"
              height="72"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
            </svg>
          </ComingSoonIcon>
          <ComingSoonTitle>No Invoices Found</ComingSoonTitle>
          <ComingSoonText>
            Once you make your first payment or subscription, your invoice
            history will show here.
          </ComingSoonText>
          <PortalButton onClick={() => alert("Stripe Portal coming soon")}>
            Open Billing Portal
          </PortalButton>
        </ComingSoonCard>
      </Container>
    );
  }

  // -------------------------------
  // ✅ 有数据时显示发票列表
  // -------------------------------
  return (
    <Container>
      <PageHeader>
        <TitleSection>
          <PageTitle>Invoices</PageTitle>
          <PageSubtitle>View and download your payment invoices</PageSubtitle>
        </TitleSection>
      </PageHeader>

      <InvoiceList>
        {invoices.map((inv) => (
          <InvoiceCard key={inv.id}>
            <InvoiceHeader>
              <InvoiceTitle>
                Invoice #{inv.number || inv.id.slice(-6)}
              </InvoiceTitle>
              <StatusBadge $status={inv.status}>{inv.status}</StatusBadge>
            </InvoiceHeader>

            <InvoiceDetails>
              <Detail>
                <DetailLabel>Date</DetailLabel>
                <DetailValue>
                  {new Date(inv.created).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </DetailValue>
              </Detail>
              <Detail>
                <DetailLabel>Amount</DetailLabel>
                <DetailValue>
                  {inv.amount.toLocaleString()} {inv.currency.toUpperCase()}
                </DetailValue>
              </Detail>
            </InvoiceDetails>

            {inv.hosted_invoice_url ? (
              <ViewButton
                as="a"
                href={inv.hosted_invoice_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Invoice
              </ViewButton>
            ) : (
              <DisabledButton disabled>No Link</DisabledButton>
            )}
          </InvoiceCard>
        ))}
      </InvoiceList>
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
`;

const PageSubtitle = styled.p`
  margin: 0;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 500;
`;

const ComingSoonCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 60px 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
`;

const ComingSoonIcon = styled.div`
  color: ${({ theme }) => theme.colors.accent};
  opacity: 0.6;
`;

const ComingSoonTitle = styled.h2`
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const ComingSoonText = styled.p`
  margin: 0;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.6;
  max-width: 540px;
`;

const InvoiceList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
`;

const InvoiceCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const InvoiceHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const InvoiceTitle = styled.h4`
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const InvoiceDetails = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Detail = styled.div`
  text-align: left;
`;

const DetailLabel = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
`;

const DetailValue = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const StatusBadge = styled.div<{ $status: string }>`
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: ${({ $status }) =>
    $status === "paid"
      ? "#4caf5020"
      : $status === "open"
      ? "#ff980020"
      : "#9e9e9e20"};
  color: ${({ $status }) =>
    $status === "paid"
      ? "#2e7d32"
      : $status === "open"
      ? "#e65100"
      : "#616161"};
`;

const ViewButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 12px 20px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
`;

const DisabledButton = styled(ViewButton)`
  background: #ccc;
  color: #666;
  cursor: not-allowed;
`;

const PortalButton = styled(ViewButton)`
  margin-top: 10px;
`;