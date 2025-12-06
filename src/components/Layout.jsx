
import React from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import GeminiAssistant from '@/components/ai/GeminiAssistant';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';

const Layout = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const footerlessRoutes = ['/login', '/signup'];
  const shouldHideFooter = footerlessRoutes.includes(location.pathname);

  // If user is not logged in, show full-width layout without header
  if (!user) {
    return (
      <div className="flex flex-col min-h-screen">
        <main className="flex-1">
          {children}
        </main>
        {!shouldHideFooter && <Footer />}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <Header />
      
      {/* Main Content */}
      <main className="flex-1 p-6 pt-8">
        {children}
      </main>
      {!shouldHideFooter && <Footer />}
      <GeminiAssistant />
    </div>
  );
};

export default Layout;
  
