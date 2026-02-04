import React from "react";
import ReactDOM from "react-dom";
import styled from "styled-components";
import { SkuRule } from "./SkuRuleModal";

const MAX_SKU_TEMPLATES = 20;

interface SkuManagementModalProps {
  onClose: () => void;
  templates: Record<string, SkuRule>;
  onCreateNew: () => void;
  onEdit: (template: SkuRule) => void;
  onDelete: (templateName: string) => void;
}

export default function SkuManagementModal({
  onClose,
  templates,
  onCreateNew,
  onEdit,
  onDelete,
}: SkuManagementModalProps) {
  const templateList = Object.values(templates);
  const hasTemplates = templateList.length > 0;
  const hasReachedLimit = templateList.length >= MAX_SKU_TEMPLATES;

  const handleDelete = (templateName: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete template "${templateName}"?`
    );
    if (confirmed) {
      onDelete(templateName);
    }
  };

  return ReactDOM.createPortal(
    <Overlay onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        <Header>
          <HeaderTitle>SKU Label Settings</HeaderTitle>
          <CloseBtn onClick={onClose}>×</CloseBtn>
        </Header>

        <Body>
          <TopSection>
            <DescriptionArea>
              <Description>
                Manage your SKU naming templates for product labeling
              </Description>
              {hasReachedLimit && (
                <LimitMessage>
                  You have reached the limit of {MAX_SKU_TEMPLATES} SKU templates. Please delete one before creating a new template.
                </LimitMessage>
              )}
            </DescriptionArea>
            <CreateButton 
              onClick={onCreateNew} 
              disabled={hasReachedLimit}
              title={hasReachedLimit ? `Maximum ${MAX_SKU_TEMPLATES} templates allowed` : undefined}
            >
              + Create New Template
            </CreateButton>
          </TopSection>

          {!hasTemplates ? (
            <EmptyState>
              <EmptyTitle>No templates yet</EmptyTitle>
              <EmptyText>
                Create your first SKU template to standardize product naming
              </EmptyText>
            </EmptyState>
          ) : (
            <TemplateList>
              {templateList.map((template) => (
                <TemplateCard key={template.templateName}>
                  <TemplateLeft>
                    <TemplateName>{template.templateName}</TemplateName>
                    <TemplatePattern>{template.pattern}</TemplatePattern>
                  </TemplateLeft>
                  <TemplateActions>
                    <EditBtn onClick={() => onEdit(template)}>Edit</EditBtn>
                    <DeleteBtn onClick={() => handleDelete(template.templateName)}>
                      Delete
                    </DeleteBtn>
                  </TemplateActions>
                </TemplateCard>
              ))}
            </TemplateList>
          )}
        </Body>
      </Modal>
    </Overlay>,
    document.body
  );
}

// ===== Styled Components =====

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  width: 100%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 28px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const HeaderTitle = styled.h2`
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  font-size: 28px;
  color: ${({ theme }) => theme.colors.muted};
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.inner};
    color: ${({ theme }) => theme.colors.text};
  }
`;

const Body = styled.div`
  padding: 24px 28px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const TopSection = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
`;

const DescriptionArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
`;

const Description = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
`;

const LimitMessage = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  font-style: italic;
`;

const CreateButton = styled.button<{ disabled?: boolean }>`
  background: ${({ theme, disabled }) => disabled ? theme.colors.border : theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 18px;
  font-weight: 700;
  font-size: 14px;
  cursor: ${({ disabled }) => disabled ? "not-allowed" : "pointer"};
  transition: all 0.2s;
  opacity: ${({ disabled }) => disabled ? 0.6 : 1};

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 24px;
  text-align: center;
`;

const EmptyTitle = styled.h3`
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const EmptyText = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  max-width: 320px;
  line-height: 1.5;
`;

const TemplateList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const TemplateCard = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  transition: all 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.bg};
  }
`;

const TemplateLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
`;

const TemplateName = styled.h4`
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TemplatePattern = styled.code`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
  font-family: 'Monaco', 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TemplateActions = styled.div`
  display: flex;
  gap: 8px;
  flex-shrink: 0;
`;

const EditBtn = styled.button`
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 6px 14px;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

const DeleteBtn = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 6px 14px;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;