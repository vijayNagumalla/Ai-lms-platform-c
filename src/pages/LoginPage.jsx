import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AuthPortal from '@/components/auth/AuthPortal';

const LoginPage = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // If user is already logged in, redirect to their dashboard
    if (!loading && user) {
      const dashboardPath = user.role === 'super-admin' 
        ? '/dashboard/super-admin'
        : user.role === 'college-admin'
        ? '/dashboard/college-admin'
        : user.role === 'faculty'
        ? '/dashboard/faculty'
        : '/dashboard/student';
      navigate(dashboardPath, { replace: true });
    }
  }, [user, loading, navigate]);

  // Show loading while checking auth state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // If user is logged in, don't show login form (redirect will happen)
  if (user) {
    return null;
  }

  return <AuthPortal mode="login" />;
};

export default LoginPage;
