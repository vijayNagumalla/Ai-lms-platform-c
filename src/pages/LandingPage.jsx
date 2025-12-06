import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  BookOpen,
  Code2,
  BarChart3,
  ShieldCheck,
  Users,
  GraduationCap,
  ArrowRight,
  CheckCircle2,
  Globe,
  MonitorPlay,
  BrainCircuit
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiConfig';

// Counter Component for "Live" Stats
const Counter = ({ from, to, duration = 2 }) => {
  const [count, setCount] = useState(from);

  useEffect(() => {
    let startTime;
    let animationFrame;

    const updateCount = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = timestamp - startTime;
      const percentage = Math.min(progress / (duration * 1000), 1);

      setCount(Math.floor(from + (to - from) * percentage));

      if (progress < duration * 1000) {
        animationFrame = requestAnimationFrame(updateCount);
      }
    };

    animationFrame = requestAnimationFrame(updateCount);

    return () => cancelAnimationFrame(animationFrame);
  }, [from, to, duration]);

  return <span>{count.toLocaleString()}</span>;
};

const LandingPage = () => {
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.2], [1, 0.95]);

  const scrollToSection = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const [stats, setStats] = useState({
    activeUsers: 0,
    institutions: 0,
    assessments: 0,
    submissions: 0
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const baseUrl = getApiBaseUrl();
        const response = await fetch(`${baseUrl}/analytics/public-stats`);
        
        // Check if response is OK and is JSON
        if (!response.ok) {
          console.warn('Stats endpoint returned non-OK status:', response.status);
          // Use default stats (already set to 0)
          return;
        }
        
        // Check content-type before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.warn('Stats endpoint returned non-JSON response:', contentType);
          // Use default stats (already set to 0)
          return;
        }
        
        const data = await response.json();
        if (data && data.success && data.data) {
          setStats(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
        // Silently fail and use default stats (already set to 0)
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-blue-100">
      {/* Minimal Navigation */}
      <nav className="fixed w-full z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
              <GraduationCap className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-900 tracking-tight">
              EduHorizon
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <button onClick={() => scrollToSection('features')} className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">Features</button>
            <button onClick={() => scrollToSection('solutions')} className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">Solutions</button>
            <button onClick={() => scrollToSection('about')} className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">About</button>
            <div className="flex items-center gap-4 pl-4 border-l border-slate-200">
              <Link to="/login">
                <Button variant="ghost" className="font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50">Sign In</Button>
              </Link>
              <Link to="/signup">
                <Button className="font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20 rounded-full px-6">
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Clean Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
        <div className="container mx-auto px-6">
          <motion.div
            style={{ opacity, scale }}
            className="max-w-4xl mx-auto text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 text-blue-600 text-sm font-medium mb-8 border border-blue-100">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              Reimagining Education Intelligence
            </div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 text-slate-900 leading-[1.1]">
              The Future of Learning is <br />
              <span className="text-blue-600">Simple & Intelligent</span>
            </h1>

            <p className="text-xl text-slate-500 mb-12 max-w-2xl mx-auto leading-relaxed font-light">
              A unified platform for assessments, coding, and analytics.
              Designed for modern institutions that value clarity and performance.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/signup">
                <Button size="lg" className="h-14 px-8 text-lg bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl shadow-blue-600/20 transition-all hover:scale-105">
                  Start Free Trial <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <button onClick={() => scrollToSection('features')} className="h-14 px-8 text-lg font-medium text-slate-600 hover:text-blue-600 transition-colors flex items-center gap-2">
                <MonitorPlay className="h-5 w-5" /> Watch Demo
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Live Stats Section */}
      <section className="py-16 border-y border-slate-100 bg-slate-50/50">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
            {[
              { label: "Active Users", value: stats.activeUsers, suffix: "+" },
              { label: "Institutions", value: stats.institutions, suffix: "+" },
              { label: "Assessments", value: stats.assessments, suffix: "+" },
              { label: "Submissions", value: stats.submissions, suffix: "+" },
            ].map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-4xl md:text-5xl font-bold text-slate-900 mb-2 font-mono tracking-tight">
                  <Counter from={0} to={stat.value || 0} />{stat.suffix}
                </div>
                <div className="text-sm text-slate-500 font-medium uppercase tracking-wider">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-white">
        <div className="container mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-20">
            <h2 className="text-3xl md:text-4xl font-bold mb-6 text-slate-900">Everything you need, nothing you don't.</h2>
            <p className="text-lg text-slate-500 font-light">
              Powerful features wrapped in a minimalist interface.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-12">
            {[
              {
                icon: <ShieldCheck className="h-10 w-10 text-emerald-500" />,
                title: "AI Proctoring",
                description: "Secure exams with non-intrusive, intelligent monitoring."
              },
              {
                icon: <Code2 className="h-10 w-10 text-blue-500" />,
                title: "Coding Suite",
                description: "Professional-grade IDE with automated test cases."
              },
              {
                icon: <BarChart3 className="h-10 w-10 text-violet-500" />,
                title: "Deep Analytics",
                description: "Actionable insights for students and faculty."
              },
            ].map((feature, index) => (
              <div key={index} className="group p-8 rounded-3xl bg-slate-50 hover:bg-white border border-slate-100 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-900/5 transition-all duration-300">
                <div className="mb-6 p-4 rounded-2xl bg-white shadow-sm border border-slate-100 w-fit group-hover:scale-110 transition-transform duration-300">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold mb-3 text-slate-900">{feature.title}</h3>
                <p className="text-slate-500 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solutions Section */}
      <section id="solutions" className="py-24 bg-slate-900 text-white">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold mb-6">Built for every stakeholder.</h2>
              <p className="text-slate-400 text-lg mb-8 font-light">
                Whether you're an administrator, faculty member, or student, EduHorizon adapts to your workflow.
              </p>
              <ul className="space-y-6">
                {[
                  "Streamlined administration tools",
                  "Intuitive grading for faculty",
                  "Distraction-free learning for students"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 text-blue-500" />
                    <span className="text-lg">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full" />
              <div className="relative bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl">
                <div className="flex items-center gap-4 mb-8">
                  <div className="h-12 w-12 rounded-full bg-slate-700 animate-pulse" />
                  <div className="space-y-2">
                    <div className="h-4 w-32 bg-slate-700 rounded animate-pulse" />
                    <div className="h-3 w-24 bg-slate-700 rounded animate-pulse" />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="h-24 w-full bg-slate-700/50 rounded-xl animate-pulse" />
                  <div className="h-24 w-full bg-slate-700/50 rounded-xl animate-pulse delay-100" />
                  <div className="h-24 w-full bg-slate-700/50 rounded-xl animate-pulse delay-200" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="py-24 bg-white">
        <div className="container mx-auto px-6 text-center">
          <BrainCircuit className="h-16 w-16 text-blue-600 mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-slate-900">Our Mission</h2>
          <p className="text-xl text-slate-500 max-w-3xl mx-auto font-light leading-relaxed">
            We believe technology should enhance education, not complicate it.
            Our mission is to provide a seamless, intelligent platform that empowers institutions to focus on what matters most: <span className="text-blue-600 font-medium">Learning.</span>
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-blue-600">
        <div className="container mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-8 text-white">Ready to simplify?</h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup">
              <Button size="lg" variant="secondary" className="h-14 px-10 text-lg font-semibold text-blue-600 hover:bg-white/90 shadow-xl">
                Get Started Now
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200 pt-16 pb-8">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-2 mb-6">
                <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <GraduationCap className="h-5 w-5 text-white" />
                </div>
                <span className="text-xl font-bold text-slate-900">EduHorizon</span>
              </div>
              <p className="text-slate-500 max-w-sm mb-6">
                Simplifying education management with intelligence and design.
              </p>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-6">Platform</h4>
              <ul className="space-y-4 text-sm text-slate-500">
                <li><button onClick={() => scrollToSection('features')} className="hover:text-blue-600 transition-colors">Features</button></li>
                <li><button onClick={() => scrollToSection('solutions')} className="hover:text-blue-600 transition-colors">Solutions</button></li>
                <li><Link to="/pricing" className="hover:text-blue-600 transition-colors">Pricing</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 mb-6">Company</h4>
              <ul className="space-y-4 text-sm text-slate-500">
                <li><Link to="/about" className="hover:text-blue-600 transition-colors">About Us</Link></li>
                <li><Link to="/careers" className="hover:text-blue-600 transition-colors">Careers</Link></li>
                <li><Link to="/blog" className="hover:text-blue-600 transition-colors">Blog</Link></li>
                <li><Link to="/contact" className="hover:text-blue-600 transition-colors">Contact</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
            <p>© 2024 EduHorizon Inc. All rights reserved.</p>
            <div className="flex gap-8">
              <Link to="/privacy" className="hover:text-blue-600 transition-colors">Privacy Policy</Link>
              <Link to="/terms" className="hover:text-blue-600 transition-colors">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
