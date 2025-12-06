import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { 
  BookOpenText, 
  Moon, 
  Sun, 
  LogOut, 
  User, 
  LayoutDashboard, 
  Settings, 
  BookMarked, 
  CheckSquare,
  X,
  Building,
  Users,
  FileText,
  BarChart3,
  UserCheck,
  Shield,
  ChevronDown
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuGroup, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { useTheme } from '@/components/ThemeProvider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const Sidebar = ({ onMobileClose }) => {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const location = useLocation();
  const { toast } = useToast();

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const handleLogout = () => {
    logout();
    toast({ title: "Logged Out", description: "You have been successfully logged out." });
  };
  
  const getInitials = (name) => {
    if (!name) return "U";
    const names = name.split(' ');
    if (names.length === 1) return names[0].charAt(0).toUpperCase();
    return names[0].charAt(0).toUpperCase() + names[names.length - 1].charAt(0).toUpperCase();
  };

  // Helper function to determine if a link is active
  const isActiveLink = (path) => {
    if (path === '/dashboard') {
      return location.pathname.startsWith('/dashboard');
    }
    if (path === '/assessments') {
      return location.pathname.startsWith('/assessments') && !location.pathname.startsWith('/student/assessments');
    }
    if (path === '/student/assessments') {
      return location.pathname.startsWith('/student/assessments');
    }
    if (path === '/admin/colleges') {
      return location.pathname.startsWith('/admin/colleges');
    }
    if (path === '/admin/users') {
      return location.pathname.startsWith('/admin/users');
    }
    if (path === '/analytics/dashboard') {
      return location.pathname.startsWith('/analytics');
    }
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  // Helper function to get link classes based on active state
  const getLinkClasses = (path) => {
    const baseClasses = "flex items-center gap-4 rounded-lg px-4 py-3 text-base font-medium transition-all duration-200";
    const activeClasses = "bg-primary text-primary-foreground shadow-sm";
    const inactiveClasses = "text-muted-foreground hover:bg-muted hover:text-foreground";
    
    return cn(baseClasses, isActiveLink(path) ? activeClasses : inactiveClasses);
  };

  // Helper function to get aria attributes for accessibility
  const getAriaAttributes = (path) => {
    return {
      'aria-current': isActiveLink(path) ? 'page' : undefined,
      'aria-label': isActiveLink(path) ? `${path.split('/').pop() || 'page'} (current page)` : undefined
    };
  };

  const navigationItems = [
    {
      title: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
      roles: ['super-admin', 'college-admin', 'faculty', 'student']
    },
    {
      title: "Colleges",
      href: "/admin/colleges",
      icon: Building,
      roles: ['super-admin']
    },
    {
      title: "Users",
      href: "/admin/users",
      icon: Users,
      roles: ['super-admin']
    },
    {
      title: "Assessments",
      href: "/assessments",
      icon: CheckSquare,
      roles: ['super-admin', 'college-admin', 'faculty', 'student']
    },
    {
      title: "Question Bank",
      href: "/question-bank",
      icon: FileText,
      roles: ['super-admin', 'college-admin', 'faculty']
    },
    {
      title: "Analytics",
      href: "/analytics/dashboard",
      icon: BarChart3,
      roles: ['super-admin', 'college-admin', 'faculty', 'student']
    },
    {
      title: "Profile",
      href: "/profile",
      icon: User,
      roles: ['super-admin', 'college-admin', 'faculty', 'student']
    },
  ];

  // Administration submenu items (removed - features deleted)
  const administrationItems = [];

  const filteredNavigationItems = navigationItems.filter(item => 
    item.roles.includes(user?.role)
  );

  const filteredAdministrationItems = administrationItems.filter(item => 
    item.roles.includes(user?.role)
  );

  return (
    <div className="fixed left-0 top-0 h-full w-64 bg-background border-r border-border flex flex-col z-40">
      {/* Header */}
      <div className="flex h-20 items-center justify-between border-b px-6 flex-shrink-0">
        <Link to="/" className="flex items-center space-x-3" onClick={onMobileClose}>
          <BookOpenText className="h-7 w-7 text-primary" />
          <span className="font-bold text-xl bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-500 to-pink-500">
            EduHorizon
          </span>
        </Link>
        {onMobileClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMobileClose}
            className="h-9 w-9 md:hidden"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-3 p-6 overflow-y-auto min-h-0">
        {filteredNavigationItems.map((item) => {
          const IconComponent = item.icon;
          let href = item.href;
          
          // Handle role-specific routes
          if (item.title === "Assessments" && user?.role === 'student') {
            href = "/student/assessments";
          }
          
          return (
            <Link
              key={`${item.href}-${item.roles.join('-')}`}
              to={href}
              className={getLinkClasses(href)}
              {...getAriaAttributes(href)}
              onClick={onMobileClose}
            >
              <IconComponent className="h-5 w-5 flex-shrink-0" />
              <span className="truncate">{item.title}</span>
            </Link>
          );
        })}

        {/* Administration Section - Only show if user has access to any admin items */}
        {filteredAdministrationItems.length > 0 && (
          <>
            <div className="pt-4 pb-2">
              <div className="flex items-center gap-2 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Shield className="h-4 w-4" />
                <span>Administration</span>
              </div>
            </div>
            {filteredAdministrationItems.map((item) => {
              const IconComponent = item.icon;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={getLinkClasses(item.href)}
                  {...getAriaAttributes(item.href)}
                  onClick={onMobileClose}
                >
                  <IconComponent className="h-5 w-5 flex-shrink-0" />
                  <span className="truncate">{item.title}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t p-6 space-y-3 flex-shrink-0">
        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="w-full justify-start h-auto p-3"
          aria-label="Toggle theme"
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="ml-4 text-base">Toggle Theme</span>
        </Button>

        {/* User Menu */}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start h-auto p-3">
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarImage src={user.avatarUrl || `https://avatar.vercel.sh/${user.email}.png`} alt={user.name || user.email} />
                  <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="ml-4 text-left min-w-0 flex-1">
                  <p className="text-base font-medium leading-none truncate">{user.name || "User"}</p>
                  <p className="text-sm leading-none text-muted-foreground truncate">
                    {user.email}
                  </p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user.name || "User"}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link to="/profile">
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/dashboard">
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    <span>Dashboard</span>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};

export default Sidebar; 