import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
  LogIn,
  UserPlus,
  Mail,
  Lock,
  User,
  Key,
  ChevronRight
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const panelVariants = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } }
};

const highlightVariants = {
  pulse: {
    scale: [1, 1.05, 1],
    opacity: [0.4, 0.7, 0.4],
    transition: { duration: 3, repeat: Infinity }
  }
};

const AuthPanel = ({ isActive, accent, title, badgeLabel, description, icon, children, onActivate, panelKey }) => (
  <motion.div
    variants={panelVariants}
    className={`relative overflow-hidden rounded-3xl border backdrop-blur-2xl transition-all duration-500 ${
      isActive
        ? 'border-primary/50 bg-slate-900/70 shadow-2xl shadow-primary/20'
        : 'border-white/10 bg-white/5 opacity-80 hover:opacity-100'
    }`}
    role="button"
    tabIndex={0}
    onClick={() => {
      if (!isActive) {
        onActivate(panelKey);
      }
    }}
    onKeyDown={(event) => {
      if (!isActive && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onActivate(panelKey);
      }
    }}
  >
    <motion.div
      className="absolute inset-0 pointer-events-none"
      animate={isActive ? 'pulse' : undefined}
      variants={highlightVariants}
      style={{
        background: `radial-gradient(circle at top, ${accent}22, transparent 65%)`
      }}
    />
    <div className="relative p-8 space-y-6">
      {!isActive && (
        <div className="pointer-events-none absolute inset-0 rounded-3xl bg-slate-950/40 backdrop-blur-sm flex items-center justify-center text-xs uppercase tracking-[0.2em] text-white/60">
          Tap to activate
        </div>
      )}
      <div className="inline-flex items-center gap-3 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70">
        {icon}
        {badgeLabel || title}
      </div>
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white">{title}</h2>
        <p className="mt-2 text-sm text-white/70">{description}</p>
      </div>
      {children}
    </div>
  </motion.div>
);

const AuthPortal = ({ mode = 'login' }) => {
  const [loginData, setLoginData] = useState({ email: '', password: '' });
  const [signupData, setSignupData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'student',
    registrationCode: ''
  });
  const [isSubmitting, setIsSubmitting] = useState({ login: false, signup: false });
  const { login, signup } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState(mode);

  React.useEffect(() => {
    setActivePanel(mode);
  }, [mode]);

  const handlePanelActivate = (target) => {
    setActivePanel(target);
  };

  const loginActive = activePanel === 'login';
  const signupActive = activePanel === 'signup';

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting((state) => ({ ...state, login: true }));
    try {
      const user = await login({
        email: loginData.email.trim(),
        password: loginData.password,
      });

      if (user && !user.requiresEmailVerification) {
        toast({
          title: 'Welcome back!',
          description: 'You have successfully logged in.'
        });
        // Navigate to appropriate dashboard based on user role
        // Use setTimeout to ensure state is updated before navigation
        setTimeout(() => {
          const dashboardPath = user.role === 'super-admin' 
            ? '/dashboard/super-admin'
            : user.role === 'college-admin'
            ? '/dashboard/college-admin'
            : user.role === 'faculty'
            ? '/dashboard/faculty'
            : '/dashboard/student';
          navigate(dashboardPath, { replace: true });
        }, 100);
      } else {
        // If email verification is required, surface a friendlier message
        if (user?.requiresEmailVerification) {
          toast({
            variant: 'destructive',
            title: 'Verify your email',
            description: user.message || 'Please check your inbox to finish verifying your account.'
          });
        } else {
          toast({
            variant: 'destructive',
            title: 'Login Failed',
            description: 'Invalid email or password.'
          });
        }
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Login Error',
        description: 'Unable to sign you in right now.'
      });
    } finally {
      setIsSubmitting((state) => ({ ...state, login: false }));
    }
  };

  const handleSignupSubmit = async (event) => {
    event.preventDefault();

    if (signupData.password !== signupData.confirmPassword) {
      toast({
        variant: 'destructive',
        title: 'Signup Failed',
        description: 'Passwords do not match.'
      });
      return;
    }

    setIsSubmitting((state) => ({ ...state, signup: true }));
    try {
      const payload = {
        name: signupData.name,
        email: signupData.email,
        password: signupData.password,
        role: signupData.role
      };

      if (signupData.role === 'super-admin') {
        payload.registrationCode = signupData.registrationCode;
      }

      const user = await signup(payload);
      if (user) {
        toast({
          title: 'Account created',
          description: 'Welcome to EduHorizon!'
        });

        switch (user.role) {
          case 'super-admin':
            navigate('/dashboard/super-admin');
            break;
          case 'college-admin':
            navigate('/dashboard/college-admin');
            break;
          case 'faculty':
            navigate('/dashboard/faculty');
            break;
          case 'student':
            navigate('/dashboard/student');
            break;
          default:
            navigate('/dashboard');
        }
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Signup Failed',
        description: 'Could not create account. Please try again.'
      });
    } finally {
      setIsSubmitting((state) => ({ ...state, signup: false }));
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
        <div className="absolute inset-0 opacity-30 blur-3xl">
          <div className="absolute left-[-10%] top-[10%] h-72 w-72 rounded-full bg-blue-600/40 animate-pulse-slow" />
          <div className="absolute right-[-5%] bottom-[15%] h-96 w-96 rounded-full bg-purple-600/30 animate-pulse-slow delay-1000" />
        </div>
        <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-20 mix-blend-screen" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 lg:py-24">
        <div className="grid gap-6 lg:grid-cols-2">
          <AuthPanel
            isActive={loginActive}
            accent="#3b82f6"
            title="Sign In"
            description="Secure access for students, faculty, and administrators."
            icon={<LogIn className="h-4 w-4" />}
            badgeLabel="Workspace Access"
            onActivate={handlePanelActivate}
            panelKey="login"
          >
            <form className="space-y-5" onSubmit={handleLoginSubmit}>
              <fieldset disabled={!loginActive} className={!loginActive ? 'pointer-events-none opacity-60' : ''}>
              <div className="space-y-2">
                <Label htmlFor="login-email" className="text-white/80">
                  Email
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-white/40" />
                  <Input
                    id="login-email"
                    type="email"
                    value={loginData.email}
                    onChange={(event) => setLoginData((state) => ({ ...state, email: event.target.value }))}
                    placeholder="name@institution.edu"
                    required
                    className="h-12 rounded-2xl border-white/10 bg-white/5 pl-11 text-white placeholder:text-white/40 focus:border-primary focus:bg-slate-900/50"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password" className="text-white/80">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-white/40" />
                  <Input
                    id="login-password"
                    type="password"
                    value={loginData.password}
                    onChange={(event) => setLoginData((state) => ({ ...state, password: event.target.value }))}
                    placeholder="••••••••"
                    required
                    className="h-12 rounded-2xl border-white/10 bg-white/5 pl-11 text-white placeholder:text-white/40 focus:border-primary focus:bg-slate-900/50"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/70">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  Enterprise-grade security
                </div>
                <Link to="/forgot-password" className="font-medium text-primary hover:text-primary/80">
                  Forgot password?
                </Link>
              </div>
              <Button
                type="submit"
                disabled={isSubmitting.login || !loginActive}
                className="group h-12 w-full rounded-2xl bg-gradient-to-r from-primary to-blue-500 text-base font-semibold text-white shadow-xl shadow-primary/30 transition hover:opacity-95"
              >
                {isSubmitting.login ? (
                  <span className="flex items-center gap-3">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Signing in...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Enter workspace <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                )}
              </Button>
              <p className="text-center text-sm text-white/60">
                Need an account?{' '}
                <button
                  type="button"
                  className="font-semibold text-primary hover:text-primary/80"
                  onClick={() => handlePanelActivate('signup')}
                >
                  Create one
                </button>
              </p>
              </fieldset>
            </form>
          </AuthPanel>

          <AuthPanel
            isActive={signupActive}
            accent="#a855f7"
            title="Create Account"
            description="Onboard as a student, faculty, admin, or super admin."
            icon={<UserPlus className="h-4 w-4" />}
            badgeLabel="New Members"
            onActivate={handlePanelActivate}
            panelKey="signup"
          >
            <form className="space-y-5" onSubmit={handleSignupSubmit}>
              <fieldset disabled={!signupActive} className={!signupActive ? 'pointer-events-none opacity-60' : ''}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="signup-name" className="text-white/80">
                    Full Name
                  </Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-white/40" />
                    <Input
                      id="signup-name"
                      type="text"
                      value={signupData.name}
                      onChange={(event) => setSignupData((state) => ({ ...state, name: event.target.value }))}
                      placeholder="Jane Doe"
                      required
                      className="h-12 rounded-2xl border-white/10 bg-white/5 pl-11 text-white placeholder:text-white/40 focus:border-purple-400 focus:bg-slate-900/40"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-white/80">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-white/40" />
                    <Input
                      id="signup-email"
                      type="email"
                      value={signupData.email}
                      onChange={(event) => setSignupData((state) => ({ ...state, email: event.target.value }))}
                      placeholder="you@edu.institution"
                      required
                      className="h-12 rounded-2xl border-white/10 bg-white/5 pl-11 text-white placeholder:text-white/40 focus:border-purple-400 focus:bg-slate-900/40"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-white/80">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-white/40" />
                    <Input
                      id="signup-password"
                      type="password"
                      value={signupData.password}
                      onChange={(event) => setSignupData((state) => ({ ...state, password: event.target.value }))}
                      placeholder="••••••••"
                      required
                      className="h-12 rounded-2xl border-white/10 bg-white/5 pl-11 text-white placeholder:text-white/40 focus:border-purple-400 focus:bg-slate-900/40"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-confirm" className="text-white/80">
                    Confirm
                  </Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-white/40" />
                    <Input
                      id="signup-confirm"
                      type="password"
                      value={signupData.confirmPassword}
                      onChange={(event) => setSignupData((state) => ({ ...state, confirmPassword: event.target.value }))}
                      placeholder="••••••••"
                      required
                      className="h-12 rounded-2xl border-white/10 bg-white/5 pl-11 text-white placeholder:text-white/40 focus:border-purple-400 focus:bg-slate-900/40"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-white/80">I am a...</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="flex h-12 w-full items-center justify-between rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10"
                    >
                      {signupData.role.replace('-', ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
                      <ChevronRight className="h-4 w-4 rotate-90 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-full rounded-2xl border border-white/20 bg-slate-900/95 text-white">
                    {['student', 'faculty', 'college-admin', 'super-admin'].map((option) => (
                      <DropdownMenuItem
                        key={option}
                        onSelect={() => setSignupData((state) => ({ ...state, role: option }))}
                        className="capitalize text-sm"
                      >
                        {option.replace('-', ' ')}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {signupData.role === 'super-admin' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-2"
                >
                  <Label htmlFor="signup-code" className="text-white/80">
                    Registration Code
                  </Label>
                  <div className="relative">
                    <Key className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-white/40" />
                    <Input
                      id="signup-code"
                      type="password"
                      value={signupData.registrationCode}
                      onChange={(event) => setSignupData((state) => ({ ...state, registrationCode: event.target.value }))}
                      placeholder="Enter admin code"
                      required
                      className="h-12 rounded-2xl border-white/10 bg-white/5 pl-11 text-white placeholder:text-white/40 focus:border-purple-400 focus:bg-slate-900/40"
                    />
                  </div>
                  <p className="text-xs text-white/60">Required for super admin onboarding.</p>
                </motion.div>
              )}

              <Button
                type="submit"
                disabled={isSubmitting.signup || !signupActive}
                className="group h-12 w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-purple-500 to-blue-500 text-base font-semibold text-white shadow-xl shadow-purple-700/30 transition hover:opacity-95"
              >
                {isSubmitting.signup ? (
                  <span className="flex items-center gap-3">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Creating account...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Join EduHorizon <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                )}
              </Button>
              <p className="text-center text-sm text-white/60">
                Already with us?{' '}
                <button
                  type="button"
                  className="font-semibold text-primary hover:text-primary/80"
                  onClick={() => handlePanelActivate('login')}
                >
                  Sign in
                </button>
              </p>
              </fieldset>
            </form>
          </AuthPanel>
        </div>
      </div>
    </div>
  );
};

export default AuthPortal;

