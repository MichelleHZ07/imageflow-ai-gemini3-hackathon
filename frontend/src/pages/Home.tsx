import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import styled, { keyframes } from 'styled-components'

export default function Home() {
  const [activeTemplate, setActiveTemplate] = useState(0);
  
  // Placeholder templates - replace with real before/after images later
  const templates = [
    { id: 0, category: "Jewelry", title: "Elegant Ring Display" },
    { id: 1, category: "Fashion", title: "Model Showcase" },
    { id: 2, category: "Beauty", title: "Skincare Product" },
    { id: 3, category: "Food", title: "Gourmet Presentation" },
    { id: 4, category: "Decor", title: "Home Styling" },
    { id: 5, category: "Accessories", title: "Watch Photography" },
  ];

  return (
    <Page>
      {/* ===== HERO SECTION ===== */}
      <HeroSection>
        <HeroContainer>
          <HeroContent>
            <HeroBadge>AI-Powered Product Photography</HeroBadge>
            <HeroTitle>
              Create professional product images with AI
            </HeroTitle>
            <HeroSubtitle>
              Minimal input. Studio-grade output. Transform your product photos into 
              stunning visuals for jewelry, fashion, beauty, food, decor and more.
            </HeroSubtitle>
            <HeroButtons>
              <Link to="/app">
                <PrimaryButton>
                  Start Creating
                  <ButtonArrow>→</ButtonArrow>
                </PrimaryButton>
              </Link>
              <Link to="/pricing">
                <SecondaryButton>View Pricing</SecondaryButton>
              </Link>
            </HeroButtons>
          </HeroContent>
          
          <HeroVisual>
            <VideoPlaceholder>
              <PlaceholderIcon>▶</PlaceholderIcon>
              <PlaceholderText>Product Demo Video</PlaceholderText>
              <PlaceholderHint>Upload your demo video here</PlaceholderHint>
            </VideoPlaceholder>
          </HeroVisual>
        </HeroContainer>
      </HeroSection>

      {/* ===== STATS SECTION ===== */}
      <StatsSection>
        <StatsContainer>
          <StatItem>
            <StatNumber>10x</StatNumber>
            <StatLabel>Faster than traditional photoshoots</StatLabel>
          </StatItem>
          <StatDivider />
          <StatItem>
            <StatNumber>90%</StatNumber>
            <StatLabel>Cost savings on product photography</StatLabel>
          </StatItem>
          <StatDivider />
          <StatItem>
            <StatNumber>∞</StatNumber>
            <StatLabel>Creative possibilities per product</StatLabel>
          </StatItem>
        </StatsContainer>
      </StatsSection>

      {/* ===== HOW IT WORKS ===== */}
      <SectionWrapper>
        <SectionHeader>
          <SectionLabel>How It Works</SectionLabel>
          <SectionTitle>Three simple steps to stunning visuals</SectionTitle>
          <SectionSubtitle>
            No design skills needed. Just upload, customize, and download.
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
            <StepTitle>Upload Your Product</StepTitle>
            <StepDescription>
              Upload any product photo. Our AI works with images from any angle or quality.
            </StepDescription>
          </StepCard>
          
          <StepCard>
            <StepNumber>02</StepNumber>
            <StepIcon>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            </StepIcon>
            <StepTitle>Customize Your Style</StepTitle>
            <StepDescription>
              Describe your vision or choose from templates. Set the scene, lighting, and mood.
            </StepDescription>
          </StepCard>
          
          <StepCard>
            <StepNumber>03</StepNumber>
            <StepIcon>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
            </StepIcon>
            <StepTitle>Download & Use</StepTitle>
            <StepDescription>
              Get studio-quality images instantly. Ready for your store, ads, or social media.
            </StepDescription>
          </StepCard>
        </StepsGrid>
      </SectionWrapper>

      {/* ===== BEFORE/AFTER GALLERY ===== */}
      <GallerySection>
        <SectionHeader>
          <SectionLabel>Templates</SectionLabel>
          <SectionTitle>Transform any product photo</SectionTitle>
          <SectionSubtitle>
            See the magic in action. Click through our before & after examples.
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
                  <PlaceholderIconSmall>📷</PlaceholderIconSmall>
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
                  <PlaceholderIconSmall>✨</PlaceholderIconSmall>
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

      {/* ===== FEATURES SECTION ===== */}
      <SectionWrapper>
        <SectionHeader>
          <SectionLabel>Features</SectionLabel>
          <SectionTitle>Everything you need for product visuals</SectionTitle>
          <SectionSubtitle>
            Powerful AI tools designed specifically for e-commerce and product photography.
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
            <FeatureTitle>Studio-Quality Photos</FeatureTitle>
            <FeatureDescription>
              Generate professional product images with perfect lighting, shadows, and composition.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>Scene Generation</FeatureTitle>
            <FeatureDescription>
              Place products in realistic lifestyle scenes that resonate with your target audience.
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
            <FeatureTitle>Spreadsheet Integration</FeatureTitle>
            <FeatureDescription>
              Bulk process products with CSV/Excel integration. Perfect for large catalogs.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
                <line x1="7" y1="7" x2="7.01" y2="7"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>SKU Management</FeatureTitle>
            <FeatureDescription>
              Automatically generate consistent file names with customizable SKU templates.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>SEO Descriptions</FeatureTitle>
            <FeatureDescription>
              Generate optimized product descriptions for different platforms automatically.
            </FeatureDescription>
          </FeatureCard>
          
          <FeatureCard>
            <FeatureIcon>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                <line x1="1" y1="10" x2="23" y2="10"/>
              </svg>
            </FeatureIcon>
            <FeatureTitle>Flexible Pricing</FeatureTitle>
            <FeatureDescription>
              Pay-per-use credits or monthly plans. Scale as your business grows.
            </FeatureDescription>
          </FeatureCard>
        </FeaturesGrid>
      </SectionWrapper>

      {/* ===== TESTIMONIALS ===== */}
      <TestimonialsSection>
        <SectionHeader>
          <SectionLabel>Testimonials</SectionLabel>
          <SectionTitle>Loved by sellers worldwide</SectionTitle>
        </SectionHeader>
        
        <TestimonialsGrid>
          <TestimonialCard>
            <TestimonialQuote>
              "This tool has completely transformed our product photography workflow. 
              What used to take hours now takes minutes."
            </TestimonialQuote>
            <TestimonialAuthor>
              <AuthorAvatar>E</AuthorAvatar>
              <AuthorInfo>
                <AuthorName>E-commerce Seller</AuthorName>
                <AuthorRole>Jewelry Store Owner</AuthorRole>
              </AuthorInfo>
            </TestimonialAuthor>
          </TestimonialCard>
          
          <TestimonialCard>
            <TestimonialQuote>
              "The quality is incredible. My products look like they were shot in a 
              professional studio, but I did it all from my desk."
            </TestimonialQuote>
            <TestimonialAuthor>
              <AuthorAvatar>S</AuthorAvatar>
              <AuthorInfo>
                <AuthorName>Small Business Owner</AuthorName>
                <AuthorRole>Fashion Accessories</AuthorRole>
              </AuthorInfo>
            </TestimonialAuthor>
          </TestimonialCard>
          
          <TestimonialCard>
            <TestimonialQuote>
              "The spreadsheet integration is a game-changer for our catalog. 
              We process hundreds of products seamlessly."
            </TestimonialQuote>
            <TestimonialAuthor>
              <AuthorAvatar>M</AuthorAvatar>
              <AuthorInfo>
                <AuthorName>Marketing Manager</AuthorName>
                <AuthorRole>Home Decor Brand</AuthorRole>
              </AuthorInfo>
            </TestimonialAuthor>
          </TestimonialCard>
        </TestimonialsGrid>
      </TestimonialsSection>

      {/* ===== FINAL CTA ===== */}
      <CTASection>
        <CTAContainer>
          <CTATitle>Ready to transform your product photos?</CTATitle>
          <CTASubtitle>
            Start creating stunning visuals today. No credit card required to try.
          </CTASubtitle>
          <CTAButtons>
            <Link to="/app">
              <PrimaryButton $large $inverted>
                Get Started Free
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

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
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

const VideoPlaceholder = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  aspect-ratio: 16 / 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 2px dashed ${({ theme }) => theme.colors.border};
`;

const PlaceholderIcon = styled.div`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
`;

const PlaceholderText = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const PlaceholderHint = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
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
`;

const StatLabel = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  max-width: 180px;
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

/* ============ Section Wrapper ============ */
const SectionWrapper = styled.section`
  padding: 80px 24px;
  
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

/* ============ Gallery Section ============ */
const GallerySection = styled.section`
  padding: 80px 24px;
  background: ${({ theme }) => theme.colors.card};
  
  @media (max-width: 768px) {
    padding: 60px 20px;
  }
`;

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

const PlaceholderIconSmall = styled.div`
  font-size: 32px;
`;

const PlaceholderTextSmall = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
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
  background: ${({ theme }) => theme.colors.card};
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

/* ============ Testimonials Section ============ */
const TestimonialsSection = styled.section`
  padding: 80px 24px;
  background: ${({ theme }) => theme.colors.card};
  
  @media (max-width: 768px) {
    padding: 60px 20px;
  }
`;

const TestimonialsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  max-width: 1000px;
  margin: 0 auto;
  
  @media (max-width: 968px) {
    grid-template-columns: 1fr;
    max-width: 500px;
  }
`;

const TestimonialCard = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 28px;
`;

const TestimonialQuote = styled.p`
  font-size: 15px;
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.6;
  margin: 0 0 20px 0;
  font-style: italic;
`;

const TestimonialAuthor = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const AuthorAvatar = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
`;

const AuthorInfo = styled.div``;

const AuthorName = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const AuthorRole = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
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