import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import Layout from '@/components/Layout';
import Header from '@/components/Header';
import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';
import VerifyEmailPage from '@/pages/VerifyEmailPage';
import DashboardPage from '@/pages/DashboardPage';
import CollegeAdminDashboard from '@/pages/dashboards/CollegeAdminDashboard';
import EnhancedSuperAdminDashboard from '@/pages/dashboards/EnhancedSuperAdminDashboard';
import EnhancedFacultyDashboard from '@/pages/dashboards/EnhancedFacultyDashboard';
import EnhancedStudentDashboard from '@/pages/dashboards/EnhancedStudentDashboard';

import CollegeManagementPage from '@/pages/CollegeManagementPage';
import UserProfilePage from '@/pages/UserProfilePage';
import FeaturesPage from '@/pages/FeaturesPage';
import UserManagementPage from '@/pages/UserManagementPage';
import AssessmentManagementPage from '@/pages/AssessmentManagementPage';
import AssessmentCreationWizard from '@/pages/AssessmentCreationWizard';
import QuestionCreationPage from './pages/QuestionCreationPage.jsx';
import QuestionBankPage from './pages/QuestionBankPage.jsx';
import StudentAssessmentListPage from './pages/StudentAssessmentListPage.jsx';
import StudentAssessmentResultsEnhanced from './pages/StudentAssessmentResultsEnhanced.jsx';
import AnalyticsDashboard from './pages/AnalyticsDashboard.jsx';
import AssessmentDetailsPage from './pages/AssessmentDetailsPage.jsx';
import CodingProfilesManagementPage from './pages/CodingProfilesManagementPage.jsx';
import StudentCodingPlatformsPage from './pages/StudentCodingPlatformsPage.jsx';
import AssessmentTakeWizard from '@/components/assessment-taking/AssessmentTakeWizard';
import ContactPage from '@/pages/ContactPage';
import AboutPage from '@/pages/AboutPage';
import CareersPage from '@/pages/CareersPage';
import BlogPage from '@/pages/BlogPage';
// MEDIUM FIX: Import Error Boundary
import ErrorBoundary from '@/components/common/ErrorBoundary';

import { Toaster } from '@/components/ui/toaster';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

const ProtectedRoute = ({ children, roles }) => {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

// Wrapper component that conditionally applies Layout
const ConditionalLayout = ({ children }) => {
  const location = useLocation();

  // Don't apply Layout for assessment taking page or Landing Page
  if (
    (location.pathname.includes('/student/assessments/') && location.pathname.includes('/take')) ||
    location.pathname === '/'
  ) {
    return children;
  }

  return <Layout>{children}</Layout>;
};

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={
        user ? <Navigate to={`/dashboard/${user.role === 'super-admin' ? 'super-admin' : user.role === 'college-admin' ? 'college-admin' : user.role === 'faculty' ? 'faculty' : 'student'}`} replace /> : <LoginPage />
      } />
      <Route path="/signup" element={
        user ? <Navigate to={`/dashboard/${user.role === 'super-admin' ? 'super-admin' : user.role === 'college-admin' ? 'college-admin' : user.role === 'faculty' ? 'faculty' : 'student'}`} replace /> : <SignupPage />
      } />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/careers" element={<CareersPage />} />
      <Route path="/blog" element={<BlogPage />} />
      <Route path="/create-question" element={<QuestionCreationPage />} />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/super-admin"
        element={
          <ProtectedRoute roles={['super-admin']}>
            <EnhancedSuperAdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/college-admin"
        element={
          <ProtectedRoute roles={['college-admin']}>
            <CollegeAdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/faculty"
        element={
          <ProtectedRoute roles={['faculty']}>
            <EnhancedFacultyDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard/student"
        element={
          <ProtectedRoute roles={['student']}>
            <EnhancedStudentDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/colleges"
        element={
          <ProtectedRoute roles={['super-admin']}>
            <CollegeManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute roles={['super-admin']}>
            <UserManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/assessments"
        element={
          <ProtectedRoute roles={['super-admin', 'college-admin', 'faculty']}>
            <AssessmentManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/assessments/create"
        element={
          <ProtectedRoute roles={['super-admin', 'college-admin', 'faculty']}>
            <AssessmentCreationWizard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/question-bank"
        element={
          <ProtectedRoute roles={['super-admin', 'college-admin', 'faculty']}>
            <QuestionBankPage />
          </ProtectedRoute>
        }
      />




      <Route
        path="/analytics/dashboard"
        element={
          <ProtectedRoute>
            <AnalyticsDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/analytics/assessment/:assessmentId"
        element={
          <ProtectedRoute>
            <AssessmentDetailsPage />
          </ProtectedRoute>
        }
      />


      {/* Student Assessment Routes */}
      <Route
        path="/student/assessments"
        element={
          <ProtectedRoute roles={['student']}>
            <StudentAssessmentListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/assessments/:assessmentId/results"
        element={
          <ProtectedRoute roles={['student']}>
            <StudentAssessmentResultsEnhanced />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/assessments/:assessmentId/take"
        element={
          <ProtectedRoute roles={['student']}>
            <ErrorBoundary
              title="Assessment Taking Error"
              message="An error occurred while loading the assessment. Please try again or contact support if the problem persists."
            >
              <AssessmentTakeWizard />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />

      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <UserProfilePage />
          </ProtectedRoute>
        }
      />

      {/* Coding Profiles Routes */}
      <Route
        path="/admin/coding-profiles"
        element={
          <ProtectedRoute roles={['super-admin']}>
            <CodingProfilesManagementPage />
          </ProtectedRoute>
        }
      />

      {/* Student Coding Platforms Route */}
      <Route
        path="/student/coding-platforms"
        element={
          <ProtectedRoute roles={['student']}>
            <StudentCodingPlatformsPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to={user ? "/dashboard" : "/"} replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <ErrorBoundary
        title="Application Error"
        message="A critical error occurred. Please refresh the page or contact support."
      >
        <Router>
          <AuthProvider>
            <ConditionalLayout>
              <AppRoutes />
            </ConditionalLayout>
            <Toaster />
          </AuthProvider>
        </Router>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
