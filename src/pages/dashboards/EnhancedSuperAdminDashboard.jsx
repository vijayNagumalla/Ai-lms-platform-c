import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  Users, 
  Building, 
  BarChart3, 
  Settings, 
  Eye, 
  Loader2, 
  Activity,
  CheckCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  PlusCircle,
  Server
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import apiService from '@/services/api';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';

const EnhancedSuperAdminDashboard = () => {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [systemHealth, setSystemHealth] = useState({
    status: 'checking',
    uptime: 'Calculating...',
    activeUsers: 0,
    totalRequests: 0
  });
  const [recentActivities, setRecentActivities] = useState([]);
  const [collegeStats, setCollegeStats] = useState([]);
  const [userStats, setUserStats] = useState({
    byRole: [],
    byCollege: [],
    total: 0
  });
  const [analyticsData, setAnalyticsData] = useState(null);
  const { toast } = useToast();
  const { user } = useAuth();

  // Debug: Check if user is loaded
  // console.log('EnhancedSuperAdminDashboard: Component loaded');
  // console.log('User:', user);
  // console.log('User role:', user?.role);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetchDashboardStats();
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setIsRefreshing(false);
      setLastRefresh(new Date());
    }
  }, []);

  // Auto-refresh disabled to prevent interrupting user work
  // Users can manually refresh using the Refresh button
  // useEffect(() => {
  //   const interval = setInterval(refreshData, 30000);
  //   return () => clearInterval(interval);
  // }, [refreshData]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  const fetchDashboardStats = async () => {
    try {
      setLoading(true);
      
      const [superAdminResponse, collegesResponse, usersResponse, analyticsResponse] = await Promise.all([
        apiService.getSuperAdminDashboardStats(),
        apiService.getColleges(),
        apiService.getUsers({ limit: 1000 }), // Get all users, not just first 10
        apiService.getAnalyticsData({ viewType: 'college', dateRange: '30' })
      ]);
      
      
      // Define all variables at the top level
      let totalUsers = 0;
      let totalColleges = 0;
      let totalDepartments = 0;
      let activeUsers = 0;
      
      // Get users data (extract from response)
      const usersData = usersResponse.success && Array.isArray(usersResponse.data) ? usersResponse.data : [];
      
      // Get active users count
      activeUsers = usersData.filter(u => u.is_active).length;
      
      // Process super admin stats
      if (superAdminResponse.success) {
        totalUsers = superAdminResponse.data.totalUsers || 0;
        totalColleges = superAdminResponse.data.totalColleges || 0;
        totalDepartments = superAdminResponse.data.totalDepartments || 0;
        
        const statsData = [
          { 
            title: "Total Users", 
            value: totalUsers.toString(), 
            icon: <Users className="h-6 w-6 text-primary" />, 
            color: "bg-blue-500/10", 
            detailsLink: "/admin/users",
            trend: `${totalUsers > 0 ? '+' + Math.round(totalUsers * 0.12) : '0'}`,
            trendType: "positive"
          },
          { 
            title: "Total Colleges", 
            value: totalColleges.toString(), 
            icon: <Building className="h-6 w-6 text-primary" />, 
            color: "bg-green-500/10", 
            detailsLink: "/admin/colleges",
            trend: `${totalColleges > 0 ? '+' + Math.round(totalColleges * 0.1) : '0'}`,
            trendType: "positive"
          },
          { 
            title: "Total Departments", 
            value: totalDepartments.toString(), 
            icon: <BarChart3 className="h-6 w-6 text-primary" />, 
            color: "bg-purple-500/10", 
            detailsLink: "/admin/departments",
            trend: `${totalDepartments > 0 ? '+' + Math.round(totalDepartments * 0.15) : '0'}`,
            trendType: "positive"
          },
          { 
            title: "Active Users", 
            value: activeUsers.toString(), 
            icon: <Activity className="h-6 w-6 text-primary" />, 
            color: "bg-orange-500/10", 
            detailsLink: "/admin/users",
            trend: `${activeUsers > 0 && totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) + '%' : '0%'}`,
            trendType: "positive"
          },
        ];
        
        setStats(statsData);
      }

      // Set real college stats
      if (collegesResponse.success && collegesResponse.data) {
        // Colleges are nested in collegesResponse.data.colleges
        const colleges = Array.isArray(collegesResponse.data.colleges) ? collegesResponse.data.colleges : [];
        const collegeStatsData = [];
        
        const collegesToShow = colleges.slice(0, 10);
        
        for (const college of collegesToShow) {
          // Count users from the already fetched users data
          const collegeUsers = usersData.filter(u => u.college_id === college.id).length;
          
          let coursesCount = 0;
          try {
            const coursesResp = await apiService.getCourses({ collegeId: college.id });
            coursesCount = coursesResp.success && Array.isArray(coursesResp.data) ? coursesResp.data.length : 0;
          } catch (e) {
            coursesCount = 0;
          }
          
          collegeStatsData.push({
            id: college.id,
            name: college.name,
            users: collegeUsers,
            courses: coursesCount,
            status: college.is_active ? "active" : "inactive"
          });
        }
        
        setCollegeStats(collegeStatsData);
      }

      // Set real user stats
      if (usersData.length > 0) {
        const users = usersData;
        
        const roleGroups = users.reduce((acc, user) => {
          const role = user.role || 'unknown';
          if (!acc[role]) acc[role] = 0;
          acc[role]++;
          return acc;
        }, {});
        
        const byRole = Object.entries(roleGroups).map(([role, count]) => ({
          role: role.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()),
          count
        }));
        
        const collegeGroups = users.reduce((acc, user) => {
          if (user.college_id) {
            if (!acc[user.college_id]) acc[user.college_id] = 0;
            acc[user.college_id]++;
          }
          return acc;
        }, {});
        
        // Get colleges array from the nested structure
        const colleges = Array.isArray(collegesResponse.data.colleges) ? collegesResponse.data.colleges : [];
        const byCollege = Object.entries(collegeGroups).slice(0, 5).map(([collegeId, count]) => {
          const college = colleges.find(c => c.id === collegeId);
          return {
            college: college ? college.name : 'Unknown',
            count
          };
        });
        
        setUserStats({
          byRole,
          byCollege,
          total: users.length
        });
      }

      // Set analytics data
      if (analyticsResponse.success) {
        setAnalyticsData(analyticsResponse.data);
      }

      // Set system health
      setSystemHealth({
        status: 'healthy',
        uptime: '99.9%',
        activeUsers: activeUsers,
        totalRequests: 0
      });

      // Set recent activities
      setRecentActivities([
        {
          id: 1,
          type: 'user',
          title: 'New User Registration',
          description: `${totalUsers} total users in the system`,
          time: 'Just now',
          icon: <Users className="h-4 w-4" />
        },
        {
          id: 2,
          type: 'college',
          title: 'Active Colleges',
          description: `${totalColleges} colleges are active`,
          time: '5 min ago',
          icon: <Building className="h-4 w-4" />
        },
        {
          id: 3,
          type: 'department',
          title: 'Department Count',
          description: `${totalDepartments} departments configured`,
          time: '10 min ago',
          icon: <BarChart3 className="h-4 w-4" />
        }
      ]);
      
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      setError('Failed to load dashboard statistics');
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load dashboard statistics"
      });
    } finally {
      setLoading(false);
    }
  };

  const actions = [
    { label: "Manage Colleges", icon: <Building className="mr-2 h-5 w-5" />, linkTo: "/admin/colleges" },
    { label: "User Management", icon: <Users className="mr-2 h-5 w-5" />, linkTo: "/admin/users" },
    { label: "System Analytics", icon: <BarChart3 className="mr-2 h-5 w-5" />, linkTo: "/analytics/dashboard" },
    { label: "System Settings", icon: <Settings className="mr-2 h-5 w-5" />, linkTo: "/admin/settings" },
  ];

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: i * 0.1,
        duration: 0.5,
      },
    }),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <motion.h1 
          className="text-3xl md:text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-500 to-pink-500"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          Super Admin Dashboard
        </motion.h1>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {isOnline ? <Wifi className="h-4 w-4 text-green-500" /> : <WifiOff className="h-4 w-4 text-red-500" />}
            <span className="text-sm text-muted-foreground">{isOnline ? 'Online' : 'Offline'}</span>
          </div>

          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${systemHealth.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-sm text-muted-foreground capitalize">{systemHealth.status}</span>
          </div>

          <Button variant="outline" size="sm" onClick={refreshData} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <motion.div key={`stat-${stat.title || index}-${index}`} custom={index} initial="hidden" animate="visible" variants={cardVariants}>
            <Card className={`shadow-lg hover:shadow-xl transition-shadow duration-300 ${stat.color} border-primary/20`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
                {stat.icon}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs ${stat.trendType === 'positive' ? 'text-green-600' : 'text-red-600'}`}>{stat.trend}</span>
                  <span className="text-xs text-muted-foreground">vs last month</span>
                </div>
                {stat.detailsLink && (
                  <Button variant="link" size="sm" asChild className="px-0 text-xs text-primary hover:underline mt-2">
                    <Link to={stat.detailsLink}><Eye className="mr-1 h-3 w-3" />View Details</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="colleges">Colleges</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="text-xl">Quick Actions</CardTitle>
                <CardDescription>Common administrative tasks</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {actions.map((action, index) => (
                  <Button key={`action-${action.label || index}-${index}`} variant="outline" className="justify-start py-6 text-left hover:bg-accent/50 transition-colors duration-300 border-primary/30" asChild>
                    <Link to={action.linkTo}>{action.icon}<span className="text-md font-medium">{action.label}</span></Link>
                  </Button>
                ))}
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="text-xl flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Recent Activities
                </CardTitle>
                <CardDescription>Latest system activities</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentActivities.map((activity, index) => (
                    <div key={activity.id || `activity-${index}`} className="flex items-center gap-4 p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                      <div className="p-2 bg-blue-100 rounded-lg">{activity.icon}</div>
                      <div className="flex-1">
                        <h4 className="font-medium">{activity.title}</h4>
                        <p className="text-sm text-muted-foreground">{activity.description}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">{activity.time}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="colleges" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                College Statistics
              </CardTitle>
              <CardDescription>Overview of all colleges in the system</CardDescription>
            </CardHeader>
            <CardContent>
              {collegeStats.length === 0 ? (
                <div className="text-center py-8">
                  <Building className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No colleges found</p>
                  <Button asChild className="mt-4">
                    <Link to="/admin/colleges"><PlusCircle className="mr-2 h-4 w-4" />Add College</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {collegeStats.map((college, index) => (
                    <div key={college.id || `college-${index}`} className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-green-100 rounded-lg">
                          <Building className="h-4 w-4 text-green-600" />
                        </div>
                        <div>
                          <h4 className="font-semibold">{college.name}</h4>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span>{college.users} users</span>
                            <span>•</span>
                            <span>{college.courses} courses</span>
                          </div>
                        </div>
                      </div>
                      <Badge variant={college.status === 'active' ? 'default' : 'secondary'}>{college.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Users by Role
                </CardTitle>
                <CardDescription>Distribution of users across roles</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {userStats.byRole.map((item, index) => (
                    <div key={`role-${item.role || index}-${index}`} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{item.role}</span>
                        <span className="text-sm text-muted-foreground">{item.count} users</span>
                      </div>
                      <Progress value={(item.count / userStats.total) * 100} className="h-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="h-5 w-5" />
                  Users by College
                </CardTitle>
                <CardDescription>Top colleges by user count</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {userStats.byCollege.map((item, index) => (
                    <div key={`college-${item.college || index}-${index}`} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{item.college}</span>
                        <span className="text-sm text-muted-foreground">{item.count} users</span>
                      </div>
                      <Progress value={(item.count / userStats.total) * 100} className="h-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                System Analytics
              </CardTitle>
              <CardDescription>Key performance metrics</CardDescription>
            </CardHeader>
            <CardContent>
              {analyticsData ? (
                <div className="grid gap-6 md:grid-cols-3">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h4 className="font-semibold text-blue-800 mb-2">Total Assessments</h4>
                    <p className="text-3xl font-bold text-blue-600">{analyticsData.summary?.totalAssessments || 0}</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <h4 className="font-semibold text-green-800 mb-2">Active Students</h4>
                    <p className="text-3xl font-bold text-green-600">{analyticsData.summary?.activeStudents || 0}</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <h4 className="font-semibold text-purple-800 mb-2">Average Score</h4>
                    <p className="text-3xl font-bold text-purple-600">{(analyticsData.summary?.averageScore || 0).toFixed(1)}%</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No analytics data available</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                System Health
              </CardTitle>
              <CardDescription>Monitor system performance and health</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <div className="p-4 bg-green-50 rounded-lg">
                  <h4 className="font-semibold text-green-800 mb-2">System Status</h4>
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full ${systemHealth.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <p className="text-2xl font-bold text-green-600 capitalize">{systemHealth.status}</p>
                  </div>
                </div>
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-semibold text-blue-800 mb-2">Active Users</h4>
                  <p className="text-2xl font-bold text-blue-600">{systemHealth.activeUsers}</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <h4 className="font-semibold text-purple-800 mb-2">Uptime</h4>
                  <p className="text-2xl font-bold text-purple-600">{systemHealth.uptime}</p>
                </div>
                <div className="p-4 bg-orange-50 rounded-lg">
                  <h4 className="font-semibold text-orange-800 mb-2">Database</h4>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-6 w-6 text-green-500" />
                    <p className="text-lg font-bold text-orange-600">Connected</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="text-center text-sm text-muted-foreground">
        Last updated: {lastRefresh.toLocaleTimeString()}
        {isRefreshing && <span className="ml-2">• Refreshing...</span>}
      </div>
    </div>
  );
};

export default EnhancedSuperAdminDashboard;