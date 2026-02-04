import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider as StyledThemeProvider } from "styled-components";
import { getTheme } from "./styles/theme";
import "./styles/global.css";

// Context
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider, useThemeMode } from "./context/ThemeContext";

// Components
import NavBar from "./components/NavBar";
import Protected from "./components/Protected";

// Pages
import Home from "./pages/Home";
import Login from "./pages/Login";
import Pricing from "./pages/Pricing";
import App from "./pages/App";

// Account pages
import AccountLayout from "./pages/AccountLayout";
import AccountSettings from "./pages/Accountsettings";
import SubscriptionManagement from "./pages/Subscriptionmanagement";
import GenerationHistory from "./pages/Generationhistory";
import Invoices from "./pages/Invoices";
import CsvTemplatesPage from "./pages/CsvTemplatesPage";

function ThemedApp() {
  const { mode } = useThemeMode();
  const currentTheme = getTheme(mode);

  return (
    <StyledThemeProvider theme={currentTheme}>
      <AuthProvider>
        <BrowserRouter>
          <NavBar />
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/app" element={<App />} />

            {/* Protected routes */}
            <Route
              path="/account"
              element={
                <Protected>
                  <AccountLayout />
                </Protected>
              }
            >
              <Route index element={<AccountSettings />} />
              <Route path="subscriptions" element={<SubscriptionManagement />} />
              <Route path="history" element={<GenerationHistory />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="csv-templates" element={<CsvTemplatesPage />} />
            </Route>

            {/* Catch all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </StyledThemeProvider>
  );
}

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </React.StrictMode>
);