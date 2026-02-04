import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { useAuth } from "../context/AuthContext";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { getStorage, ref, listAll, getDownloadURL, getMetadata } from "firebase/storage";
import { getApp } from "firebase/app";
import ImagePreview from "../components/ImagePreview";

const db = getFirestore();

// Get storage with the correct bucket
function getStorageInstance() {
  try {
    const app = getApp();
    // Use the storage bucket from the project
    return getStorage(app, "gs://imageflow-dev.firebasestorage.app");
  } catch (e) {
    console.error("Failed to get storage instance:", e);
    return null;
  }
}

interface GenerationHistory {
  id: string;
  thumbnail: string | null;
  thumbnailUrl: string | null;
  prompt: string;
  productCategory: string;
  createdAt: number;
  imageCount: number;
  cost: number;
  images: string[];
}

export default function GenerationHistory() {
  const { user } = useAuth();
  const [history, setHistory] = useState<GenerationHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedImages, setSelectedImages] = useState<string[] | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<string>("");
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // Fetch generation history directly from Firebase Storage
  async function fetchFromStorage(userId: string): Promise<GenerationHistory[]> {
    try {
      const storage = getStorageInstance();
      if (!storage) {
        console.error("Storage not available");
        return [];
      }
      
      const storagePath = `users/${userId}/generations`;
      console.log("📂 Fetching from Storage path:", storagePath);
      
      const generationsRef = ref(storage, storagePath);
      const generationFolders = await listAll(generationsRef);
      
      console.log(`📂 Found ${generationFolders.prefixes.length} generation folders in Storage`);
      console.log("📂 Folder names:", generationFolders.prefixes.map(f => f.name));
      
      if (generationFolders.prefixes.length === 0) {
        console.log("No generation folders found in Storage");
        return [];
      }
      
      const historyPromises: Promise<GenerationHistory | null>[] = generationFolders.prefixes.map(async (folderRef): Promise<GenerationHistory | null> => {
        try {
          console.log(`📁 Processing folder: ${folderRef.name}`);
          
          // List all images in this generation folder
          const filesResult = await listAll(folderRef);
          console.log(`  📄 Found ${filesResult.items.length} files in folder`);
          
          const imageFiles = filesResult.items.filter(item => 
            item.name.match(/\.(jpg|jpeg|png|webp|gif)$/i)
          );
          
          console.log(`  Found ${imageFiles.length} image files`);
          
          if (imageFiles.length === 0) {
            console.log(`  No images in folder ${folderRef.name}, skipping`);
            return null;
          }
          
          // Get download URLs for all images
          const imageUrls = await Promise.all(
            imageFiles.map(file => getDownloadURL(file))
          );
          
          // Get metadata from the first image to get creation time
          let createdAt = Date.now();
          try {
            const metadata = await getMetadata(imageFiles[0]);
            createdAt = new Date(metadata.timeCreated).getTime();
          } catch (e) {
            console.warn("Could not get metadata for", folderRef.name);
          }
          
          // Try to get prompt from Firestore generation doc
          let prompt = "Generated images";
          let productCategory = "Product";
          let cost = imageUrls.length * 10;
          
          try {
            const genDocRef = doc(db, "users", userId, "generations", folderRef.name);
            const genDoc = await getDoc(genDocRef);
            if (genDoc.exists()) {
              const data = genDoc.data();
              prompt = data.prompt || prompt;
              productCategory = data.productCategory || productCategory;
              cost = data.cost || cost;
            }
          } catch (e) {
            // Firestore doc doesn't exist, use defaults
          }
          
          return {
            id: folderRef.name,
            thumbnail: imageUrls[0] || null,
            thumbnailUrl: imageUrls[0] || null,
            prompt,
            productCategory,
            createdAt,
            imageCount: imageUrls.length,
            cost,
            images: imageUrls,
          } as GenerationHistory;
        } catch (err) {
          console.warn(`Error processing folder ${folderRef.name}:`, err);
          return null;
        }
      });
      
      const results = await Promise.all(historyPromises);
      const validResults: GenerationHistory[] = results.filter(
        (item): item is GenerationHistory => item !== null
      );
      
      // Sort by creation date, newest first
      validResults.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      
      console.log(`📜 Loaded ${validResults.length} generation(s) from Storage`);
      return validResults;
    } catch (err) {
      console.error("Error fetching from Storage:", err);
      return [];
    }
  }

  useEffect(() => {
    async function fetchHistory() {
      if (!user?.uid) return;

      try {
        setLoading(true);
        console.log("Starting to fetch generation history for user:", user.uid);
        
        // Directly fetch from Storage (more reliable)
        const historyData = await fetchFromStorage(user.uid);
        
        console.log("📊 Final history data:", historyData);
        setHistory(historyData);
      } catch (err) {
        console.error("Failed to fetch generation history:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchHistory();
    const handleUpdate = () => fetchHistory();
    window.addEventListener("accountUpdate", handleUpdate);
    return () => window.removeEventListener("accountUpdate", handleUpdate);
  }, [user]);

  const openGallery = (images: string[], prompt: string) => {
    if (images && images.length > 0) {
      setSelectedImages(images);
      setSelectedPrompt(prompt);
    } else {
      console.warn("No images found for this generation");
    }
  };

  const closeGallery = () => {
    setSelectedImages(null);
    setSelectedPrompt("");
  };

  if (loading) {
    return (
      <Container>
        <PageHeader>
          <TitleSection>
            <PageTitle>Generation History</PageTitle>
            <PageSubtitle>View your past image generations</PageSubtitle>
          </TitleSection>
        </PageHeader>
        <LoadingCard>Loading your generation history...</LoadingCard>
      </Container>
    );
  }

  return (
    <Container>
      <PageHeader>
        <TitleSection>
          <TitleRow>
            <PageTitle>Generation History</PageTitle>
            {history.length > 0 && <CountBadge>{history.length}</CountBadge>}
          </TitleRow>
          <PageSubtitle>
            {history.length > 0
              ? `${history.length} image generation${history.length !== 1 ? "s" : ""} in your history`
              : "Your generated images will appear here"}
          </PageSubtitle>
        </TitleSection>
      </PageHeader>

      {history.length === 0 ? (
        <EmptyCard>
          <EmptyIcon>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
          </EmptyIcon>
          <EmptyTitle>No Generations Yet</EmptyTitle>
          <EmptyText>
            Your generated images will appear here. Go to the App page to create your first generation.
          </EmptyText>
          <EmptyButton onClick={() => (window.location.href = "/app")}>
            Start Creating
          </EmptyButton>
        </EmptyCard>
      ) : (
        <HistoryGrid>
          {history.map((item) => {
            const thumbnailSrc =
              item.thumbnailUrl ||
              (item.thumbnail && item.thumbnail.length < 500000 ? item.thumbnail : null);

            return (
              <HistoryCard
                key={item.id}
                onClick={() => openGallery(item.images, item.prompt)}
              >
                {thumbnailSrc ? (
                  <HistoryThumbnail src={thumbnailSrc} alt="Generated" loading="lazy" />
                ) : (
                  <HistoryPlaceholder>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <path d="M21 15l-5-5L5 21"/>
                    </svg>
                  </HistoryPlaceholder>
                )}
                <HistoryInfo>
                  <HistoryPrompt>{item.prompt || "Untitled"}</HistoryPrompt>
                  <HistoryMeta>
                    <MetaItem>
                      <MetaIcon>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
                          <line x1="7" y1="7" x2="7.01" y2="7"/>
                        </svg>
                      </MetaIcon>
                      {item.productCategory || "Unknown"}
                    </MetaItem>
                    <MetaItem>
                      <MetaIcon>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <path d="M21 15l-5-5L5 21"/>
                        </svg>
                      </MetaIcon>
                      {item.imageCount} {item.imageCount !== 1 ? "images" : "image"}
                    </MetaItem>
                    <MetaItem>
                      <MetaIcon>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                        </svg>
                      </MetaIcon>
                      {item.cost} credits
                    </MetaItem>
                  </HistoryMeta>
                  <HistoryDate>
                    {new Date(item.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </HistoryDate>
                </HistoryInfo>
              </HistoryCard>
            );
          })}
        </HistoryGrid>
      )}

      {selectedImages && (
        <GalleryModal onClick={closeGallery}>
          <GalleryContainer onClick={(e) => e.stopPropagation()}>
            <GalleryHeader>
              <GalleryTitle>Generated Images ({selectedImages.length})</GalleryTitle>
              <CloseButton onClick={closeGallery}>×</CloseButton>
            </GalleryHeader>
            <PromptBox>
              <PromptLabel>Prompt</PromptLabel>
              <PromptText>{selectedPrompt}</PromptText>
            </PromptBox>
            <ImageGallery>
              {selectedImages.map((img, i) => (
                <GalleryImage
                  key={i}
                  src={img}
                  alt={`Generated ${i + 1}`}
                  onClick={() => setPreviewSrc(img)}
                />
              ))}
            </ImageGallery>
          </GalleryContainer>
        </GalleryModal>
      )}

      {previewSrc && <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />}
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

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`;

const PageTitle = styled.h1`
  margin: 0;
  font-size: 32px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  letter-spacing: -0.5px;
`;

const CountBadge = styled.span`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 14px;
  font-weight: 700;
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

const HistoryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const HistoryCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  overflow: hidden;
  transition: all 0.2s;
  cursor: pointer;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
  }
`;

const HistoryThumbnail = styled.img`
  width: 100%;
  height: 260px;
  object-fit: cover;
  background: ${({ theme }) => theme.colors.inner};
`;

const HistoryPlaceholder = styled.div`
  width: 100%;
  height: 260px;
  background: ${({ theme }) => theme.colors.inner};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.muted};
`;

const HistoryInfo = styled.div`
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const HistoryPrompt = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 42px;
`;

const HistoryMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
`;

const MetaItem = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 600;
`;

const MetaIcon = styled.span`
  display: flex;
  align-items: center;
  color: ${({ theme }) => theme.colors.accent};
`;

const HistoryDate = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  padding-top: 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  font-weight: 600;
`;

const GalleryModal = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
`;

const GalleryContainer = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  max-width: 1000px;
  max-height: 90vh;
  width: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const GalleryHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 28px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  position: sticky;
  top: 0;
  background: ${({ theme }) => theme.colors.card};
  z-index: 10;
`;

const GalleryTitle = styled.h3`
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

const PromptBox = styled.div`
  padding: 20px 28px;
  background: ${({ theme }) => theme.colors.inner};
  margin: 24px 28px 24px;
  border-radius: ${({ theme }) => theme.radius.md};
`;

const PromptLabel = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
`;

const PromptText = styled.p`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.5;
`;

const ImageGallery = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  padding: 0 28px 28px;
`;

const GalleryImage = styled.img`
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    transform: scale(1.03);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
`;