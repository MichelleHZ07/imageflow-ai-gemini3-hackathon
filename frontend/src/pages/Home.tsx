import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import styled, { keyframes } from 'styled-components'

export default function Home() {
  const [activeTemplate, setActiveTemplate] = useState(0);

  // Placeholder templates - replace with real before/after images later
  const templates = [
    { id: 0, category: "Multi-Angle", title: "Same Model, Different Angles" },
    { id: 1, category: "Still Life", title: "Same Scene, Multiple Products" },
    { id: 2, category: "White Background", title: "Clean Product Cutout" },
    { id: 3, category: "Detail Page", title: "Product Detail Page Generation" },
    { id: 4, category: "Lifestyle", title: "Product in Context" },
  ];

  return (
    <Page>
      {/* ===== HERO SECTION ===== */}
      <HeroSection>
        <HeroContainer>
          <HeroContent>
            <HeroBadge>Powered by Google Gemini</HeroBadge>
            <HeroTitle>
              Snap to Sell
            </HeroTitle>
            <HeroSubtitle>
              From a single product photo to a complete, platform-ready listing — 
              images, marketing copy, and catalog management in one place. 
              Stop switching between tools.
            </HeroSubtitle>
            <HeroButtons>
              <Link to="/demo">
                <PrimaryButton>
                  Try Demo
                  <ButtonArrow>→</ButtonArrow>
                </PrimaryButton>
              </Link>
              <Link to="/pricing">
                <SecondaryButton>View Pricing</SecondaryButton>
              </Link>
            </HeroButtons>
          </HeroContent>
          
          <HeroVisual>
            <VideoContainer>
              <YouTubeEmbed
                src="https://www.youtube.com/embed/9rzWCOaXHQg"
                title="ImageFlow Demo Video"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </VideoContainer>
          </HeroVisual>
        </HeroContainer>
      </HeroSection>

      {/* ===== STATS SECTION ===== */}
      <StatsSection>
        <StatsContainer>
          <StatItem>
            <StatNumber>3-in-1</StatNumber>
            <StatLabel>Image generation + copywriting + catalog management</StatLabel>
          </StatItem>
          <StatDivider />
          <StatItem>
            <StatNumber>12</StatNumber>
            <StatLabel>Supported platforms including Shopify, Amazon, eBay & more</StatLabel>
          </StatItem>
          <StatDivider />
          <StatItem>
            <StatNumber>4K</StatNumber>
            <StatLabel>Resolution AI-generated product images</StatLabel>
          </StatItem>
        </StatsContainer>
      </StatsSection>

      {/* ===== THE PROBLEM ===== */}
      <GallerySection>
        <SectionHeader>
          <SectionLabel>The Problem</SectionLabel>
          <SectionTitle>Sellers are trapped switching between apps</SectionTitle>
          <SectionSubtitle>
            3.5 million small and medium e-commerce sellers share the same daily struggle.
          </SectionSubtitle>
        </SectionHeader>
        
        <ProblemGrid>
          <ProblemCard>
            <ProblemIcon>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21"/>
              </svg>
            </ProblemIcon>
            <ProblemTitle>Image generation is broken</ProblemTitle>
            <ProblemText>
              AI tools cram multiple angles into a single image instead of generating 
              one angle per image — making outputs unusable for product listings.
            </ProblemText>
          </ProblemCard>
          
          <ProblemCard>
            <ProblemIcon>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8"/>
              </svg>
            </ProblemIcon>
            <ProblemTitle>Marketing copy is fragmented</ProblemTitle>
            <ProblemText>
              Every platform has different SEO rules, character limits, and best practices. 
              Sellers research and write tailored copy for each one, then copy-paste into spreadsheets.
            </ProblemText>
          </ProblemCard>
          
          <ProblemCard>
            <ProblemIcon>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
                <path d="M13 2v7h7"/>
              </svg>
            </ProblemIcon>
            <ProblemTitle>File naming is manual labor</ProblemTitle>
            <ProblemText>
              Generated images come out as image_001.png — sellers manually rename 
              hundreds of files to match product SKUs before uploading to any platform.
            </ProblemText>
          </ProblemCard>
          
          <ProblemCard>
            <ProblemIcon>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </ProblemIcon>
            <ProblemTitle>PIM tools don't solve the root problem</ProblemTitle>
            <ProblemText>
              Product Information Management handles distribution, but can't generate or update 
              the images and copy themselves. Sellers still switch between 3+ disconnected tools.
            </ProblemText>
          </ProblemCard>
        </ProblemGrid>
      </GallerySection>

      {/* ===== THE SOLUTION — point-by-point ===== */}
      <SectionWrapper>
        <SectionHeader>
          <SectionLabel>The Solution</SectionLabel>
          <SectionTitle>ImageFlow solves each problem directly</SectionTitle>
          <SectionSubtitle>
            Three capabilities unified in one app — no more switching between tools.
          </SectionSubtitle>
        </SectionHeader>
        
        <SolutionGrid>
          <SolutionCard>
            <SolutionBadge>Solves: Image generation is broken</SolutionBadge>
            <SolutionTitle>Two-Layer AI Image Pipeline</SolutionTitle>
            <SolutionText>
              Gemini Flash decomposes your prompt into N separate scene descriptions — understanding 
              that "different angles" means one angle per image. Then Gemini Pro generates each as 
              a separate, professional image in parallel. No more angles crammed into one output.
            </SolutionText>
          </SolutionCard>
          
          <SolutionCard>
            <SolutionBadge>Solves: Marketing copy is fragmented</SolutionBadge>
            <SolutionTitle>Platform-Aware Copy Generation</SolutionTitle>
            <SolutionText>
              Gemini Flash researches each platform's SEO rules and generates tailored descriptions, 
              tags, meta titles, and more. Switch between Shopify, Amazon, eBay, and 9 other platforms 
              with one click. Select any spreadsheet field for AI copy generation — fully customizable.
            </SolutionText>
          </SolutionCard>
          
          <SolutionCard>
            <SolutionBadge>Solves: File naming is manual labor</SolutionBadge>
            <SolutionTitle>Automatic SKU-Based Naming</SolutionTitle>
            <SolutionText>
              Configure SKU templates with brand initials, category codes, colors, sizes, and 
              sequence numbers. When you download, every image is instantly named correctly — 
              sequence numbers assigned automatically based on download order. Zero manual renaming.
            </SolutionText>
          </SolutionCard>
          
          <SolutionCard>
            <SolutionBadge>Solves: PIM tools don't generate content</SolutionBadge>
            <SolutionTitle>Built-In Catalog Management</SolutionTitle>
            <SolutionText>
              Import your product spreadsheets, generate images and copy, save directly back into 
              the catalog with CDN-hosted image URLs, manage versions, and export — all without 
              leaving the app. Generation + management in one place, not three separate tools.
            </SolutionText>
          </SolutionCard>
        </SolutionGrid>
      </SectionWrapper>

      {/* ===== TWO MODES ===== */}
      <GallerySection>
        <SectionHeader>
          <SectionLabel>Two Modes</SectionLabel>
          <SectionTitle>Flexible workflows for every scenario</SectionTitle>
          <SectionSubtitle>
            Choose the mode that fits your task — quick generation or full catalog integration.
          </SectionSubtitle>
        </SectionHeader>
        
        <ModesGrid>
          <ModeCard>
            <ModeLabel>Create Mode</ModeLabel>
            <ModeTitle>Start from a photo</ModeTitle>
            <ModeText>
              Upload any product image, generate professional photos and marketing copy, 
              then download with automatic SKU naming or save into any spreadsheet. 
              Spreadsheets in Create mode are write-only — create new products or 
              update existing ones.
            </ModeText>
          </ModeCard>
          
          <ModeCard>
            <ModeLabel>Import Mode</ModeLabel>
            <ModeTitle>Start from your catalog</ModeTitle>
            <ModeText>
              Load a product spreadsheet, browse products visually by SKU, and generate 
              images and copy in context. Both the original and a different spreadsheet 
              can serve as source material. Override or transfer images from the original 
              to a different spreadsheet. Create new products in the target catalog.
            </ModeText>
          </ModeCard>
        </ModesGrid>
      </GallerySection>

      {/* ===== HOW IT WORKS ===== */}
      <SectionWrapper>
        <SectionHeader>
          <SectionLabel>How It Works</SectionLabel>
          <SectionTitle>Two-layer AI image generation pipeline</SectionTitle>
          <SectionSubtitle>
            A unique approach that solves the "multiple angles in one image" problem.
          </SectionSubtitle>
        </SectionHeader>
        
        <StepsGrid>
          <StepCard>
            <StepNumber>01</StepNumber>
            <StepIcon>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
            </StepIcon>
            <StepTitle>Upload & Describe</StepTitle>
            <StepDescription>
              Upload a product photo and describe your vision. 
              "Generate this product in the same scene but different angles."
            </StepDescription>
          </StepCard>
          
          <StepCard>
            <StepNumber>02</StepNumber>
            <StepIcon>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </StepIcon>
            <StepTitle>AI Decomposes & Generates</StepTitle>
            <StepDescription>
              Gemini Flash analyzes your prompt into N specific scene descriptions. 
              Then Gemini Pro generates each as a separate, professional image in parallel.
            </StepDescription>
          </StepCard>
          
          <StepCard>
            <StepNumber>03</StepNumber>
            <StepIcon>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
            </StepIcon>
            <StepTitle>Download or Save to Catalog</StepTitle>
            <StepDescription>
              Get CDN-hosted images with auto-generated SKU names. 
              Save directly into your product spreadsheet with AI-written marketing copy.
            </StepDescription>
          </StepCard>
        </StepsGrid>
      </SectionWrapper>

      {/* ===== FEATURES SECTION ===== */}
      <SectionWrapper $alt>
        <SectionHeader>
          <SectionLabel>Features</SectionLabel>
          <SectionTitle>Everything from photo to live listing</SectionTitle>
          <SectionSubtitle>
            Image generation, marketing copy, and catalog management — unified in one workflow.
          </SectionSubtitle>
        </SectionHeader>
        
        <FeaturesGrid>
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>Two-Layer AI Image Generation</FeatureTitle>
            <FeatureDescription>
              Gemini Flash decomposes your prompt into distinct scenes, then Gemini Pro generates each 
              as a separate image. Up to 8 images per session, 10 aspect ratios, up to 4K resolution.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>Platform-Specific Marketing Copy</FeatureTitle>
            <FeatureDescription>
              AI-generated SEO, GEO, and GSO descriptions, tags, meta titles, and more — 
              tailored for Shopify, Amazon, eBay, TikTok, and 8 other platforms. One click to switch.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6"/>
                <line x1="8" y1="13" x2="16" y2="13"/>
                <line x1="8" y1="17" x2="16" y2="17"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>Built-In Catalog Management</FeatureTitle>
            <FeatureDescription>
              Import CSV/Excel catalogs, browse products visually, edit in-app, 
              and export for direct import into any merchant platform. 
              Cross-spreadsheet save for multi-platform sellers.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
                <line x1="7" y1="7" x2="7.01" y2="7"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>SKU Template Engine</FeatureTitle>
            <FeatureDescription>
              Pattern-based naming with brand initials, category codes, colors, sizes, 
              and auto-assigned sequence numbers. Up to 20 templates per account.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>CDN-Hosted Images</FeatureTitle>
            <FeatureDescription>
              Every generated image gets a universally accessible CDN URL automatically. 
              Import into any platform without domain restrictions or manual re-hosting.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>Cross-Border Ready</FeatureTitle>
            <FeatureDescription>
              Built-in proxy for Chinese CDN anti-hotlinking (Alibaba, 1688, Taobao), 
              ERP platform support (Dianxiaomi), and HEIC iPhone photo conversion.
            </FeatureDescription>
          </FeatureCard>
        </FeaturesGrid>
      </SectionWrapper>

      {/* ===== BEFORE/AFTER GALLERY ===== */}
      <GallerySection>
        <SectionHeader>
          <SectionLabel>Use Cases</SectionLabel>
          <SectionTitle>One photo, endless possibilities</SectionTitle>
          <SectionSubtitle>
            See how ImageFlow transforms a single product photo into platform-ready visuals.
          </SectionSubtitle>
        </SectionHeader>
        
        <GalleryContainer>
          <GalleryTabs>
            {templates.map((template, index) => (
              <GalleryTab 
                key={template.id}
                $active={activeTemplate === index}
                onClick={() => setActiveTemplate(index)}
              >
                {template.category}
              </GalleryTab>
            ))}
          </GalleryTabs>
          
          <GalleryShowcase>
            <BeforeAfterContainer>
              <ImageBox>
                <ImageLabel>BEFORE</ImageLabel>
                <ImagePlaceholder>
                  <PlaceholderTextSmall>Original Photo</PlaceholderTextSmall>
                </ImagePlaceholder>
              </ImageBox>
              
              <ArrowIcon>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </ArrowIcon>
              
              <ImageBox>
                <ImageLabel $highlight>AFTER</ImageLabel>
                <ImagePlaceholder $highlight>
                  <PlaceholderTextSmall>AI Generated</PlaceholderTextSmall>
                </ImagePlaceholder>
              </ImageBox>
            </BeforeAfterContainer>
            
            <GalleryInfo>
              <GalleryCategory>{templates[activeTemplate].category}</GalleryCategory>
              <GalleryTitle>{templates[activeTemplate].title}</GalleryTitle>
              <GalleryDescription>
                Professional studio-quality result generated from a simple product photo.
              </GalleryDescription>
            </GalleryInfo>
          </GalleryShowcase>
        </GalleryContainer>
      </GallerySection>

      {/* ===== FINAL CTA ===== */}
      <CTASection>
        <CTAContainer>
          <CTATitle>See it in action</CTATitle>
          <CTASubtitle>
            Try the full workflow with 5,000 free credits and pre-loaded sample catalogs. 
            No signup required.
          </CTASubtitle>
          <CTAButtons>
            <Link to="/demo">
              <PrimaryButton $large $inverted>
                Try Demo
                <ButtonArrow>→</ButtonArrow>
              </PrimaryButton>
            </Link>
          </CTAButtons>
        </CTAContainer>
      </CTASection>

      {/* ===== FOOTER ===== */}
      <Footer>
        <FooterContainer>
          <FooterBrand>
            <FooterLogo>ImageFlow</FooterLogo>
            <FooterTagline>AI-powered product photography</FooterTagline>
          </FooterBrand>
          <FooterLinks>
            <FooterLink to="/demo">Demo</FooterLink>
            <FooterLink to="/app">App</FooterLink>
            <FooterLink to="/pricing">Pricing</FooterLink>
            <FooterLink to="/login">Login</FooterLink>
          </FooterLinks>
          <FooterCopyright>
            © {new Date().getFullYear()} ImageFlow. All rights reserved.
          </FooterCopyright>
        </FooterContainer>
      </Footer>
    </Page>
  )
}

/* ============ Animations ============ */
const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

/* ============ Base Styles ============ */
const Page = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  color: ${({ theme }) => theme.colors.text};
  min-height: 100vh;
`;

/* ============ Hero Section ============ */
const HeroSection = styled.section`
  padding: 80px 24px 60px;
  
  @media (max-width: 768px) {
    padding: 40px 20px;
  }
`;

const HeroContainer = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 60px;
  align-items: center;
  
  @media (max-width: 968px) {
    grid-template-columns: 1fr;
    gap: 40px;
    text-align: center;
  }
`;

const HeroContent = styled.div`
  animation: ${fadeInUp} 0.6s ease-out;
`;

const HeroBadge = styled.span`
  display: inline-block;
  background: ${({ theme }) => theme.colors.accent}15;
  color: ${({ theme }) => theme.colors.accent};
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 24px;
`;

const HeroTitle = styled.h1`
  font-size: 52px;
  font-weight: 800;
  line-height: 1.1;
  margin: 0 0 20px 0;
  color: ${({ theme }) => theme.colors.text};
  letter-spacing: -1px;
  
  @media (max-width: 768px) {
    font-size: 36px;
  }
`;

const HeroSubtitle = styled.p`
  font-size: 18px;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0 0 32px 0;
  max-width: 500px;
  
  @media (max-width: 968px) {
    max-width: 100%;
    margin-left: auto;
    margin-right: auto;
  }
`;

const HeroButtons = styled.div`
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  
  @media (max-width: 968px) {
    justify-content: center;
  }
  
  a {
    text-decoration: none;
  }
`;

const HeroVisual = styled.div`
  animation: ${fadeInUp} 0.6s ease-out 0.2s both;
`;

const VideoContainer = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  overflow: hidden;
  aspect-ratio: 16 / 9;
`;

const YouTubeEmbed = styled.iframe`
  width: 100%;
  height: 100%;
  border: none;
`;

/* ============ Buttons ============ */
const PrimaryButton = styled.button<{ $large?: boolean; $inverted?: boolean }>`
  background: ${({ theme, $inverted }) => $inverted ? theme.colors.white : theme.colors.accent};
  color: ${({ theme, $inverted }) => $inverted ? theme.colors.accent : theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: ${({ $large }) => $large ? '18px 36px' : '14px 28px'};
  font-weight: 700;
  font-size: ${({ $large }) => $large ? '17px' : '15px'};
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 8px;

  &:hover {
    opacity: 0.9;
    transform: translateY(-2px);
  }
`;

const SecondaryButton = styled.button`
  background: ${({ theme }) => theme.colors.card};
  color: ${({ theme }) => theme.colors.text};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 14px 28px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.white};
    transform: translateY(-2px);
  }
`;

const ButtonArrow = styled.span`
  transition: transform 0.2s ease;
  
  ${PrimaryButton}:hover & {
    transform: translateX(4px);
  }
`;

/* ============ Stats Section ============ */
const StatsSection = styled.section`
  padding: 40px 24px;
  background: ${({ theme }) => theme.colors.card};
`;

const StatsContainer = styled.div`
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 48px;
  
  @media (max-width: 768px) {
    flex-direction: column;
    gap: 32px;
  }
`;

const StatItem = styled.div`
  text-align: center;
`;

const StatNumber = styled.div`
  font-size: 48px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.accent};
  line-height: 1;
  margin-bottom: 8px;
  
  @media (max-width: 768px) {
    font-size: 36px;
  }
`;

const StatLabel = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  max-width: 200px;
`;

const StatDivider = styled.div`
  width: 1px;
  height: 60px;
  background: ${({ theme }) => theme.colors.border};
  
  @media (max-width: 768px) {
    width: 60px;
    height: 1px;
  }
`;

/* ============ Problem Section ============ */
const ProblemGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  max-width: 900px;
  margin: 0 auto;
  
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    max-width: 500px;
  }
`;

const ProblemCard = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 28px;
  transition: transform 0.3s ease;
  
  &:hover {
    transform: translateY(-4px);
  }
`;

const ProblemIcon = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.accent}15;
  color: ${({ theme }) => theme.colors.accent};
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
`;

/* ============ Solution Section ============ */
const SolutionGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  max-width: 900px;
  margin: 0 auto;
  
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    max-width: 500px;
  }
`;

const SolutionCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 28px;
  border-left: 3px solid ${({ theme }) => theme.colors.accent};
  transition: transform 0.3s ease;
  
  &:hover {
    transform: translateY(-4px);
  }
`;

const SolutionBadge = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.accent};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
`;

const SolutionTitle = styled.h3`
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0 0 8px 0;
`;

const SolutionText = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
  line-height: 1.6;
`;

/* ============ Modes Section ============ */
const ModesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 32px;
  max-width: 900px;
  margin: 0 auto;
  
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    max-width: 500px;
  }
`;

const ModeCard = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 36px;
  transition: transform 0.3s ease;
  
  &:hover {
    transform: translateY(-4px);
  }
`;

const ModeLabel = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.accent};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
`;

const ModeTitle = styled.h3`
  font-size: 20px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  margin: 0 0 12px 0;
`;

const ModeText = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
  line-height: 1.7;
`;

const ProblemTitle = styled.h3`
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0 0 8px 0;
`;

const ProblemText = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
  line-height: 1.6;
`;

/* ============ Section Wrapper ============ */
const SectionWrapper = styled.section<{ $alt?: boolean }>`
  padding: 80px 24px;
  background: ${({ $alt, theme }) => $alt ? theme.colors.card : 'transparent'};
  
  @media (max-width: 768px) {
    padding: 60px 20px;
  }
`;

const GallerySection = styled.section`
  padding: 80px 24px;
  background: ${({ theme }) => theme.colors.card};
  
  @media (max-width: 768px) {
    padding: 60px 20px;
  }
`;

const SectionHeader = styled.div`
  text-align: center;
  max-width: 600px;
  margin: 0 auto 48px;
`;

const SectionLabel = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.accent};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
`;

const SectionTitle = styled.h2`
  font-size: 36px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  margin: 0 0 16px 0;
  line-height: 1.2;
  
  @media (max-width: 768px) {
    font-size: 28px;
  }
`;

const SectionSubtitle = styled.p`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
  line-height: 1.6;
`;

/* ============ Steps Section ============ */
const StepsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  max-width: 1000px;
  margin: 0 auto;
  
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    max-width: 400px;
  }
`;

const StepCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 32px;
  text-align: center;
  position: relative;
  transition: transform 0.3s ease;
  
  &:hover {
    transform: translateY(-4px);
  }
`;

const StepNumber = styled.div`
  position: absolute;
  top: 16px;
  right: 20px;
  font-size: 48px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.accent}15;
`;

const StepIcon = styled.div`
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: ${({ theme }) => theme.colors.accent}15;
  color: ${({ theme }) => theme.colors.accent};
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
`;

const StepTitle = styled.h3`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0 0 12px 0;
`;

const StepDescription = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
  line-height: 1.6;
`;

/* ============ Features Section ============ */
const FeaturesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  max-width: 1000px;
  margin: 0 auto;
  
  @media (max-width: 968px) {
    grid-template-columns: repeat(2, 1fr);
  }
  
  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const FeatureCard = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 28px;
  transition: transform 0.3s ease;
  
  &:hover {
    transform: translateY(-4px);
  }
`;

const FeatureIcon = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.accent}15;
  color: ${({ theme }) => theme.colors.accent};
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
`;

const FeatureTitle = styled.h3`
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0 0 8px 0;
`;

const FeatureDescription = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
  line-height: 1.5;
`;

/* ============ Gallery Section ============ */
const GalleryContainer = styled.div`
  max-width: 900px;
  margin: 0 auto;
`;

const GalleryTabs = styled.div`
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 40px;
`;

const GalleryTab = styled.button<{ $active: boolean }>`
  padding: 10px 20px;
  border-radius: 999px;
  border: none;
  background: ${({ $active, theme }) => $active ? theme.colors.accent : theme.colors.white};
  color: ${({ $active, theme }) => $active ? theme.colors.white : theme.colors.text};
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    background: ${({ $active, theme }) => $active ? theme.colors.accent : theme.colors.inner};
  }
`;

const GalleryShowcase = styled.div`
  background: ${({ theme }) => theme.colors.white};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 40px;
  
  @media (max-width: 768px) {
    padding: 24px;
  }
`;

const BeforeAfterContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  margin-bottom: 32px;
  
  @media (max-width: 768px) {
    flex-direction: column;
    gap: 16px;
  }
`;

const ImageBox = styled.div`
  flex: 1;
  max-width: 320px;
`;

const ImageLabel = styled.div<{ $highlight?: boolean }>`
  font-size: 12px;
  font-weight: 700;
  color: ${({ $highlight, theme }) => $highlight ? theme.colors.accent : theme.colors.muted};
  margin-bottom: 12px;
  text-align: center;
`;

const ImagePlaceholder = styled.div<{ $highlight?: boolean }>`
  aspect-ratio: 1;
  background: ${({ $highlight, theme }) => $highlight ? `${theme.colors.accent}10` : theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed ${({ $highlight, theme }) => $highlight ? theme.colors.accent : theme.colors.border};
`;

const PlaceholderTextSmall = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
`;

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
`;

const ArrowIcon = styled.div`
  color: ${({ theme }) => theme.colors.accent};
  animation: ${float} 2s ease-in-out infinite;
  
  @media (max-width: 768px) {
    transform: rotate(90deg);
  }
`;

const GalleryInfo = styled.div`
  text-align: center;
`;

const GalleryCategory = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
  margin-bottom: 8px;
`;

const GalleryTitle = styled.h3`
  font-size: 24px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0 0 8px 0;
`;

const GalleryDescription = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
`;

/* ============ CTA Section ============ */
const CTASection = styled.section`
  padding: 80px 24px;
  background: ${({ theme }) => theme.colors.accent};
`;

const CTAContainer = styled.div`
  max-width: 600px;
  margin: 0 auto;
  text-align: center;
`;

const CTATitle = styled.h2`
  font-size: 32px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.white};
  margin: 0 0 16px 0;
  
  @media (max-width: 768px) {
    font-size: 26px;
  }
`;

const CTASubtitle = styled.p`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.white}cc;
  margin: 0 0 32px 0;
`;

const CTAButtons = styled.div`
  a {
    text-decoration: none;
  }
`;

/* ============ Footer ============ */
const Footer = styled.footer`
  padding: 40px 24px;
  background: ${({ theme }) => theme.colors.card};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const FooterContainer = styled.div`
  max-width: 1000px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
`;

const FooterBrand = styled.div`
  text-align: center;
`;

const FooterLogo = styled.div`
  font-size: 20px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: 4px;
`;

const FooterTagline = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
`;

const FooterLinks = styled.div`
  display: flex;
  gap: 24px;
`;

const FooterLink = styled(Link)`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  text-decoration: none;
  transition: color 0.2s ease;
  
  &:hover {
    color: ${({ theme }) => theme.colors.accent};
  }
`;

const FooterCopyright = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
`;