import React, { useState } from "react";
import ReactDOM from "react-dom";
import styled from "styled-components";

interface SkuRuleModalProps {
  onClose: () => void;
  onSave: (rule: SkuRule) => void;
  existingRule?: SkuRule;
}

export interface SkuRule {
  templateName: string; // Unique template name
  pattern: string;
  variables: SkuVariable[];
  separator: string;
  prefix: string;
  suffix: string;
  seqDigits: number; // Number of digits for sequence number (3 = 001, 4 = 0001)
  definitions?: Record<string, string[]>; // Field value definitions
}

export interface SkuVariable {
  id: string;
  name: string;
  value: string;
}

const defaultVariables = [
  { id: "brand_initial", name: "Brand Initial" },
  { id: "category_code", name: "Category Code" },
  { id: "collection_name", name: "Collection Name" },
  { id: "tags", name: "Tags" },
  { id: "gender_code", name: "Gender Code" },
  { id: "vendor_code", name: "Vendor Code" },
  { id: "seq_num", name: "Seq Num" },
  { id: "spec1", name: "Spec 1" },
  { id: "spec2", name: "Spec 2" },
];

export default function SkuRuleModal({
  onClose,
  onSave,
  existingRule,
}: SkuRuleModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  
  // Template Name
  const [templateName, setTemplateName] = useState(existingRule?.templateName || "");
  
  // Step 1: Pattern Building
  const [pattern, setPattern] = useState(existingRule?.pattern || "");
  const [separator, setSeparator] = useState(existingRule?.separator || "-");
  const [prefix, setPrefix] = useState(existingRule?.prefix || "");
  const [suffix, setSuffix] = useState(existingRule?.suffix || "");
  const [seqDigits, setSeqDigits] = useState(existingRule?.seqDigits || 3);
  const [selectedVars, setSelectedVars] = useState<string[]>(
    existingRule?.variables?.map(v => v.id) || []
  );

  // Step 2: Field Definitions
  const [definitions, setDefinitions] = useState<Record<string, string[]>>(
    existingRule?.definitions || {}
  );
  const [editingField, setEditingField] = useState<string | null>(null);
  const [tempValues, setTempValues] = useState<string>("");

  // Custom Variables
  const [customVariables, setCustomVariables] = useState<{ id: string; name: string }[]>(
    existingRule?.variables
      ?.filter((v) => !defaultVariables.some((dv) => dv.id === v.id))
      .map((v) => ({ id: v.id, name: v.name })) || []
  );
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customVarName, setCustomVarName] = useState("");

  const allVariables = [...defaultVariables, ...customVariables];

  const addVariable = (varId: string) => {
    const varName = allVariables.find((v) => v.id === varId)?.name;
    if (varName && !pattern.includes(`[${varName}]`)) {
      setPattern(pattern + `[${varName}]`);
      if (!selectedVars.includes(varId)) {
        setSelectedVars([...selectedVars, varId]);
      }
    }
  };

  const removeLastVariable = () => {
    const matches = pattern.match(/\[([^\]]+)\]$/);
    if (matches) {
      const lastVar = matches[1];
      const varId = allVariables.find((v) => v.name === lastVar)?.id;
      if (varId) {
        setSelectedVars(selectedVars.filter((id) => id !== varId));
      }
      setPattern(pattern.replace(/\[([^\]]+)\]$/, ""));
    }
  };

  const generatePreview = () => {
    let preview = prefix;
    if (preview && separator) preview += separator; // Add separator after prefix
    
    const sampleValues = pattern.match(/\[(.*?)\]/g) || [];
    preview += sampleValues
      .map((v, idx) => {
        const varName = v.replace(/[\[\]]/g, "");
        if (varName === "Seq Num") {
          return "0".repeat(seqDigits - 1) + "1"; // e.g., 001 or 0001
        }
        return "Sample";
      })
      .join(separator);
    
    if (suffix) {
      if (separator) preview += separator; // Add separator before suffix
      preview += suffix;
    }
    
    return preview || "No pattern defined";
  };

  const handleNextStep = () => {
    if (!templateName.trim()) {
      alert("Please enter a template name");
      return;
    }
    if (!pattern.trim()) {
      alert("Please build a pattern first");
      return;
    }
    setStep(2);
  };

  const handleSaveDefinitions = () => {
    const variables: SkuVariable[] = selectedVars.map((id) => {
      const v = allVariables.find((av) => av.id === id);
      return { id, name: v?.name || "", value: "" };
    });

    const ruleToSave = {
      templateName,
      pattern,
      variables,
      separator,
      prefix,
      suffix,
      seqDigits,
      definitions,
    };

    console.log("Saving SKU rule:", ruleToSave); // Debug log
    onSave(ruleToSave);
    onClose(); // Close modal after save
  };

  const startEditField = (varId: string) => {
    setEditingField(varId);
    setTempValues((definitions[varId] || []).join(", "));
  };

  const saveFieldDefinition = () => {
    if (editingField) {
      const values = tempValues
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v);
      setDefinitions({ ...definitions, [editingField]: values });
      setEditingField(null);
      setTempValues("");
    }
  };

  const addCustomVariable = () => {
    const name = customVarName.trim();
    if (!name) return;
    const id = "custom_" + name.toLowerCase().replace(/\s+/g, "_");
    if (allVariables.some((v) => v.id === id || v.name.toLowerCase() === name.toLowerCase())) {
      alert("A variable with this name already exists");
      return;
    }
    setCustomVariables([...customVariables, { id, name }]);
    setCustomVarName("");
    setShowAddCustom(false);
  };

  const removeCustomVariable = (varId: string) => {
    setCustomVariables(customVariables.filter((v) => v.id !== varId));
    // Also remove from pattern and selectedVars if present
    const varName = customVariables.find((v) => v.id === varId)?.name;
    if (varName) {
      setPattern((prev) => prev.replace(`[${varName}]`, ""));
      setSelectedVars((prev) => prev.filter((id) => id !== varId));
    }
    // Clean up definitions
    const newDefs = { ...definitions };
    delete newDefs[varId];
    setDefinitions(newDefs);
  };

  return ReactDOM.createPortal(
    <Overlay onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>
            {step === 1 ? "Step 1: Build Pattern" : "Step 2: Define Field Values"}
          </ModalTitle>
          <CloseButton onClick={onClose}>×</CloseButton>
        </ModalHeader>

        <ModalBody>
          {step === 1 ? (
            <>
              {/* Template Name */}
              <Section>
                <SectionLabel>Template Name:</SectionLabel>
                <Help>Give this template a unique name (e.g., "Jewelry Default", "Fashion Basic")</Help>
                <SmallInput
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Enter template name..."
                  maxLength={50}
                />
              </Section>

              {/* Step 1: Build Pattern */}
              <Section>
                <SectionLabel>Pattern Structure:</SectionLabel>
                <PatternDisplay>
                  {pattern || "Click buttons below to build your pattern"}
                </PatternDisplay>
                <ButtonRow>
                  <RemoveVarBtn onClick={removeLastVariable} disabled={!pattern}>
                    Remove Last
                  </RemoveVarBtn>
                  <ClearBtn onClick={() => { setPattern(""); setSelectedVars([]); }}>
                    Clear All
                  </ClearBtn>
                </ButtonRow>
              </Section>

              <Section>
                <SectionLabel>Available Variables:</SectionLabel>
                <Help>Click to add variables to your pattern</Help>
                <VariableGrid>
                  {allVariables.map((v) => {
                    const isCustom = customVariables.some((cv) => cv.id === v.id);
                    return (
                      <VariableButtonWrapper key={v.id}>
                        <VariableButton
                          onClick={() => addVariable(v.id)}
                          disabled={pattern.includes(`[${v.name}]`)}
                        >
                          {v.name}
                        </VariableButton>
                        {isCustom && (
                          <RemoveCustomBtn
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCustomVariable(v.id);
                            }}
                            title="Remove custom variable"
                          >
                            ×
                          </RemoveCustomBtn>
                        )}
                      </VariableButtonWrapper>
                    );
                  })}
                  <AddCustomBtn onClick={() => setShowAddCustom(true)}>
                    +
                  </AddCustomBtn>
                </VariableGrid>
                {showAddCustom && (
                  <AddCustomRow>
                    <CustomInput
                      value={customVarName}
                      onChange={(e) => setCustomVarName(e.target.value)}
                      placeholder="Variable name..."
                      maxLength={30}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addCustomVariable();
                        if (e.key === "Escape") { setShowAddCustom(false); setCustomVarName(""); }
                      }}
                    />
                    <AddConfirmBtn onClick={addCustomVariable}>Add</AddConfirmBtn>
                    <AddCancelBtn onClick={() => { setShowAddCustom(false); setCustomVarName(""); }}>
                      Cancel
                    </AddCancelBtn>
                  </AddCustomRow>
                )}
              </Section>

              <Section>
                <SectionLabel>Separator:</SectionLabel>
                <SmallInput
                  value={separator}
                  onChange={(e) => setSeparator(e.target.value)}
                  placeholder="-"
                  maxLength={3}
                />
              </Section>

              <Section>
                <SectionLabel>Sequence Number Digits:</SectionLabel>
                <Help>Choose how many digits for auto-numbering (e.g., 001 vs 0001)</Help>
                <DigitsStepperWrapper>
                  <DigitsStepper>
                    <DigitsStepBtn
                      onClick={() => setSeqDigits(Math.max(2, seqDigits - 1))}
                    >
                      −
                    </DigitsStepBtn>
                    <DigitsDisplay>{seqDigits}</DigitsDisplay>
                    <DigitsStepBtn
                      onClick={() => setSeqDigits(Math.min(10, seqDigits + 1))}
                    >
                      +
                    </DigitsStepBtn>
                  </DigitsStepper>
                  <DigitsExample>
                    Example: {`${"0".repeat(seqDigits - 1)}1`}
                  </DigitsExample>
                </DigitsStepperWrapper>
              </Section>

              <TwoColumn>
                <Section>
                  <SectionLabel>Prefix:</SectionLabel>
                  <SmallInput
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="Optional prefix..."
                  />
                </Section>
                <Section>
                  <SectionLabel>Suffix:</SectionLabel>
                  <SmallInput
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    placeholder="Optional suffix..."
                  />
                </Section>
              </TwoColumn>

              <Section>
                <SectionLabel>Preview:</SectionLabel>
                <PreviewBox>{generatePreview()}</PreviewBox>
              </Section>
            </>
          ) : (
            <>
              {/* Step 2: Define Field Values */}
              <Section>
                <SectionLabel>Define Available Values for Each Field:</SectionLabel>
                <Help>
                  List all possible codes/abbreviations for each variable so they appear as dropdown options when generating SKUs. For example, Category Code might include: NEC, RNG, BRAC, EAR. Seq Num is auto-generated.
                </Help>
              </Section>

              <DefinitionsTable>
                <thead>
                  <tr>
                    <TableHeader>Variable</TableHeader>
                    <TableHeader>Type</TableHeader>
                    <TableHeader>Example Values</TableHeader>
                    <TableHeader>Action</TableHeader>
                  </tr>
                </thead>
                <tbody>
                  {selectedVars.map((varId) => {
                    const varInfo = allVariables.find((v) => v.id === varId);
                    const isSeqNum = varId === "seq_num";
                    const values = definitions[varId] || [];

                    return (
                      <tr key={varId}>
                        <TableCell>{varInfo?.name}</TableCell>
                        <TableCell>
                          {isSeqNum ? (
                            <TypeBadge $auto>Auto</TypeBadge>
                          ) : (
                            <TypeBadge>Dropdown</TypeBadge>
                          )}
                        </TableCell>
                        <TableCell>
                          {isSeqNum ? (
                            <span style={{ color: "#999" }}>
                              {"0".repeat(seqDigits - 1)}1–{"9".repeat(seqDigits)} ({seqDigits} digits)
                            </span>
                          ) : values.length > 0 ? (
                            <ValuesList>
                              {values.slice(0, 3).map((val, idx) => (
                                <ValueChip key={idx}>{val}</ValueChip>
                              ))}
                              {values.length > 3 && <span>+{values.length - 3}</span>}
                            </ValuesList>
                          ) : (
                            <span style={{ color: "#999" }}>Not defined</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {!isSeqNum && (
                            <EditBtn onClick={() => startEditField(varId)}>
                              Edit
                            </EditBtn>
                          )}
                        </TableCell>
                      </tr>
                    );
                  })}
                </tbody>
              </DefinitionsTable>
            </>
          )}
        </ModalBody>

        <ModalFooter>
          {step === 1 ? (
            <>
              <CancelButton onClick={onClose}>Cancel</CancelButton>
              <NextButton onClick={handleNextStep} disabled={!pattern.trim() || !templateName.trim()}>
                Next: Define Values
              </NextButton>
            </>
          ) : (
            <>
              <BackButton onClick={() => setStep(1)}>Back</BackButton>
              <CancelButton onClick={onClose}>Cancel</CancelButton>
              <SaveButton onClick={handleSaveDefinitions}>Save Template</SaveButton>
            </>
          )}
        </ModalFooter>

        {/* Edit Field Popup */}
        {editingField && (
          <EditOverlay onClick={() => setEditingField(null)}>
            <EditCard onClick={(e) => e.stopPropagation()}>
              <EditTitle>
                Edit {allVariables.find((v) => v.id === editingField)?.name}
              </EditTitle>
              <EditHelp>
                Enter comma-separated values (e.g., "ONDEE, TRQL, VDL")
              </EditHelp>
              <EditTextarea
                rows={4}
                value={tempValues}
                onChange={(e) => setTempValues(e.target.value)}
                placeholder="Value1, Value2, Value3..."
              />
              <EditActions>
                <CancelButton onClick={() => setEditingField(null)}>
                  Cancel
                </CancelButton>
                <SaveButton onClick={saveFieldDefinition}>Save</SaveButton>
              </EditActions>
            </EditCard>
          </EditOverlay>
        )}
      </Modal>
    </Overlay>,
    document.body
  );
}

/* Styled Components */

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  width: 90%;
  max-width: 700px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const ModalTitle = styled.h3`
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const CloseButton = styled.button`
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

const ModalBody = styled.div`
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionLabel = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const Help = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.4;
`;

const PatternDisplay = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 14px;
  font-size: 15px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  font-family: 'Monaco', 'Courier New', monospace;
  min-height: 48px;
  display: flex;
  align-items: center;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 8px;
`;

const RemoveVarBtn = styled.button`
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  flex: 1;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.inner};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const ClearBtn = styled(RemoveVarBtn)`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.accent};
    opacity: 0.9;
  }
`;

const VariableGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
`;

const VariableButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  width: 100%;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const VariableButtonWrapper = styled.div`
  position: relative;
`;

const RemoveCustomBtn = styled.button`
  position: absolute;
  top: -8px;
  right: -8px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: all 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

const AddCustomBtn = styled(VariableButton).attrs({ as: 'button' })`
  font-size: 16px;
  line-height: 1;
`;

const AddCustomRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
`;

const CustomInput = styled.input`
  flex: 1;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.inner};
  padding: 9px 12px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  font-family: inherit;

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }

  &:focus {
    outline: none;
  }
`;

const AddConfirmBtn = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;

  &:hover {
    opacity: 0.9;
  }
`;

const AddCancelBtn = styled.button`
  background: transparent;
  color: ${({ theme }) => theme.colors.muted};
  border: none;
  padding: 9px 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;

  &:hover {
    color: ${({ theme }) => theme.colors.text};
  }
`;

const SmallInput = styled.input`
  width: 100%;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.inner};
  padding: 10px 12px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  font-family: inherit;

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }

  &:focus {
    outline: none;
  }
`;

const TwoColumn = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
`;

const DigitsStepperWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const DigitsStepper = styled.div`
  display: flex;
  align-items: center;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
`;

const DigitsStepBtn = styled.button`
  background: transparent;
  color: ${({ theme }) => theme.colors.text};
  border: none;
  font-size: 18px;
  font-weight: 800;
  padding: 6px 10px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.7;
  }
`;

const DigitsDisplay = styled.div`
  min-width: 28px;
  text-align: center;
  font-weight: 700;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

const DigitsExample = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  font-family: 'Monaco', 'Courier New', monospace;
`;

const PreviewBox = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 14px;
  font-size: 15px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  font-family: 'Monaco', 'Courier New', monospace;
  min-height: 48px;
  display: flex;
  align-items: center;
`;

/* Step 2 Styles */
const DefinitionsTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
`;

const TableHeader = styled.th`
  text-align: left;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.muted};
  text-transform: uppercase;
  border-bottom: 2px solid ${({ theme }) => theme.colors.border};
`;

const TableCell = styled.td`
  padding: 12px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const TypeBadge = styled.span<{ $auto?: boolean }>`
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: ${({ $auto, theme }) =>
    $auto ? theme.colors.accent + "20" : theme.colors.inner};
  color: ${({ $auto, theme }) => ($auto ? theme.colors.accent : theme.colors.text)};
`;

const ValuesList = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
`;

const ValueChip = styled.span`
  background: ${({ theme }) => theme.colors.inner};
  padding: 4px 8px;
  border-radius: ${({ theme }) => theme.radius.btn};
  font-size: 11px;
  font-weight: 600;
`;

const EditBtn = styled.button`
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.colors.accent};
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 8px;
  transition: all 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

const EditOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
`;

const EditCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 24px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
`;

const EditTitle = styled.h4`
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const EditHelp = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  margin-bottom: 12px;
`;

const EditTextarea = styled.textarea`
  width: 100%;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.inner};
  padding: 12px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  font-family: inherit;
  resize: vertical;

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }

  &:focus {
    outline: none;
  }
`;

const EditActions = styled.div`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 16px;
`;

const ModalFooter = styled.div`
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  align-items: center;
`;

const BackButton = styled.button`
  background: transparent;
  color: ${({ theme }) => theme.colors.text};
  border: none;
  padding: 10px 16px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.7;
  }
`;

const CancelButton = styled.button`
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 24px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

const NextButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 24px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SaveButton = styled(NextButton)``;