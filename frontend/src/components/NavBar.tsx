import React, { useEffect, useState, useRef } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useThemeMode } from "../context/ThemeContext";
import styled, { keyframes } from "styled-components";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";
import { initializeApp } from "firebase/app";
import PasswordModal from "../components/PasswordModal";
import AlertModal from "../components/AlertModal";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export default function NavBar() {
  const { user, logout } = useAuth();
  const { mode, toggleTheme } = useThemeMode();
  const navigate = useNavigate();
  const [credits, setCredits] = useState<number>(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  
  // Navigation warning state
  const [showNavigationWarning, setShowNavigationWarning] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [isLogoutPending, setIsLogoutPending] = useState(false);

  // Initialize local cache
  useEffect(() => {
    const cached = localStorage.getItem("credits");
    if (cached) setCredits(Number(cached));
  }, []);

  // Real-time credits listener
  useEffect(() => {
    if (!user?.uid) {
      setCredits(0);
      localStorage.removeItem("credits");
      return;
    }

    const userRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (typeof data.credits === "number") {
            setCredits(data.credits);
            localStorage.setItem("credits", String(data.credits));
            window.dispatchEvent(
              new CustomEvent("creditsUpdate", { detail: data.credits })
            );
          }
        }
      },
      (error) => console.error("Firestore listener error:", error)
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // Listen to credits events
  useEffect(() => {
    const handleCreditsUpdate = (e: CustomEvent) => {
      if (typeof e.detail === "number") setCredits(e.detail);
    };
    window.addEventListener("creditsUpdate", handleCreditsUpdate as EventListener);
    return () => {
      window.removeEventListener("creditsUpdate", handleCreditsUpdate as EventListener);
    };
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDropdown]);

  const handleLogout = async () => {
    // Check if we're on /app and have unsaved changes
    if (window.location.pathname === "/app") {
      const hasUnsavedChanges = (window as any).__imageflowHasUnsavedChanges?.();
      if (hasUnsavedChanges) {
        setShowDropdown(false);
        setIsLogoutPending(true);
        setShowNavigationWarning(true);
        return;
      }
    }
    await performLogout();
  };
  
  const performLogout = async () => {
    setShowDropdown(false);
    await logout();
    localStorage.removeItem("credits");
    setCredits(0);
    navigate("/login");
  };

  const handleMenuClick = (path: string) => {
    setShowDropdown(false);
    navigate(path);
  };
  
  // Navigation with unsaved changes check (for when navigating away from /app)
  const handleSafeNavigate = (e: React.MouseEvent, path: string) => {
    // Check if we're on /app and have unsaved changes
    if (window.location.pathname === "/app") {
      const hasUnsavedChanges = (window as any).__imageflowHasUnsavedChanges?.();
      if (hasUnsavedChanges) {
        e.preventDefault();
        setShowDropdown(false);
        setIsLogoutPending(false);
        setPendingNavigation(path);
        setShowNavigationWarning(true);
        return;
      }
    }
    setShowDropdown(false);
    navigate(path);
  };
  
  // Handle navigation warning confirm
  const handleNavigationConfirm = async () => {
    setShowNavigationWarning(false);
    if (isLogoutPending) {
      setIsLogoutPending(false);
      await performLogout();
    } else if (pendingNavigation) {
      navigate(pendingNavigation);
      setPendingNavigation(null);
    }
  };
  
  // Handle navigation warning cancel
  const handleNavigationCancel = () => {
    setShowNavigationWarning(false);
    setPendingNavigation(null);
    setIsLogoutPending(false);
  };

  const userInitial = user?.email?.[0]?.toUpperCase() || "U";

  return (
    <>
      <Nav>
        <Container>
          <LeftSection>
            <Logo to="/" onClick={(e) => handleSafeNavigate(e, "/")}>
              <LogoImage src="/logo.png" alt="" />
              <LogoText>ImageFlow</LogoText>
            </Logo>
            
            <NavLinks>
              <StyledNavLink to="/pricing" onClick={(e) => handleSafeNavigate(e, "/pricing")}>Pricing</StyledNavLink>
              <StyledNavLink to="/app">App</StyledNavLink>
            </NavLinks>
          </LeftSection>

          <Actions>
            {/* Theme Toggle Button */}
            <ThemeToggle onClick={toggleTheme} title={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`}>
              {mode === 'light' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/>
                  <line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </ThemeToggle>

            {!user ? (
              <GetCreditsButton onClick={(e) => handleSafeNavigate(e, "/pricing")}>
                Get Credits
              </GetCreditsButton>
            ) : (
              <CreditsPill>Credits: {credits.toLocaleString()}</CreditsPill>
            )}

            {user ? (
              <AccountDropdownWrapper ref={dropdownRef}>
                <AvatarButton onClick={() => setShowDropdown(!showDropdown)}>
                  {userInitial}
                </AvatarButton>

                {showDropdown && (
                  <DropdownMenu>
                    <UserSection>
                      <UserAvatar>{userInitial}</UserAvatar>
                      <UserInfo>
                        <UserLabel>User</UserLabel>
                        <UserEmail>{user.email}</UserEmail>
                      </UserInfo>
                    </UserSection>

                    <MenuLink to="/account" onClick={(e) => handleSafeNavigate(e, "/account")}>
                      <MenuIcon>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                      </MenuIcon>
                      <MenuText>Account Settings</MenuText>
                    </MenuLink>

                    <MenuLink to="/account/subscriptions" onClick={(e) => handleSafeNavigate(e, "/account/subscriptions")}>
                      <MenuIcon>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                          <line x1="1" y1="10" x2="23" y2="10"/>
                        </svg>
                      </MenuIcon>
                      <MenuText>Subscription Management</MenuText>
                    </MenuLink>

                    <MenuLink to="/account/history" onClick={(e) => handleSafeNavigate(e, "/account/history")}>
                      <MenuIcon>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <path d="M21 15l-5-5L5 21"/>
                        </svg>
                      </MenuIcon>
                      <MenuText>Generation History</MenuText>
                    </MenuLink>

                    <MenuLink to="/account/invoices" onClick={(e) => handleSafeNavigate(e, "/account/invoices")}>
                      <MenuIcon>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
                        </svg>
                      </MenuIcon>
                      <MenuText>Invoices</MenuText>
                    </MenuLink>

                    <MenuLink to="/account" onClick={(e) => handleSafeNavigate(e, "/account")}>
                      <MenuIcon>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
                          <line x1="7" y1="7" x2="7.01" y2="7"/>
                        </svg>
                      </MenuIcon>
                      <MenuText>SKU Label Settings</MenuText>
                    </MenuLink>

                    <MenuLink to="/account/csv-templates" onClick={(e) => handleSafeNavigate(e, "/account/csv-templates")}>
                      <MenuIcon>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                          <path d="M14 2v6h6"/>
                          <line x1="8" y1="13" x2="16" y2="13"/>
                          <line x1="8" y1="17" x2="16" y2="17"/>
                        </svg>
                      </MenuIcon>
                      <MenuText>Spreadsheet Templates</MenuText>
                    </MenuLink>

                    <MenuItem onClick={() => {
                      setShowDropdown(false);
                      setShowPasswordModal(true);
                    }}>
                      <MenuIcon>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                      </MenuIcon>
                      <MenuText>Change Password</MenuText>
                    </MenuItem>

                    <MenuDivider />

                    <MenuItem onClick={handleLogout} $danger $isLast>
                      <MenuIcon>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                        </svg>
                      </MenuIcon>
                      <MenuText>Sign Out</MenuText>
                    </MenuItem>
                  </DropdownMenu>
                )}
              </AccountDropdownWrapper>
            ) : (
              <Link to="/login" style={{ textDecoration: "none" }}>
                <LoginButton>Login</LoginButton>
              </Link>
            )}
          </Actions>
        </Container>
      </Nav>

      {/* Password Change Modal - Rendered outside Nav to avoid sticky positioning issues */}
      {showPasswordModal && (
        <PasswordModal onClose={() => setShowPasswordModal(false)} />
      )}
      
      {/* Navigation Warning Modal */}
      {showNavigationWarning && (
        <AlertModal
          title="Leave this page?"
          message="You have unsaved changes. If you leave, your work will be lost. Tip: Right-click and select 'Open in new tab' to keep your current work."
          showCancel={true}
          confirmText="Leave"
          cancelText="Stay"
          onConfirm={handleNavigationConfirm}
          onClose={handleNavigationCancel}
        />
      )}
    </>
  );
}

/* ============ Styles ============ */

const Nav = styled.nav`
  background: ${({ theme }) => theme.colors.card};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(10px);
`;

const Container = styled.div`
  max-width: 1600px;
  margin: 0 auto;
  padding: 18px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;

  @media (max-width: 1400px) {
    padding: 18px 16px;
    gap: 24px;
  }

  @media (max-width: 768px) {
    padding: 14px 16px;
    gap: 16px;
  }
`;

const LeftSection = styled.div`
  display: flex;
  align-items: center;
  gap: 48px;

  @media (max-width: 768px) {
    gap: 24px;
  }
`;

const Logo = styled(Link)`
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  transition: opacity 0.2s ease;
  
  &:hover {
    opacity: 0.8;
  }
`;

const LogoImage = styled.img`
  height: 36px;
  width: auto;
  object-fit: contain;
`;

const LogoText = styled.span`
  font-size: 24px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  letter-spacing: -0.5px;
`;

const NavLinks = styled.div`
  display: flex;
  gap: 32px;
  align-items: center;

  @media (max-width: 768px) {
    gap: 20px;
  }
`;

const StyledNavLink = styled(NavLink)`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  text-decoration: none;
  transition: all 0.2s ease;
  position: relative;
  
  &.active {
    color: ${({ theme }) => theme.colors.accent};
    
    &::after {
      content: '';
      position: absolute;
      bottom: -6px;
      left: 0;
      right: 0;
      height: 2px;
      background: ${({ theme }) => theme.colors.accent};
      border-radius: 2px;
    }
  }
  
  &:hover {
    color: ${({ theme }) => theme.colors.accent};
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 14px;
  align-items: center;
`;

const ThemeToggle = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.inner};
  border: none;
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    opacity: 0.8;
    transform: scale(1.05);
  }

  svg {
    transition: transform 0.3s ease;
  }

  &:active svg {
    transform: rotate(20deg);
  }
`;

const CreditsPill = styled.div`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  padding: 10px 16px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.3px;
`;

const pulse = keyframes`
  0%, 100% { transform: scale(1); box-shadow: 0 0 0px rgba(255,179,71, 0.4); }
  50% { transform: scale(1.06); box-shadow: 0 0 12px rgba(255,179,71, 0.6); }
`;

const GetCreditsButton = styled.button`
  background: #ffb347;
  color: white;
  font-weight: 800;
  border: none;
  border-radius: 999px;
  padding: 10px 20px;
  cursor: pointer;
  font-size: 14px;
  animation: ${pulse} 1.6s ease-in-out infinite;
  transition: all 0.3s ease;
  letter-spacing: 0.3px;
  
  &:hover {
    opacity: 0.9;
    transform: scale(1.08);
  }
`;

const AccountDropdownWrapper = styled.div`
  position: relative;
`;

const AvatarButton = styled.button`
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  font-size: 17px;
  font-weight: 800;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  
  &:hover {
    transform: scale(1.05);
    opacity: 0.9;
  }
`;

const DropdownMenu = styled.div`
  position: absolute;
  top: calc(100% + 10px);
  right: -24px;
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.15);
  min-width: 280px;
  z-index: 1000;
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const UserSection = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.lg} ${({ theme }) => theme.radius.lg} 0 0;
`;

const UserAvatar = styled.div`
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 800;
`;

const UserInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const UserLabel = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: 2px;
`;

const UserEmail = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MenuDivider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.border};
  margin: 0;
`;

const MenuItemsWrapper = styled.div`
  /* Wrapper ensures menu items don't inherit rounded corners from parent */
`;

const MenuItem = styled.button<{ $danger?: boolean; $isLast?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 18px;
  background: transparent;
  border: none;
  border-radius: ${({ $isLast, theme }) => $isLast ? `0 0 ${theme.radius.lg} ${theme.radius.lg}` : '0'};
  cursor: pointer;
  color: ${({ $danger, theme }) => ($danger ? "#d32f2f" : theme.colors.text)};
  transition: all 0.2s ease;
  
  &:hover {
    background: ${({ $danger, theme }) =>
      $danger ? "#d32f2f15" : theme.colors.inner};
  }
`;

const MenuLink = styled(Link)`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 18px;
  background: transparent;
  border: none;
  border-radius: 0;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.text};
  text-decoration: none;
  transition: all 0.2s ease;
  
  &:hover {
    background: ${({ theme }) => theme.colors.inner};
  }
`;

const MenuIcon = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
`;

const MenuText = styled.span`
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  flex: 1;
`;

const LoginButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 20px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
`;