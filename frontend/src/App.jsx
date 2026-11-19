import React, { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import AppHeader from './components/AppHeader';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import IngestaDocumental from './pages/IngestaDocumental';
import ChatRAG from './pages/ChatRAG';
import DashboardTI from './pages/DashboardTI';
import GestionPqrs from './pages/GestionPqrs';
import PortalRadicacionPublica from './pages/PortalRadicacionPublica';
import DigitalizacionVision from './pages/DigitalizacionVision';
import TourGuiado from './components/TourGuiado';

/**
 * Layout autenticado: sidebar + command bar + contenido, sin salir nunca del App Shell.
 */
function AppLayout() {
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[var(--color-bg-main)] text-[var(--color-text)]">
      <Sidebar
        onRepoSelect={setSelectedRepo}
        selectedRepo={selectedRepo}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader onOpenSidebar={() => setMobileNavOpen(true)} />
        <main className="min-w-0 flex-1">
          <Routes>
            <Route path="/pqrs" element={<GestionPqrs />} />
            <Route path="/radicar" element={<PortalRadicacionPublica />} />
            <Route path="/vision" element={<DigitalizacionVision />} />
            <Route
              path="/ingesta"
              element={<IngestaDocumental selectedRepo={selectedRepo} onRepoSelect={setSelectedRepo} />}
            />
            <Route path="/chat" element={<ChatRAG selectedRepo={selectedRepo} />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute requiredRole="ADMIN">
                  <DashboardTI />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/pqrs" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

/**
 * Shell público: command bar global sin sidebar administrativa.
 */
function PublicShell({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg-main)] text-[var(--color-text)]">
      <AppHeader />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-main)] text-[var(--color-text)]">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--color-accent)]" strokeWidth={1.75} />
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">Cargando DocuMind...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <>
        <Routes>
          <Route path="/login" element={<Navigate to="/pqrs" replace />} />
          <Route path="/*" element={<AppLayout />} />
        </Routes>
        <TourGuiado />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicShell>
              <Login />
            </PublicShell>
          }
        />
        <Route
          path="/radicar"
          element={
            <PublicShell>
              <PortalRadicacionPublica />
            </PublicShell>
          }
        />
        <Route
          path="/vision"
          element={
            <PublicShell>
              <DigitalizacionVision />
            </PublicShell>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <TourGuiado />
    </>
  );
}
