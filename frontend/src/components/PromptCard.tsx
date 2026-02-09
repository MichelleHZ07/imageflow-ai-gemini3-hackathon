import React, { memo, useState, useEffect, useRef } from "react";
import styled from "styled-components";
import { InfoTooltip } from "./InfoTooltip";
import {
  ToggleWrapper,
  ToggleTrack,
  ToggleThumb,
  ToggleLabelLeft,
  ToggleLabelRight,
} from "../styles/layout";
import SkuRuleModal, { SkuRule } from "./SkuRuleModal";

type WorkMode = "import" | "create";
type GenStrategy = "auto" | "manual";
type SkuMode = "rule" | "direct";

export type AspectRatio = "1:1" | "3:4" | "4:3" | "2:3" | "3:2" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
export type Resolution = "1024" | "2048" | "4096";

export const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "4:3", label: "4:3 (Landscape)" },
  { value: "3:4", label: "3:4 (Portrait)" },
  { value: "16:9", label: "16:9 (Wide)" },
  { value: "9:16", label: "9:16 (Tall)" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "5:4", label: "5:4" },
  { value: "4:5", label: "4:5" },
  { value: "21:9", label: "21:9 (Ultrawide)" },
];

/**
 * Gemini 3 resolution tiers (longest side in px):
 *  - 1K  = 1024  (gemini-3-pro + gemini-2.5-flash-image)
 *  - 2K  = 2048  (gemini-3-pro only)
 *  - 4K  = 4096  (gemini-3-pro only)
 */
export const RESOLUTION_TIERS: Resolution[] = ["1024", "2048", "4096"];

/** Human-friendly tier labels for the dropdown */
const RESOLUTION_TIER_LABELS: Record<Resolution, string> = {
  "1024": "1K",
  "2048": "2K",
  "4096": "4K",
};

/**
 * Compute actual pixel dimensions from aspect ratio + resolution tier.
 * The tier value = longest side; the shorter side is derived from the ratio.
 * Matches Gemini 3 API output dimensions.
 */
export function getImageDimensions(
  aspectRatio: AspectRatio,
  resolution: Resolution
): { width: number; height: number } {
  const base = parseInt(resolution);
  const ratioMap: Record<AspectRatio, [number, number]> = {
    "1:1":  [1, 1],
    "4:3":  [4, 3],
    "3:4":  [3, 4],
    "16:9": [16, 9],
    "9:16": [9, 16],
    "3:2":  [3, 2],
    "2:3":  [2, 3],
    "5:4":  [5, 4],
    "4:5":  [4, 5],
    "21:9": [21, 9],
  };

  const [rw, rh] = ratioMap[aspectRatio];

  if (rw >= rh) {
    // Width is the longer (or equal) side
    return { width: base, height: Math.round(base * rh / rw) };
  } else {
    // Height is the longer side
    return { width: Math.round(base * rw / rh), height: base };
  }
}

/** Build resolution dropdown options with computed W×H labels */
export function getResolutionOptions(aspectRatio: AspectRatio) {
  return RESOLUTION_TIERS.map((tier) => {
    const tierLabel = RESOLUTION_TIER_LABELS[tier];
    return { value: tier, label: tierLabel };
  });
}

/** Placeholder hints for manual variation inputs */
const VARIATION_PLACEHOLDERS = [
  "Front angle, soft lighting, white background",
  "Close-up of product detail, bokeh background",
  "Side angle showing product profile",
  "Variation 4...",
];

interface PromptCardProps {
  workMode: WorkMode;
  onWorkModeChange: (m: WorkMode) => void;
  productCategory: string;
  onCategoryChange: (v: string) => void;
  mainPrompt: string;
  onMainChange: (v: string) => void;
  variations: string[];
  onVariationsChange: (arr: string[]) => void;
  isLoading?: boolean;
  genCount: number;
  onGenCountChange: (v: number) => void;
  genStrategy: GenStrategy;
  onGenStrategyChange: (v: GenStrategy) => void;
  skuEnabled?: boolean;
  onSkuToggle?: () => void;
  skuMode?: SkuMode;
  onSkuModeChange?: (mode: SkuMode) => void;
  skuTemplates?: Record<string, SkuRule>;
  activeTemplate?: string;
  onSelectTemplate?: (templateName: string) => void;
  skuRule?: SkuRule | null;
  onSkuRuleSave?: (rule: SkuRule) => void;
  skuDirectInput?: string;
  onSkuDirectInputChange?: (value: string) => void;
  skuVariableValues?: Record<string, string>;
  onSkuVariableChange?: (varId: string, value: string) => void;
  onSaveSkuName?: () => void;
  savedSkuName?: string;
  // New props for spreadsheet SKU auto-fill
  useSpreadsheetProducts?: boolean;
  spreadsheetSku?: string;
  // New props for sequence number option in Direct Input mode
  directInputAddSequence?: boolean;
  onDirectInputAddSequenceChange?: (v: boolean) => void;
  directInputSeqDigits?: number;
  onDirectInputSeqDigitsChange?: (v: number) => void;
  // New props for sequence number override in Rule-Based mode
  ruleBasedSeqDigits?: number;
  onRuleBasedSeqDigitsChange?: (v: number) => void;
  // Output Settings
  aspectRatio?: AspectRatio;
  onAspectRatioChange?: (v: AspectRatio) => void;
  resolution?: Resolution;
  onResolutionChange?: (v: Resolution) => void;
}

function PromptCardComponent({
  workMode,
  onWorkModeChange,
  productCategory,
  onCategoryChange,
  mainPrompt,
  onMainChange,
  variations,
  onVariationsChange,
  isLoading,
  genCount,
  onGenCountChange,
  genStrategy,
  onGenStrategyChange,
  skuEnabled = false,
  onSkuToggle,
  skuMode = "rule",
  onSkuModeChange,
  skuTemplates = {},
  activeTemplate = "",
  onSelectTemplate,
  skuRule = null,
  onSkuRuleSave,
  skuDirectInput = "",
  onSkuDirectInputChange,
  skuVariableValues = {},
  onSkuVariableChange,
  onSaveSkuName,
  savedSkuName = "",
  // New props
  useSpreadsheetProducts = false,
  spreadsheetSku = "",
  directInputAddSequence = false,
  onDirectInputAddSequenceChange,
  directInputSeqDigits = 3,
  onDirectInputSeqDigitsChange,
  ruleBasedSeqDigits,
  onRuleBasedSeqDigitsChange,
  aspectRatio = "1:1",
  onAspectRatioChange,
  resolution = "1024",
  onResolutionChange,
}: PromptCardProps) {
  const [showSkuRuleModal, setShowSkuRuleModal] = useState(false);
  
  // Track if user has manually edited the direct input
  const hasUserEditedRef = useRef(false);
  const prevSkuModeRef = useRef(skuMode);
  const prevSpreadsheetSkuRef = useRef(spreadsheetSku);

  // Auto-fill SKU when switching to Direct Input mode with spreadsheet product
  useEffect(() => {
    // Detect if we just switched to Direct Input mode
    const justSwitchedToDirectInput = 
      skuMode === "direct" && prevSkuModeRef.current !== "direct";
    
    // Detect if spreadsheet SKU changed
    const spreadsheetSkuChanged = 
      spreadsheetSku !== prevSpreadsheetSkuRef.current;
    
    // Update refs
    prevSkuModeRef.current = skuMode;
    prevSpreadsheetSkuRef.current = spreadsheetSku;
    
    // ✅ FIX: Reset the manual edit flag BEFORE the auto-fill check.
    // When spreadsheetSku changes (e.g. switching saveTargetMode), the user's
    // manual edit to the previous scenario's SKU should not block auto-fill
    // for the new scenario.
    if (spreadsheetSkuChanged) {
      hasUserEditedRef.current = false;
    }
    
    // Auto-fill or clear conditions:
    // 1. We're in direct input mode
    // 2. Either just switched to direct mode (with SKU available), or spreadsheet SKU changed
    // 3. User hasn't manually edited the input OR input is empty
    // Note: When spreadsheetSku becomes empty (e.g. switching to Create mode), clear the input
    if (
      skuMode === "direct" &&
      ((justSwitchedToDirectInput && spreadsheetSku) || spreadsheetSkuChanged) &&
      (!hasUserEditedRef.current || !skuDirectInput.trim())
    ) {
      if (onSkuDirectInputChange) {
        onSkuDirectInputChange(spreadsheetSku);
        hasUserEditedRef.current = false;
      }
    }
  }, [skuMode, spreadsheetSku, skuDirectInput, onSkuDirectInputChange]);

  // Handle user manual input
  const handleDirectInputChange = (value: string) => {
    hasUserEditedRef.current = true;
    if (onSkuDirectInputChange) {
      onSkuDirectInputChange(value);
    }
  };

  const add = () =>
    variations.length < 4 && onVariationsChange([...variations, ""]);
  const update = (i: number, v: string) => {
    const next = [...variations];
    next[i] = v;
    onVariationsChange(next);
  };
  const remove = (i: number) =>
    onVariationsChange(variations.filter((_, idx) => idx !== i));

  const handleSaveRule = (rule: SkuRule) => {
    if (onSkuRuleSave) {
      onSkuRuleSave(rule);
    }
    setShowSkuRuleModal(false);
  };

  // Use currentTemplate from skuTemplates if available, otherwise fall back to skuRule
  const currentTemplate = activeTemplate && skuTemplates[activeTemplate] ? skuTemplates[activeTemplate] : skuRule;
  const templateNames = Object.keys(skuTemplates);

  return (
    <PromptCardWrapper>
      <Head>
        <H1>Prompt</H1>
      </Head>

      {/* SKU Label Section - Available in both modes */}
      <Field>
          <SkuHeader>
            <Label>SKU Label <InfoTooltip content="Automatically name your downloaded images using your SKU naming pattern (e.g., VL-NEC-GLD-001.png). Costs 20 credits per generation." /></Label>
            <MiniToggleWrapper onClick={onSkuToggle}>
              <MiniToggleTrack $active={skuEnabled}>
                <MiniToggleThumb $active={skuEnabled} />
              </MiniToggleTrack>
            </MiniToggleWrapper>
          </SkuHeader>

          {/* SKU Placeholder when OFF */}
          {!skuEnabled && (
            <SkuPlaceholder onClick={onSkuToggle}>
              <SkuPlaceholderIcon>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
                  <line x1="7" y1="7" x2="7.01" y2="7"/>
                </svg>
              </SkuPlaceholderIcon>
              <SkuPlaceholderText>
                <SkuPlaceholderTitle>Auto-name downloads</SkuPlaceholderTitle>
                <SkuPlaceholderDesc>Enable to set SKU naming pattern</SkuPlaceholderDesc>
              </SkuPlaceholderText>
            </SkuPlaceholder>
          )}

          {skuEnabled && (
            <SkuContent>
              {/* Mode Selection */}
              <SkuModeSection>
                <SkuModeLabel>Naming Method:</SkuModeLabel>
                <ModeSwitch>
                  <SwitchBtn
                    $active={skuMode === "rule"}
                    onClick={() => onSkuModeChange && onSkuModeChange("rule")}
                    disabled={isLoading}
                  >
                    Rule-Based
                  </SwitchBtn>
                  <SwitchBtn
                    $active={skuMode === "direct"}
                    onClick={() => onSkuModeChange && onSkuModeChange("direct")}
                    disabled={isLoading}
                  >
                    Direct Input
                  </SwitchBtn>
                </ModeSwitch>
              </SkuModeSection>

              {/* Rule-Based Mode */}
              {skuMode === "rule" && (
                <>
                  {/* Template Selector - Show if multiple templates exist */}
                  {templateNames.length > 0 && (
                    <TemplateSelector>
                      <TemplateSelectorLabel>Select Template:</TemplateSelectorLabel>
                      <TemplateSelect
                        value={activeTemplate}
                        onChange={(e) => onSelectTemplate && onSelectTemplate(e.target.value)}
                        disabled={isLoading}
                      >
                        <option value="">Choose a template...</option>
                        {templateNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </TemplateSelect>
                    </TemplateSelector>
                  )}

                  {currentTemplate ? (
                    <RuleActiveSection>
                      <RuleHeader>
                        <RulePatternDisplay>
                          <RuleLabel>
                            {currentTemplate.templateName ? `Template: ${currentTemplate.templateName}` : 'Current Rule:'}
                          </RuleLabel>
                          <RulePattern>{currentTemplate.pattern}</RulePattern>
                        </RulePatternDisplay>
                        <EditRuleBtn onClick={() => setShowSkuRuleModal(true)} disabled={isLoading}>
                          Edit
                        </EditRuleBtn>
                      </RuleHeader>
                      <VariableInputs>
                        {currentTemplate.variables
                          .filter((variable) => variable.id !== "seq_num")
                          .map((variable) => {
                            const hasDefinitions = 
                              currentTemplate.definitions && 
                              currentTemplate.definitions[variable.id] && 
                              currentTemplate.definitions[variable.id].length > 0;

                            return (
                              <VariableField key={variable.id}>
                                <VariableLabel>{variable.name}:</VariableLabel>
                                {hasDefinitions ? (
                                  <VariableSelect
                                    value={skuVariableValues[variable.id] || ""}
                                    onChange={(e) =>
                                      onSkuVariableChange &&
                                      onSkuVariableChange(variable.id, e.target.value)
                                    }
                                    disabled={isLoading}
                                  >
                                    <option value="">Select {variable.name.toLowerCase()}...</option>
                                    {currentTemplate.definitions![variable.id].map((option) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </VariableSelect>
                                ) : (
                                  <VariableInput
                                    type="text"
                                    value={skuVariableValues[variable.id] || ""}
                                    onChange={(e) =>
                                      onSkuVariableChange &&
                                      onSkuVariableChange(variable.id, e.target.value)
                                    }
                                    placeholder={`Enter ${variable.name.toLowerCase()}...`}
                                    disabled={isLoading}
                                  />
                                )}
                              </VariableField>
                            );
                          })}
                      </VariableInputs>
                      
                      {/* Sequence Number Digits - Only show if template has seq_num */}
                      {currentTemplate.variables.some(v => v.id === "seq_num" || v.name.toLowerCase().includes("seq")) && (
                        <SequenceDigitsSection>
                          <SequenceDigitsLabel>Sequence Number Digits:</SequenceDigitsLabel>
                          <DigitsStepperWrapper>
                            <DigitsStepper>
                              <DigitsStepBtn
                                onClick={() => {
                                  const currentDigits = ruleBasedSeqDigits ?? currentTemplate.seqDigits ?? 3;
                                  onRuleBasedSeqDigitsChange && onRuleBasedSeqDigitsChange(Math.max(2, currentDigits - 1));
                                }}
                                disabled={isLoading}
                              >
                                -
                              </DigitsStepBtn>
                              <DigitsDisplay>{ruleBasedSeqDigits ?? currentTemplate.seqDigits ?? 3}</DigitsDisplay>
                              <DigitsStepBtn
                                onClick={() => {
                                  const currentDigits = ruleBasedSeqDigits ?? currentTemplate.seqDigits ?? 3;
                                  onRuleBasedSeqDigitsChange && onRuleBasedSeqDigitsChange(Math.min(10, currentDigits + 1));
                                }}
                                disabled={isLoading}
                              >
                                +
                              </DigitsStepBtn>
                            </DigitsStepper>
                            <DigitsExample>
                              Example: {"0".repeat((ruleBasedSeqDigits ?? currentTemplate.seqDigits ?? 3) - 1)}1
                            </DigitsExample>
                          </DigitsStepperWrapper>
                        </SequenceDigitsSection>
                      )}
                      
                      {/* SKU Preview */}
                      <SkuPreviewSection>
                        <SkuPreviewLabel>Preview:</SkuPreviewLabel>
                        <SkuPreviewBox>
                          {(() => {
                            let preview = currentTemplate.prefix;
                            if (preview && currentTemplate.separator) preview += currentTemplate.separator;
                            
                            const parts: string[] = [];
                            
                            currentTemplate.variables.forEach((variable) => {
                              if (variable.id === "seq_num") {
                                const digits = ruleBasedSeqDigits ?? currentTemplate.seqDigits ?? 3;
                                parts.push("0".repeat(digits - 1) + "1");
                              } else {
                                const value = skuVariableValues[variable.id];
                                if (value) {
                                  parts.push(value);
                                } else {
                                  parts.push("...");
                                }
                              }
                            });
                            
                            preview += parts.join(currentTemplate.separator);
                            
                            if (currentTemplate.suffix) {
                              if (currentTemplate.separator) preview += currentTemplate.separator;
                              preview += currentTemplate.suffix;
                            }
                            
                            return preview;
                          })()}
                        </SkuPreviewBox>
                      </SkuPreviewSection>

                      {/* Save SKU Button */}
                      <SaveSkuButton onClick={onSaveSkuName} disabled={isLoading || !onSaveSkuName}>
                        {savedSkuName ? "Update SKU Name" : "Save SKU Name"}
                      </SaveSkuButton>

                      {savedSkuName && (
                        <SavedSkuIndicator>
                          Saved: <strong>{savedSkuName}</strong>
                        </SavedSkuIndicator>
                      )}
                      
                      <SkuNote>
                        Sequential numbers will be assigned based on download order
                      </SkuNote>
                    </RuleActiveSection>
                  ) : (
                    <NoRuleSection>
                      <NoRuleMessage>
                        No naming rule defined
                      </NoRuleMessage>
                      <SetupRuleButton
                        onClick={() => setShowSkuRuleModal(true)}
                        disabled={isLoading}
                      >
                        + Set SKU Naming Rule
                      </SetupRuleButton>
                    </NoRuleSection>
                  )}
                </>
              )}

              {/* Direct Input Mode */}
              {skuMode === "direct" && (
                <DirectInputSection>
                  <DirectInputLabel>SKU Name:</DirectInputLabel>
                  <DirectSkuInput
                    type="text"
                    value={skuDirectInput}
                    onChange={(e) => handleDirectInputChange(e.target.value)}
                    placeholder="Enter SKU name (e.g., RING-GOLD-18K)..."
                    disabled={isLoading}
                  />
                  
                  {/* Spreadsheet SKU indicator */}
                  {spreadsheetSku && skuDirectInput === spreadsheetSku && (
                    <SpreadsheetSkuNote>
                      Auto-filled from spreadsheet
                    </SpreadsheetSkuNote>
                  )}
                  
                  {/* Sequence Number Option */}
                  <SequenceOptionRow 
                    onClick={() => onDirectInputAddSequenceChange && onDirectInputAddSequenceChange(!directInputAddSequence)}
                  >
                    <CheckboxContainer>
                      <Checkbox $checked={directInputAddSequence}>
                        {directInputAddSequence && <CheckIcon>&#10003;</CheckIcon>}
                      </Checkbox>
                    </CheckboxContainer>
                    <SequenceOptionContent>
                      <SequenceOptionTitle>Also add sequence number when downloading</SequenceOptionTitle>
                      <SequenceOptionDescription>
                        Photos will be named like: {skuDirectInput || "YourSKU"}-001, {skuDirectInput || "YourSKU"}-002...
                      </SequenceOptionDescription>
                    </SequenceOptionContent>
                  </SequenceOptionRow>
                  
                  {/* Sequence Digits Stepper - Only show when sequence is enabled */}
                  {directInputAddSequence && (
                    <SequenceDigitsSection>
                      <SequenceDigitsLabel>Sequence Number Digits:</SequenceDigitsLabel>
                      <SequenceDigitsHelp>Choose how many digits for auto-numbering (e.g., 001 vs 0001)</SequenceDigitsHelp>
                      <DigitsStepperWrapper>
                        <DigitsStepper>
                          <DigitsStepBtn
                            onClick={(e) => {
                              e.stopPropagation();
                              onDirectInputSeqDigitsChange && onDirectInputSeqDigitsChange(Math.max(2, directInputSeqDigits - 1));
                            }}
                            disabled={isLoading}
                          >
                            -
                          </DigitsStepBtn>
                          <DigitsDisplay>{directInputSeqDigits}</DigitsDisplay>
                          <DigitsStepBtn
                            onClick={(e) => {
                              e.stopPropagation();
                              onDirectInputSeqDigitsChange && onDirectInputSeqDigitsChange(Math.min(10, directInputSeqDigits + 1));
                            }}
                            disabled={isLoading}
                          >
                            +
                          </DigitsStepBtn>
                        </DigitsStepper>
                        <DigitsExample>
                          Example: {"0".repeat(directInputSeqDigits - 1)}1
                        </DigitsExample>
                      </DigitsStepperWrapper>
                    </SequenceDigitsSection>
                  )}
                  
                  {/* Preview Section - Always show */}
                  <SkuPreviewSection>
                    <SkuPreviewLabel>Preview:</SkuPreviewLabel>
                    <SkuPreviewBox>
                      {directInputAddSequence 
                        ? `${skuDirectInput || "YourSKU"}-${"0".repeat(directInputSeqDigits - 1)}1`
                        : (skuDirectInput || "YourSKU")
                      }
                    </SkuPreviewBox>
                  </SkuPreviewSection>
                  
                  {/* Save SKU Button - Always show */}
                  <SaveSkuButton 
                    onClick={onSaveSkuName} 
                    disabled={isLoading || !onSaveSkuName || !skuDirectInput.trim()}
                  >
                    {savedSkuName ? "Update SKU Name" : "Save SKU Name"}
                  </SaveSkuButton>
                  
                  {savedSkuName && (
                    <SavedSkuIndicator>
                      Saved: <strong>{savedSkuName}</strong>
                    </SavedSkuIndicator>
                  )}
                  
                  {directInputAddSequence ? (
                    <SkuNote>
                      Sequential numbers will be assigned based on download order
                    </SkuNote>
                  ) : (
                    <SkuNote>
                      Files will use the SKU name directly without sequence numbers
                    </SkuNote>
                  )}
                </DirectInputSection>
              )}
            </SkuContent>
          )}
        </Field>

      {/* Main Prompt */}
      <Field>
        <Label>Main Brief <InfoTooltip content="Describe the overall product or scene. Leave blank if you only want to use variations." /></Label>
        <Textarea
          value={mainPrompt}
          onChange={(e) => onMainChange(e.target.value)}
          placeholder="e.g., Generate this product in the same scene but different angles..."
          rows={4}
          disabled={isLoading}
        />
      </Field>

      {/* Output Settings */}
      <Field>
        <Label>Output Settings <InfoTooltip content="Configure the aspect ratio and resolution for generated images." /></Label>
        <OutputSettingsRow>
          <OutputDropdownGroup>
            <OutputDropdownLabel>ASPECT RATIO</OutputDropdownLabel>
            <OutputSelect
              value={aspectRatio}
              onChange={(e) => onAspectRatioChange && onAspectRatioChange(e.target.value as AspectRatio)}
              disabled={isLoading}
            >
              {ASPECT_RATIO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </OutputSelect>
          </OutputDropdownGroup>
          <OutputDropdownGroup>
            <OutputDropdownLabel>RESOLUTION</OutputDropdownLabel>
            <OutputSelect
              value={resolution}
              onChange={(e) => onResolutionChange && onResolutionChange(e.target.value as Resolution)}
              disabled={isLoading}
            >
              {getResolutionOptions(aspectRatio).map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </OutputSelect>
          </OutputDropdownGroup>
        </OutputSettingsRow>
      </Field>

      <SectionDivider />

      {/* Generation Strategy Switch */}
      <Field>
        <Label>Generation Mode <InfoTooltip content="Select how to create multiple images." /></Label>
        <ModeSwitch>
          <SwitchBtn
            $active={genStrategy === "auto"}
            onClick={() => onGenStrategyChange("auto")}
            disabled={isLoading}
          >
            Auto
          </SwitchBtn>
          <SwitchBtn
            $active={genStrategy === "manual"}
            onClick={() => onGenStrategyChange("manual")}
            disabled={isLoading}
          >
            Manual
          </SwitchBtn>
        </ModeSwitch>
      </Field>

      {/* AUTO Mode Settings */}
      {genStrategy === "auto" && (
        <Field>
          <Label>Auto Generation Settings <InfoTooltip content="Choose how many images to generate. AI will automatically decide how they should vary. (Up to 4)" /></Label>
          <GenOptions>
            <NumberStepper>
              <StepBtn
                onClick={() => onGenCountChange(Math.max(1, genCount - 1))}
                disabled={isLoading || genCount <= 1}
              >
                -
              </StepBtn>
              <GenCountDisplay>{genCount}</GenCountDisplay>
              <StepBtn
                onClick={() => onGenCountChange(Math.min(4, genCount + 1))}
                disabled={isLoading || genCount >= 4}
              >
                +
              </StepBtn>
            </NumberStepper>
          </GenOptions>
        </Field>
      )}

      {/* MANUAL Mode Settings */}
      {genStrategy === "manual" && (
        <Field>
          <Label>Manual Variations <InfoTooltip content="Add specific scene variations (up to 4)." /></Label>
          <VariationsContainer>
            {variations.map((v, i) => (
              <VariationRow key={i}>
                <VariationInput
                  type="text"
                  value={v}
                  onChange={(e) => update(i, e.target.value)}
                  placeholder={VARIATION_PLACEHOLDERS[i] || `Variation ${i + 1}...`}
                  disabled={isLoading}
                />
                <RemoveBtn onClick={() => remove(i)} disabled={isLoading}>
                  ×
                </RemoveBtn>
              </VariationRow>
            ))}
            {variations.length < 4 && (
              <AddVariationBtn onClick={add} disabled={isLoading}>
                + Add Variation
              </AddVariationBtn>
            )}
          </VariationsContainer>
        </Field>
      )}

      {/* SKU Rule Modal */}
      {showSkuRuleModal && (
        <SkuRuleModal
          onClose={() => setShowSkuRuleModal(false)}
          onSave={handleSaveRule}
          existingRule={currentTemplate || undefined}
        />
      )}
    </PromptCardWrapper>
  );
}

const PromptCard = memo(PromptCardComponent);
export default PromptCard;

/* ============ Styled Components ============ */

const PromptCardWrapper = styled.div`
  background: ${({ theme }: any) => theme.colors.card};
  border-radius: ${({ theme }: any) => theme.radius.lg};
  box-shadow: ${({ theme }: any) => theme.shadow.soft};
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0; /* Allow flex children to shrink for scrolling */
  overflow-y: auto;
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }: any) => theme.colors.border};
    border-radius: 2px;
  }
`;

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
`;

const H1 = styled.h2`
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  color: ${({ theme }: any) => theme.colors.text};
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 800;
  color: ${({ theme }: any) => theme.colors.text};
`;

const Help = styled.div`
  font-size: 12px;
  color: ${({ theme }: any) => theme.colors.muted};
  line-height: 1.4;
`;

const CategoryInput = styled.input`
  width: 100%;
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.md};
  background: ${({ theme }: any) => theme.colors.inner};
  padding: 12px;
  font-size: 14px;
  color: ${({ theme }: any) => theme.colors.text};
  font-family: inherit;

  &::placeholder {
    color: ${({ theme }: any) => theme.colors.muted};
  }

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const Textarea = styled.textarea`
  width: 100%;
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.md};
  background: ${({ theme }: any) => theme.colors.inner};
  padding: 12px;
  font-size: 14px;
  color: ${({ theme }: any) => theme.colors.text};
  font-family: inherit;
  resize: vertical;
  min-height: 80px;

  &::placeholder {
    color: ${({ theme }: any) => theme.colors.muted};
  }

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const ModeSwitch = styled.div`
  display: flex;
  gap: 8px;
`;

const SwitchBtn = styled.button<{ $active?: boolean }>`
  flex: 1;
  background: ${({ $active, theme }: any) =>
    $active ? theme.colors.accent : theme.colors.white};
  color: ${({ $active, theme }: any) =>
    $active ? theme.colors.white : theme.colors.text};
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.btn};
  padding: 10px 16px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const GenOptions = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
`;

const NumberStepper = styled.div`
  display: flex;
  align-items: center;
  background: ${({ theme }: any) => theme.colors.inner};
  border-radius: ${({ theme }: any) => theme.radius.md};
`;

const StepBtn = styled.button`
  background: transparent;
  color: ${({ theme }: any) => theme.colors.text};
  border: none;
  font-size: 18px;
  font-weight: 800;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.7;
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

const GenCountDisplay = styled.div`
  min-width: 32px;
  text-align: center;
  font-weight: 700;
  font-size: 16px;
  color: ${({ theme }: any) => theme.colors.text};
`;

const VariationsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const VariationRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const VariationInput = styled.input`
  flex: 1;
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.md};
  background: ${({ theme }: any) => theme.colors.inner};
  padding: 10px 12px;
  font-size: 14px;
  color: ${({ theme }: any) => theme.colors.text};
  font-family: inherit;

  &::placeholder {
    color: ${({ theme }: any) => theme.colors.muted};
  }

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const RemoveBtn = styled.button`
  background: ${({ theme }: any) => theme.colors.accent};
  color: ${({ theme }: any) => theme.colors.white};
  border: none;
  border-radius: 4px;
  width: 28px;
  height: 28px;
  font-size: 20px;
  font-weight: 400;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const AddVariationBtn = styled.button`
  background: ${({ theme }: any) => theme.colors.accent};
  color: ${({ theme }: any) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.btn};
  padding: 10px 16px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  align-self: flex-start;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

/* SKU Placeholder (when OFF) */
const SkuPlaceholder = styled.div`
  background: ${({ theme }: any) => theme.colors.inner};
  border-radius: ${({ theme }: any) => theme.radius.md};
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme }: any) => theme.colors.border};
  }
`;

const SkuPlaceholderIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: ${({ theme }: any) => theme.radius.sm || "6px"};
  background: ${({ theme }: any) => theme.colors.card};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: ${({ theme }: any) => theme.colors.muted};
`;

const SkuPlaceholderText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const SkuPlaceholderTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.text};
`;

const SkuPlaceholderDesc = styled.div`
  font-size: 11px;
  color: ${({ theme }: any) => theme.colors.muted};
`;

/* Output Settings */
const OutputSettingsRow = styled.div`
  display: flex;
  gap: 8px;
`;

const OutputDropdownGroup = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const OutputDropdownLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.3px;
`;

const OutputSelect = styled.select`
  width: 100%;
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.md};
  background: ${({ theme }: any) => theme.colors.inner};
  padding: 9px 32px 9px 10px;
  font-size: 13px;
  color: ${({ theme }: any) => theme.colors.text};
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239C8B7A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 14px;

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

/* Section Divider */
const SectionDivider = styled.div`
  height: 1px;
  background: ${({ theme }: any) => theme.colors.border};
  opacity: 0.5;
`;

/* SKU Section */
const SkuHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
`;

const MiniToggleWrapper = styled.div`
  position: relative;
  width: 44px;
  height: 24px;
  cursor: pointer;
  user-select: none;
`;

const MiniToggleTrack = styled.div<{ $active?: boolean }>`
  background: ${({ $active, theme }: any) =>
    $active ? theme.colors.accent : theme.colors.border};
  border-radius: 9999px;
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 2px;
  transition: background 0.25s ease;
`;

const MiniToggleThumb = styled.div<{ $active?: boolean }>`
  position: absolute;
  left: ${({ $active }) => ($active ? "calc(100% - 22px)" : "2px")};
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: ${({ theme }: any) => theme.colors.white};
  transition: all 0.25s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

const SkuContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background: ${({ theme }: any) => theme.colors.inner};
  border-radius: ${({ theme }: any) => theme.radius.md};
`;

const SkuModeSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SkuModeLabel = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const RuleActiveSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const RuleHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
`;

const RulePatternDisplay = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
`;

const RuleLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const RulePattern = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.text};
  font-family: 'Monaco', 'Courier New', monospace;
`;

const EditRuleBtn = styled.button`
  background: ${({ theme }: any) => theme.colors.white};
  color: ${({ theme }: any) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.btn};
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;

  &:hover:not(:disabled) {
    opacity: 0.8;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const VariableInputs = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const VariableField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const VariableLabel = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.text};
`;

const VariableInput = styled.input`
  width: 100%;
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.md};
  background: ${({ theme }: any) => theme.colors.inner};
  padding: 10px 12px;
  font-size: 14px;
  color: ${({ theme }: any) => theme.colors.text};
  font-family: inherit;

  &::placeholder {
    color: ${({ theme }: any) => theme.colors.muted};
  }

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const VariableSelect = styled.select`
  width: 100%;
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.md};
  background: ${({ theme }: any) => theme.colors.accent};
  padding: 12px 14px;
  font-size: 14px;
  color: ${({ theme }: any) => theme.colors.white};
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 16px;
  padding-right: 36px;

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  option {
    background: ${({ theme }: any) => theme.colors.card};
    color: ${({ theme }: any) => theme.colors.text};
  }
`;

const SkuPreviewSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding: 12px;
  background: ${({ theme }: any) => theme.colors.inner};
  border-radius: ${({ theme }: any) => theme.radius.md};
`;

const SkuPreviewLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const SkuPreviewBox = styled.div`
  font-size: 16px;
  font-weight: 800;
  color: ${({ theme }: any) => theme.colors.text};
  font-family: 'Monaco', 'Courier New', monospace;
  letter-spacing: 0.5px;
`;

/* Direct Input Section */
const DirectInputSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const DirectInputLabel = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.text};
`;

const DirectSkuInput = styled.input`
  width: 100%;
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.md};
  background: ${({ theme }: any) => theme.colors.card};
  padding: 12px;
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }: any) => theme.colors.text};
  font-family: inherit;

  &::placeholder {
    color: ${({ theme }: any) => theme.colors.muted};
    font-weight: 400;
  }

  &:focus {
    outline: none;
  }
`;

const SpreadsheetSkuNote = styled.div`
  font-size: 11px;
  color: ${({ theme }: any) => theme.colors.accent};
  font-style: italic;
  margin-top: -8px;
`;

const SkuNote = styled.div`
  font-size: 11px;
  color: ${({ theme }: any) => theme.colors.muted};
  font-style: italic;
`;

/* Sequence Option Checkbox - Styled like ResultColumn SEO/GEO/GSO */
const SequenceOptionRow = styled.div`
  background: ${({ theme }: any) => theme.colors.card};
  border-radius: ${({ theme }: any) => theme.radius.md};
  padding: 12px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  transition: all 0.2s ease;
  cursor: pointer;
  user-select: none;

  &:hover {
    opacity: 0.9;
  }
`;

const CheckboxContainer = styled.div`
  padding-top: 2px;
`;

const Checkbox = styled.div<{ $checked?: boolean }>`
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: ${({ $checked, theme }: any) =>
    $checked ? theme.colors.accent : theme.colors.inner};
  border: 2px solid ${({ $checked, theme }: any) =>
    $checked ? theme.colors.accent : theme.colors.border};
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
`;

const CheckIcon = styled.span`
  color: ${({ theme }: any) => theme.colors.white};
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
`;

const SequenceOptionContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const SequenceOptionTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.text};
`;

const SequenceOptionDescription = styled.div`
  font-size: 11px;
  color: ${({ theme }: any) => theme.colors.muted};
  line-height: 1.4;
  font-family: 'Monaco', 'Courier New', monospace;
`;

/* Sequence Digits Section - Styled like SkuRuleModal */
const SequenceDigitsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: ${({ theme }: any) => theme.colors.card};
  border-radius: ${({ theme }: any) => theme.radius.md};
`;

const SequenceDigitsLabel = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.text};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const SequenceDigitsHelp = styled.div`
  font-size: 11px;
  color: ${({ theme }: any) => theme.colors.muted};
  line-height: 1.4;
`;

const DigitsStepperWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 4px;
`;

const DigitsStepper = styled.div`
  display: flex;
  align-items: center;
  background: ${({ theme }: any) => theme.colors.inner};
  border-radius: ${({ theme }: any) => theme.radius.md};
`;

const DigitsStepBtn = styled.button`
  background: transparent;
  color: ${({ theme }: any) => theme.colors.text};
  border: none;
  font-size: 18px;
  font-weight: 800;
  padding: 6px 10px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.7;
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

const DigitsDisplay = styled.div`
  min-width: 28px;
  text-align: center;
  font-weight: 700;
  font-size: 14px;
  color: ${({ theme }: any) => theme.colors.text};
`;

const DigitsExample = styled.div`
  font-size: 13px;
  color: ${({ theme }: any) => theme.colors.muted};
  font-family: 'Monaco', 'Courier New', monospace;
`;

/* No Rule Section */
const NoRuleSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  padding: 16px;
`;

const NoRuleMessage = styled.div`
  font-size: 13px;
  color: ${({ theme }: any) => theme.colors.muted};
`;

const SetupRuleButton = styled.button`
  background: ${({ theme }: any) => theme.colors.accent};
  color: ${({ theme }: any) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.btn};
  padding: 10px 20px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

/* Template Selector */
const TemplateSelector = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const TemplateSelectorLabel = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }: any) => theme.colors.text};
`;

const TemplateSelect = styled.select`
  width: 100%;
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.md};
  background: ${({ theme }: any) => theme.colors.accent};
  padding: 12px 14px;
  font-size: 14px;
  color: ${({ theme }: any) => theme.colors.white};
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 16px;
  padding-right: 36px;

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  option {
    background: ${({ theme }: any) => theme.colors.card};
    color: ${({ theme }: any) => theme.colors.text};
  }
`;

/* Save SKU Button */
const SaveSkuButton = styled.button`
  background: ${({ theme }: any) => theme.colors.accent};
  color: ${({ theme }: any) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }: any) => theme.radius.btn};
  padding: 12px 16px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 4px;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SavedSkuIndicator = styled.div`
  font-size: 12px;
  color: ${({ theme }: any) => theme.colors.muted};
  padding: 8px 12px;
  background: ${({ theme }: any) => theme.colors.inner};
  border-radius: ${({ theme }: any) => theme.radius.md};
  
  strong {
    color: ${({ theme }: any) => theme.colors.accent};
    font-family: 'Monaco', 'Courier New', monospace;
  }
`;