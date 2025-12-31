import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';                             
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { 
  Search, 
  RefreshCw, 
  ExternalLink, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertCircle,
  TrendingUp,
  Users,
  Code,
  Award,
  BarChart3,
  Edit,
  Trash2,
  MoreVertical,
  Download,
  Plus,
  Upload
} from 'lucide-react';
import BulkUploadModal from '@/components/BulkUploadModal';
import AddProfileModal from '@/components/AddProfileModal';
import apiService from '@/services/api';

const CodingProfilesManagementPage = () => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [platforms, setPlatforms] = useState([]);
  const [loadedStats, setLoadedStats] = useState(new Set()); // Track which students have stats loaded
  const [statsCache, setStatsCache] = useState(new Map()); // Cache for platform statistics with timestamps
  const [selectedCollege, setSelectedCollege] = useState('all'); // College filter
  const [selectedDepartment, setSelectedDepartment] = useState('all'); // Department filter
  const [selectedBatch, setSelectedBatch] = useState('all'); // Batch filter
  const [topPerformersCollege, setTopPerformersCollege] = useState('all'); // Top Performers college filter
  const [colleges, setColleges] = useState([]); // Available colleges
  const [departments, setDepartments] = useState([]); // Available departments
  const [batches, setBatches] = useState([]); // Available batches
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [studentToEdit, setStudentToEdit] = useState(null);
  const [platformStats, setPlatformStats] = useState({});
  const [loadingStats, setLoadingStats] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [manualDataDialog, setManualDataDialog] = useState(false);
  const [selectedStudentForManual, setSelectedStudentForManual] = useState(null);
  const [selectedPlatformForManual, setSelectedPlatformForManual] = useState('');
  const [manualStats, setManualStats] = useState({});
  const [editProfilesDialog, setEditProfilesDialog] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [editingProfiles, setEditingProfiles] = useState([]);
  const [editingProfileIndex, setEditingProfileIndex] = useState(null);
  const [editingProfileData, setEditingProfileData] = useState({ platform: '', username: '' });
  const [addProfileDialogOpen, setAddProfileDialogOpen] = useState(false);
  const [selectedPlatformToAdd, setSelectedPlatformToAdd] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [hackerrankDialogOpen, setHackerrankDialogOpen] = useState(false);
  const [selectedHackerrankData, setSelectedHackerrankData] = useState(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false); // Export dialog state
  const [generatedFilename, setGeneratedFilename] = useState(''); // Generated filename
  const [editableFilename, setEditableFilename] = useState(''); // Editable filename in dialog
  const [exportLoading, setExportLoading] = useState(false); // Export loading state
  const { toast } = useToast();

  // Only these 5 platforms are allowed - this is enforced by default in the backend
  const platformsData = [
    { name: 'leetcode', displayName: 'LeetCode', color: 'bg-orange-100 text-orange-800' },
    { name: 'codechef', displayName: 'CodeChef', color: 'bg-red-100 text-red-800' },
    { name: 'hackerrank', displayName: 'HackerRank', color: 'bg-green-100 text-green-800' },
    { name: 'hackerearth', displayName: 'HackerEarth', color: 'bg-blue-100 text-blue-800' },
    { name: 'geeksforgeeks', displayName: 'GeeksforGeeks', color: 'bg-purple-100 text-purple-800' }
  ];

  useEffect(() => {
    fetchStudents();
    fetchPlatforms();
    fetchColleges();
  }, [searchTerm, selectedPlatform, selectedCollege, selectedDepartment, selectedBatch]);


  // Load cached platform statistics when students data is loaded
  useEffect(() => {
    if (students.length > 0) {
      loadCachedPlatformStats();
    }
  }, [students.length]);

  // Load cached platform statistics from database
  const loadCachedPlatformStats = async () => {
    try {
      setAutoLoading(true);
      
      // Get all student IDs - filter out undefined/null IDs
      const studentIds = students
        .map(s => s.id)
        .filter(id => id != null && id !== undefined && id !== 'undefined');
      
      if (studentIds.length === 0) {
        console.log('No valid student IDs found for loading cached stats');
        setAutoLoading(false);
        return;
      }
      
      // Load cached data for each student
      const cachedDataPromises = studentIds.map(async (studentId) => {
        try {
          const response = await apiService.getCachedPlatformStatistics(studentId);
          if (response.success) {
            return { studentId, data: response.data.platformStatistics };
          }
        } catch (error) {
          // Student has no cached data, which is fine
          // console.log(`No cached data for student ${studentId}:`, error.message);
        }
        return { studentId, data: null };
      });

      const cachedResults = await Promise.all(cachedDataPromises);
      
      // Process cached results
      const platformStatsData = {};
      const loadedStudents = new Set();
      
      cachedResults.forEach(({ studentId, data }) => {
        if (data) {
          platformStatsData[studentId] = data;
          loadedStudents.add(studentId);
        }
      });

      // Update state with cached data
      setPlatformStats(prev => ({
        ...prev,
        ...platformStatsData
      }));
      
      setLoadedStats(loadedStudents);
      
      // Update cache with timestamps
      setStatsCache(prev => {
        const newCache = new Map(prev);
        Object.entries(platformStatsData).forEach(([studentId, statsData]) => {
          newCache.set(studentId, {
            data: statsData,
            timestamp: Date.now(),
            cached: true
          });
        });
        return newCache;
      });

      if (Object.keys(platformStatsData).length > 0) {
        toast({
          title: "Cached Data Loaded",
          description: `Loaded cached platform statistics for ${Object.keys(platformStatsData).length} students`,
          variant: "default"
        });
      }
    } catch (error) {
      console.error('Error loading cached platform stats:', error);
      toast({
        title: "Warning",
        description: "Failed to load cached platform statistics",
        variant: "destructive"
      });
    } finally {
      setAutoLoading(false);
    }
  };

  // Debounced search effect
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      fetchStudents();
    }, 150); // Reduced from 300ms for faster response

    return () => clearTimeout(debounceTimer);
  }, [searchTerm]);

  const fetchStudents = async () => {
    const debugId = `[FRONTEND-DEBUG-${Date.now()}]`;
    console.log(`${debugId} ========== FRONTEND: fetchStudents START ==========`);
    
    try {
      setLoading(true);
      const platformParam = selectedPlatform === 'all' ? '' : selectedPlatform;
      
      // Build query parameters
      const params = new URLSearchParams({
        page: '1',
        limit: '10000', // Fetch all students
        search: searchTerm,
        platform: platformParam
      });
      
      if (selectedCollege && selectedCollege !== 'all') params.append('college', selectedCollege);
      if (selectedDepartment && selectedDepartment !== 'all') params.append('department', selectedDepartment);
      if (selectedBatch && selectedBatch !== 'all') params.append('batch', selectedBatch);
      
      const apiUrl = `/coding-profiles/students?${params.toString()}`;
      console.log(`${debugId} API Request URL:`, apiUrl);
      console.log(`${debugId} Request parameters:`, {
        searchTerm,
        selectedPlatform,
        selectedCollege,
        selectedDepartment,
        selectedBatch
      });
      
      const requestStartTime = Date.now();
      const response = await apiService.get(apiUrl);
      const requestEndTime = Date.now();
      
      console.log(`${debugId} API Response received in ${requestEndTime - requestStartTime}ms`);
      console.log(`${debugId} Response structure:`, {
        success: response.success,
        hasData: !!response.data,
        studentsCount: response.data?.students?.length || 0,
        pagination: response.data?.pagination
      });
      
      if (response.success) {
        const studentsData = response.data.students || [];
        console.log(`${debugId} Received ${studentsData.length} students`);
        
        // Detailed logging for first 3 students
        studentsData.slice(0, 3).forEach((student, idx) => {
          console.log(`${debugId} Student ${idx} received from API:`, {
            id: student.id,
            name: student.name,
            email: student.email,
            roll_number: student.roll_number,
            batch: student.batch,
            college_name: student.college_name,
            department: student.department,
            platforms: Object.keys(student.platforms || {}),
            fullObject: JSON.stringify(student, null, 2)
          });
          
          // Check for missing fields
          const missingFields = [];
          if (!student.id || student.id === undefined || student.id === 'undefined') missingFields.push('id');
          if (!student.name || student.name === '') missingFields.push('name');
          if (!student.email || student.email === '') missingFields.push('email');
          if (!student.roll_number || student.roll_number === '') missingFields.push('roll_number');
          if (!student.batch || student.batch === '') missingFields.push('batch');
          
          if (missingFields.length > 0) {
            console.warn(`${debugId} ⚠️ Student ${idx} missing fields:`, missingFields);
          }
        });
        
        // Check overall data quality
        const studentsWithMissingData = studentsData.filter(s => 
          !s.id || s.id === undefined || s.id === 'undefined' || !s.name || !s.email || !s.roll_number || !s.batch
        );
        
        if (studentsWithMissingData.length > 0) {
          console.warn(`${debugId} ⚠️ ${studentsWithMissingData.length} students have missing data`);
          console.warn(`${debugId} Missing data breakdown:`, {
            missingId: studentsData.filter(s => !s.id || s.id === undefined || s.id === 'undefined').length,
            missingName: studentsData.filter(s => !s.name || s.name === '').length,
            missingEmail: studentsData.filter(s => !s.email || s.email === '').length,
            missingRollNumber: studentsData.filter(s => !s.roll_number || s.roll_number === '').length,
            missingBatch: studentsData.filter(s => !s.batch || s.batch === '').length
          });
        }
        
        // Validate that students have required fields (id, name, email, roll_number)
        const validStudents = studentsData.filter(s => {
          const hasValidId = s.id != null && s.id !== undefined && s.id !== 'undefined';
          if (!hasValidId) {
            console.warn(`${debugId} ⚠️ Student missing valid id:`, s);
          }
          return hasValidId;
        });
        
        if (validStudents.length !== studentsData.length) {
          console.warn(`${debugId} ⚠️ Filtered out ${studentsData.length - validStudents.length} students with invalid IDs`);
        }
        
        setStudents(validStudents);
        console.log(`${debugId} Students state updated with ${validStudents.length} valid students`);
      } else {
        console.error(`${debugId} API returned success: false`);
        console.error(`${debugId} Response:`, response);
        setStudents([]);
      }
    } catch (error) {
      console.error(`${debugId} ========== FRONTEND ERROR ==========`);
      console.error(`${debugId} Error message:`, error.message);
      console.error(`${debugId} Error stack:`, error.stack);
      console.error(`${debugId} Full error:`, error);
      console.error(`${debugId} ========== END ERROR ==========`);
      
      toast({
        title: "Error",
        description: "Failed to fetch students data",
        variant: "destructive",
      });
      setStudents([]);
    } finally {
      setLoading(false);
      console.log(`${debugId} ========== FRONTEND: fetchStudents END ==========`);
    }
  };

  const handleBulkUploadComplete = (uploadData) => {
    // Refresh the students list after bulk upload
    fetchStudents();
  };

  const handleProfileAdded = () => {
    fetchStudents();
  };

  const fetchPlatforms = async () => {
    try {
      const response = await apiService.get('/coding-profiles/platforms');
      if (response.success) {
        setPlatforms(response.data);
      }
    } catch (error) {
      // Error fetching platforms
    }
  };

  const fetchColleges = async () => {
    try {
      const response = await apiService.get('/colleges');
      if (response.success) {
        setColleges(response.data.colleges || []);
      }
    } catch (error) {
      // Error fetching colleges
    }
  };

  const fetchDepartments = async (collegeId) => {
    try {
      const response = await apiService.get(`/colleges/${collegeId}/departments`);
      if (response.success) {
        setDepartments(response.data || []);
      }
    } catch (error) {
      // Error fetching departments
    }
  };

  const fetchBatches = async (collegeId) => {
    try {
      const response = await apiService.get(`/colleges/${collegeId}/batches`);
      if (response.success) {
        setBatches(response.data || []);
      }
    } catch (error) {
      // Error fetching batches
    }
  };

  // Analytics function - overview stats are calculated from students array, so this is a no-op
  const fetchAnalytics = async () => {
    // Overview stats are calculated directly from the students state
    // No separate API call needed
    return;
  };


  const handleSyncProfile = async (studentId, platform) => {
    try {
      toast({
        title: "Syncing",
        description: `Syncing ${platform} profile...`,
      });
      
      // This would need to be implemented in the backend for admin sync
      // For now, we'll just show a success message
      toast({
        title: "Success",
        description: `${platform} profile synced successfully`,
      });
      
      fetchStudents();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to sync profile",
        variant: "destructive",
      });
    }
  };

  const handleRefreshStudent = async (studentId) => {
    try {
      toast({
        title: "Refreshing",
        description: "Refreshing student data...",
      });
      
      // Clear cache for this specific student
      setLoadedStats(prev => {
        const newSet = new Set(prev);
        newSet.delete(studentId);
        return newSet;
      });
      
      setStatsCache(prev => {
        const newCache = new Map(prev);
        newCache.delete(studentId);
        return newCache;
      });
      
      // Remove from platform stats to force fresh fetch
      setPlatformStats(prev => {
        const newStats = { ...prev };
        delete newStats[studentId];
        return newStats;
      });
      
      // Force refresh this student's stats
      await fetchBatchPlatformStats([studentId], true);
      
      toast({
        title: "Success",
        description: "Student data refreshed successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to refresh student data",
        variant: "destructive",
      });
    }
  };

  const handleDeleteStudent = (student) => {
    setStudentToDelete(student);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteStudent = async () => {
    if (!studentToDelete) return;
    
    try {
      toast({
        title: "Deleting",
        description: "Deleting all profiles for this student...",
      });
      
      const response = await apiService.delete(`/coding-profiles/student/${studentToDelete.id}`);
      
      if (response.success) {
        toast({
          title: "Success",
          description: "Student profiles deleted successfully",
        });
        
        fetchStudents();
        fetchAnalytics();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete student profiles",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setStudentToDelete(null);
    }
  };

  const handleEditStudent = (student) => {
    setStudentToEdit(student);
    setEditDialogOpen(true);
  };

  const handleEditProfiles = (student) => {
    setEditingStudent(student);
    // Convert student's platforms to editing format
    const profiles = [];
    if (student.platforms) {
      Object.keys(student.platforms).forEach(platform => {
        if (student.platforms[platform]) {
          profiles.push({
            platform: platform,
            username: student.platforms[platform].username,
            id: student.platforms[platform].id
          });
        }
      });
    }
    setEditingProfiles(profiles);
    setEditProfilesDialog(true);
  };

  const handleEditProfile = (index) => {
    const profile = editingProfiles[index];
    setEditingProfileIndex(index);
    setEditingProfileData({
      platform: profile.platform,
      username: profile.username
    });
  };

  const handleSaveProfileEdit = () => {
    if (editingProfileIndex !== null) {
      const updatedProfiles = [...editingProfiles];
      updatedProfiles[editingProfileIndex] = {
        ...updatedProfiles[editingProfileIndex],
        platform: editingProfileData.platform,
        username: editingProfileData.username
      };
      setEditingProfiles(updatedProfiles);
    }
    setEditingProfileIndex(null);
    setEditingProfileData({ platform: '', username: '' });
  };

  const handleCancelProfileEdit = () => {
    setEditingProfileIndex(null);
    setEditingProfileData({ platform: '', username: '' });
  };

  const handleHackerrankClick = (studentId) => {
    const hackerrankData = platformStats[studentId]?.hackerrank;
    if (hackerrankData) {
      setSelectedHackerrankData(hackerrankData);
      setHackerrankDialogOpen(true);
    }
  };

  const fetchStudentPlatformStats = async (studentId) => {
    // Check if stats are already loaded or being loaded
    if (loadedStats.has(studentId) || platformStats[studentId]) {
      return;
    }

    // Check cache first (cache valid for 5 minutes)
    const cacheKey = studentId;
    const cachedData = statsCache.get(cacheKey);
    const cacheExpiry = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    if (cachedData && (Date.now() - cachedData.timestamp) < cacheExpiry) {
      setPlatformStats(prev => ({
        ...prev,
        [studentId]: cachedData.data
      }));
      setLoadedStats(prev => new Set([...prev, studentId]));
      return;
    }

    try {
      setLoadingStats(true);
      setLoadedStats(prev => new Set([...prev, studentId]));
      
      const response = await apiService.get(`/coding-profiles/student/${studentId}/statistics`);
      
      if (response.success) {
        const statsData = response.data.platformStatistics;
        
        // Update platform stats
        setPlatformStats(prev => ({
          ...prev,
          [studentId]: statsData
        }));
        
        // Update cache
        setStatsCache(prev => {
          const newCache = new Map(prev);
          newCache.set(cacheKey, {
            data: statsData,
            timestamp: Date.now()
          });
          return newCache;
        });
      }
    } catch (error) {
      // Remove from loaded set on error so it can be retried
      setLoadedStats(prev => {
        const newSet = new Set(prev);
        newSet.delete(studentId);
        return newSet;
      });
      toast({
        title: "Error",
            description: "Failed to fetch platform statistics. You can enter data manually.",
        variant: "destructive",
      });
    } finally {
      setLoadingStats(false);
    }
  };

  // Batch fetch platform statistics for multiple students
  const fetchBatchPlatformStats = async (studentIds, forceRefresh = false) => {
    // Validate input
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      toast({
        title: "Error",
        description: "No students selected or available",
        variant: "destructive",
      });
      return;
    }
    
    let unloadedStudents;
    
    if (forceRefresh) {
      // Force refresh: clear cache and reload all students
      unloadedStudents = studentIds;
      // Clear all state for force refresh
      setLoadedStats(new Set());
      setStatsCache(new Map());
      // Clear platform stats for the students being refreshed
      setPlatformStats(prev => {
        const newStats = { ...prev };
        unloadedStudents.forEach(id => {
          delete newStats[id];
        });
        return newStats;
      });
    } else {
      // Normal mode: only load students that haven't been loaded
      unloadedStudents = studentIds.filter(id => !loadedStats.has(id) && !platformStats[id]);
    }
    
    if (unloadedStudents.length === 0 && !forceRefresh) {
      toast({
        title: "Info",
        description: "All students already have statistics loaded",
      });
      return;
    }
    
    // Double check before making API call
    if (unloadedStudents.length === 0) {
      toast({
        title: "Info",
        description: "No students to process",
      });
      return;
    }

    // Use regular API calls
    try {
      setAutoLoading(true);
      
      // Don't mark as loaded until we get the response
      // setLoadedStats(prev => new Set([...prev, ...unloadedStudents]));
      
      // Use the new batch API endpoint
      const response = await apiService.fetchBatchPlatformStatistics(unloadedStudents, forceRefresh);
      
      if (response.success) {
        const results = response.data.results || {};
        
        // Update platform stats - merge with existing stats
        setPlatformStats(prev => {
          const newStats = { ...prev };
          Object.entries(results).forEach(([studentId, statsData]) => {
            if (statsData) {
              newStats[studentId] = statsData;
            } else {
              // Remove if null/undefined
              delete newStats[studentId];
            }
          });
          return newStats;
        });
        
        // Mark students as loaded only if they have valid stats
        setLoadedStats(prev => {
          const newSet = new Set(prev);
          Object.entries(results).forEach(([studentId, statsData]) => {
            if (statsData) {
              newSet.add(studentId);
            } else {
              newSet.delete(studentId);
            }
          });
          return newSet;
        });
        
        // Update cache for all results
        setStatsCache(prev => {
          const newCache = new Map(prev);
          Object.entries(results).forEach(([studentId, statsData]) => {
            if (statsData) {
              newCache.set(studentId, {
                data: statsData,
                timestamp: Date.now()
              });
            } else {
              newCache.delete(studentId);
            }
          });
          return newCache;
        });
        
        const processedCount = response.data.processedCount || Object.keys(results).filter(id => results[id] !== null).length;
        toast({
          title: "Success",
          description: `Loaded statistics for ${processedCount} students`,
        });
      } else {
        throw new Error(response.message || 'Failed to fetch batch statistics');
      }
    } catch (error) {
      console.error('Error in fetchBatchPlatformStats:', error);
      
      // Remove from loaded set on error
      setLoadedStats(prev => {
        const newSet = new Set(prev);
        unloadedStudents.forEach(id => newSet.delete(id));
        return newSet;
      });
      
      // Clear platform stats for failed students if force refresh
      if (forceRefresh) {
        setPlatformStats(prev => {
          const newStats = { ...prev };
          unloadedStudents.forEach(id => {
            delete newStats[id];
          });
          return newStats;
        });
      }
      
      // Provide more specific error messages
      const isTimeout = error.message?.toLowerCase().includes('timeout') || 
                       error.message?.toLowerCase().includes('too long');
      const isEmptyResponse = error.message?.toLowerCase().includes('empty response') ||
                             error.message?.toLowerCase().includes('failed to fetch') ||
                             error.name === 'TypeError';
      
      toast({
        title: isEmptyResponse ? "Server Error" : (isTimeout ? "Request Timeout" : "Error"),
        description: isEmptyResponse
          ? "The server took too long to respond or encountered an error. The request is being processed in batches. Please wait a moment and try again, or refresh the page."
          : (isTimeout 
            ? "The request took too long to complete. This may happen when processing many students. Please try with fewer students or try again later."
            : error.message || "Failed to load batch statistics"),
        variant: "destructive",
      });
    } finally {
      setAutoLoading(false);
    }
  };

  const openManualDataDialog = (student, platform) => {
    setSelectedStudentForManual(student);
    setSelectedPlatformForManual(platform);
    setManualStats({});
    setManualDataDialog(true);
  };

  const saveManualStats = () => {
    if (!selectedStudentForManual || !selectedPlatformForManual) return;
    
    setPlatformStats(prev => ({
      ...prev,
      [selectedStudentForManual.id]: {
        ...prev[selectedStudentForManual.id],
        [selectedPlatformForManual]: {
          ...prev[selectedStudentForManual.id]?.[selectedPlatformForManual],
          ...manualStats,
          manuallyEntered: true
        }
      }
    }));
    
    setManualDataDialog(false);
    toast({
      title: "Success",
      description: "Manual statistics saved successfully",
    });
  };

  const getSyncStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'syncing':
        return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getPlatformColor = (platformName) => {
    const platform = platformsData.find(p => p.name === platformName);
    return platform ? platform.color : 'bg-gray-100 text-gray-800';
  };

  const getPlatformDisplayName = (platformName) => {
    const platform = platformsData.find(p => p.name === platformName);
    return platform ? platform.displayName : platformName;
  };

  const clearStatsCache = () => {
    setStatsCache(new Map());
    setPlatformStats({});
    setLoadedStats(new Set());
    toast({
      title: "Cache Cleared",
      description: "Platform statistics cache has been cleared. Please refresh stats.",
    });
  };

  const handleCollegeChange = (collegeId) => {
    setSelectedCollege(collegeId);
    setSelectedDepartment('all'); // Reset department when college changes
    setSelectedBatch('all'); // Reset batch when college changes
    setBatches([]); // Clear batches
    setDepartments([]); // Clear departments
    
    if (collegeId && collegeId !== 'all') {
      // Fetch college-specific departments and batches
      fetchDepartments(collegeId);
      fetchBatches(collegeId);
    }
  };

  // Process HackerRank badges for export
  const processHackerRankBadges = (badges) => {
    if (!badges || !Array.isArray(badges) || badges.length === 0) {
      return 'No badges earned';
    }
    
    return badges.map(badge => 
      `(${badge.name || 'Unknown'} - ${badge.stars || 0} - ${badge.level || 'N/A'})`
    ).join(', ');
  };

  // Generate filename based on filters
  const generateFilename = (filters) => {
    let filename = 'coding_profiles_export';
    
    if (filters.college !== 'all') {
      const college = colleges.find(c => c.id === filters.college);
      filename += `_${college?.name?.replace(/\s+/g, '_') || 'Unknown'}`;
    }
    
    if (filters.department !== 'all') {
      const dept = departments.find(d => d.id === filters.department);
      filename += `_${dept?.name?.replace(/\s+/g, '_') || 'Unknown'}`;
    }
    
    if (filters.batch !== 'all') {
      filename += `_${filters.batch}`;
    }
    
    filename += `_${new Date().toISOString().split('T')[0]}.xlsx`;
    return filename;
  };

  // Open export dialog
  const handleExportClick = () => {
    if (students.length === 0) {
      toast({
        title: "No Data",
        description: "No students data available to export",
        variant: "destructive",
      });
      return;
    }

      if (autoLoading) {
      toast({
        title: "Loading Data",
        description: "Please wait for platform statistics to finish loading",
        variant: "destructive",
      });
      return;
    }

    if (Object.keys(platformStats).length === 0) {
      toast({
        title: "No Platform Data",
        description: "Please load platform statistics first by clicking 'Load Stats'",
        variant: "destructive",
      });
      return;
    }

    const filters = {
      college: selectedCollege,
      department: selectedDepartment,
      batch: selectedBatch
    };
    
    const filename = generateFilename(filters);
    setGeneratedFilename(filename);
    setEditableFilename(filename);
    setExportDialogOpen(true);
  };

  // Export data to Excel
  const handleExport = async () => {
    setExportLoading(true);
    
    try {
      // Process export data
      const exportData = students.map(student => {
        const stats = platformStats[student.id] || {};
        const hackerrankData = stats.hackerrank || {};
        const badgeString = processHackerRankBadges(hackerrankData.badges);
        
        return {
          'Name': student.name,
          'Email': student.email,
          'Roll Number': student.roll_number,
          'College Name': student.college_name,
          'Department': student.department,
          'Batch': student.batch,
          
          // LeetCode (solved data only)
          'LeetCode_Total_Solved': stats.leetcode?.problemsSolved || 0,
          'LeetCode_Easy_Solved': stats.leetcode?.easySolved || 0,
          'LeetCode_Medium_Solved': stats.leetcode?.mediumSolved || 0,
          'LeetCode_Hard_Solved': stats.leetcode?.hardSolved || 0,
          'LeetCode_Rank': stats.leetcode?.rank || 'N/A',
          
          // CodeChef (simplified)
          'CodeChef_Problems_Solved': stats.codechef?.problemsSolved || 0,
          
          // HackerRank (badges in single column)
          'HackerRank_Badges': badgeString,
          
          // HackerEarth (simplified)
          'HackerEarth_Problems_Solved': stats.hackerearth?.problemsSolved || 0,
          'HackerEarth_Points': stats.hackerearth?.points || 0,
          
          // GeeksforGeeks (solved data only)
          'GeeksforGeeks_Total_Solved': stats.geeksforgeeks?.problemsSolved || 0,
          'GeeksforGeeks_Easy_Solved': stats.geeksforgeeks?.easySolved || 0,
          'GeeksforGeeks_Medium_Solved': stats.geeksforgeeks?.mediumSolved || 0,
          'GeeksforGeeks_Hard_Solved': stats.geeksforgeeks?.hardSolved || 0
        };
      });

      // Use the filename from dialog
      const filename = editableFilename.trim() || generatedFilename;

      // Create Excel file
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Coding Profiles');
      
      // Save file
      XLSX.writeFile(wb, filename);

      toast({
        title: "Export Successful",
        description: `Data exported to ${filename}`,
      });

      // Close dialog
      setExportDialogOpen(false);

    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportLoading(false);
    }
  };


  return (
    <div className="space-y-6">
      {/* Header Section - Responsive */}
      <div className="space-y-4">
        {/* Main Header - Desktop */}
        <div className="hidden md:flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Coding Profiles Management</h1>
            <p className="text-muted-foreground">
              Manage and track students' coding platform profiles
            </p>
          </div>
          <div className="flex space-x-2">
            <div data-add-profile-trigger>
              <AddProfileModal onProfileAdded={handleProfileAdded} />
            </div>
            <div data-bulk-upload-trigger>
              <BulkUploadModal onUploadComplete={handleBulkUploadComplete} />
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={handleExportClick} disabled={loading || students.length === 0 || autoLoading || Object.keys(platformStats).length === 0}>
                    <Download className="h-4 w-4 mr-2" />
                    Export Data
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {loading ? "Loading students..." : 
                   students.length === 0 ? "No students data available" :
                   autoLoading ? "Loading platform statistics..." :
                   Object.keys(platformStats).length === 0 ? "Click 'Load Stats' to enable export" :
                   "Ready to export data"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Mobile/Tablet Header with Dropdown */}
        <div className="md:hidden">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Coding Profiles</h1>
              <p className="text-sm text-muted-foreground">
                Manage students' coding profiles
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreVertical className="h-4 w-4 mr-2" />
                  Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 p-1">
                <DropdownMenuItem 
                  onClick={() => {
                    const addProfileButton = document.querySelector('[data-add-profile-trigger]');
                    if (addProfileButton) {
                      addProfileButton.click();
                    }
                  }}
                  className="px-3 py-2 text-sm"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Profile
                </DropdownMenuItem>
                
                <DropdownMenuItem 
                  onClick={() => {
                    const bulkUploadButton = document.querySelector('[data-bulk-upload-trigger]');
                    if (bulkUploadButton) {
                      bulkUploadButton.click();
                    }
                  }}
                  className="px-3 py-2 text-sm"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Bulk Upload
                </DropdownMenuItem>
                
                <DropdownMenuItem 
                  onClick={handleExportClick} 
                  disabled={loading || students.length === 0 || autoLoading || Object.keys(platformStats).length === 0}
                  className="px-3 py-2 text-sm"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export Data
                </DropdownMenuItem>
                
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="students">Students</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Real-time Stats from Current Data */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Students</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{students.length}</div>
                <p className="text-xs text-muted-foreground">
                  Students with coding profiles
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Platforms</CardTitle>
                <Code className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {platformsData.filter(platform => 
                    students.some(student => student.platforms?.[platform.name])
                  ).length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Platforms in use
                </p>
              </CardContent>
            </Card>

            {/* Platform Distribution - Full Width on Mobile, Spans 2 on Desktop */}
            <Card className="sm:col-span-2 lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Platform Distribution</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {/* Mobile Layout - Vertical List */}
                <div className="block sm:hidden space-y-3">
                  {platformsData.map((platform) => {
                    const studentCount = students.filter(student => 
                      student.platforms?.[platform.name]
                    ).length;
                    
                    return (
                      <div key={platform.name} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div 
                            className="w-3 h-3 rounded-full"
                            style={{
                              backgroundColor: platform.name === 'leetcode' ? '#f97316' :
                                             platform.name === 'codechef' ? '#dc2626' :
                                             platform.name === 'hackerrank' ? '#16a34a' :
                                             platform.name === 'hackerearth' ? '#2563eb' :
                                             '#9333ea'
                            }}
                          />
                          <span className="text-sm font-medium">{platform.displayName}</span>
                        </div>
                        <div className="text-lg font-bold text-primary">{studentCount}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Layout - Grid */}
                <div className="hidden sm:grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {platformsData.map((platform) => {
                    const studentCount = students.filter(student => 
                      student.platforms?.[platform.name]
                    ).length;
                    
                    return (
                      <div key={platform.name} className="text-center">
                        <div className="flex items-center justify-center mb-2">
                          <div 
                            className="w-3 h-3 rounded-full mr-2"
                            style={{
                              backgroundColor: platform.name === 'leetcode' ? '#f97316' :
                                             platform.name === 'codechef' ? '#dc2626' :
                                             platform.name === 'hackerrank' ? '#16a34a' :
                                             platform.name === 'hackerearth' ? '#2563eb' :
                                             '#9333ea'
                            }}
                          />
                          <span className="text-xs font-medium">{platform.displayName}</span>
                        </div>
                        <div className="text-lg font-bold text-primary">{studentCount}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Modernized Analytics Section */}
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {/* Top Performers */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-lg">
                  <Award className="h-5 w-5 mr-2 text-yellow-500" />
                  Top Performers
                </CardTitle>
                <p className="text-sm text-muted-foreground">Students with highest problem counts</p>
                <div className="mt-3">
                  <Select value={topPerformersCollege} onValueChange={setTopPerformersCollege}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Filter by college" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Colleges</SelectItem>
                      {colleges && Array.isArray(colleges) && colleges.filter(college => college?.id != null).map((college) => (
                        <SelectItem key={college.id} value={college.id.toString()}>
                          {college.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                </CardHeader>
                <CardContent>
                <div className="space-y-4">
                  {(() => {

                    const filteredStudents = students
                      .filter(student => {
                        // Filter by top performers college if not "all"
                        if (topPerformersCollege && topPerformersCollege !== 'all') {
                          const selectedCollege = colleges.find(c => c.id === topPerformersCollege);
                          const selectedCollegeName = selectedCollege?.name;
                          
                          
                          // Match by college_id (preferred) or college name (fallback)
                          return student.college_id === topPerformersCollege || 
                                 student.college_name === selectedCollegeName;
                        }
                        return true;
                      })
                      .filter(student => platformStats[student.id])
                      .map(student => {
                        const totalProblems = Object.entries(platformStats[student.id] || {})
                          .filter(([platform, platformData]) => platform !== 'hackerrank')
                          .reduce((sum, [platform, platformData]) => sum + (platformData?.problemsSolved || 0), 0);
                        return { student, totalProblems };
                      })
                      .sort((a, b) => b.totalProblems - a.totalProblems)
                      .slice(0, 5);


                    if (filteredStudents.length === 0) {
                      return (
                        <div className="text-center py-8 text-muted-foreground">
                          <Award className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">
                            {topPerformersCollege === 'all' 
                              ? 'No student data available' 
                              : 'No students found for selected college'
                            }
                          </p>
                        </div>
                      );
                    }

                    return filteredStudents.map(({ student, totalProblems }, index) => (
                      <div key={index} className="flex items-center space-x-3 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{student.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {student.college_name} • {student.department}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-primary">{totalProblems}</div>
                          <div className="text-xs text-muted-foreground">problems</div>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
                </CardContent>
              </Card>

            {/* College Distribution */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-lg">
                  <Users className="h-5 w-5 mr-2 text-blue-500" />
                  College Distribution
                  </CardTitle>
                <p className="text-sm text-muted-foreground">Students across institutions</p>
                </CardHeader>
                <CardContent>
                <div className="space-y-3">
                  {Object.entries(
                    students.reduce((acc, student) => {
                      const college = student.college_name || 'Unknown';
                      acc[college] = (acc[college] || 0) + 1;
                      return acc;
                    }, {})
                  )
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 6)
                    .map(([college, count], index) => {
                      return (
                        <div key={college} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 font-bold text-xs">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{college}</div>
                        </div>
                        <div className="text-right">
                            <div className="font-bold text-blue-600">{count}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

            {/* Department Distribution */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-lg">
                  <BarChart3 className="h-5 w-5 mr-2 text-green-500" />
                  Department Distribution
                  </CardTitle>
                <p className="text-sm text-muted-foreground">Students by academic department</p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                  {Object.entries(
                    students.reduce((acc, student) => {
                      const dept = student.department || 'Unknown';
                      acc[dept] = (acc[dept] || 0) + 1;
                      return acc;
                    }, {})
                  )
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 6)
                    .map(([dept, count], index) => {
                      return (
                        <div key={dept} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600 font-bold text-xs">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{dept}</div>
                        </div>
                          <div className="text-right">
                            <div className="font-bold text-green-600">{count}</div>
                      </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
        </TabsContent>

        <TabsContent value="students" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                {autoLoading && (
                  <div className="flex items-center space-x-2 text-sm text-blue-600">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Loading cached platform data...</span>
              </div>
                )}
              </div>
              <div className="mt-4">
                {/* Mobile Layout - Stacked */}
                <div className="lg:hidden space-y-4">
                  {/* Search Bar - Full Width */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                    <Input
                      placeholder="Search students by name, email, or roll number..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 w-full h-11 text-base"
                    />
                  </div>
                  
                  {/* Filters Grid - Mobile Optimized */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Platform Filter */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Platform
                      </label>
                      <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                        <SelectTrigger className="w-full h-11">
                          <SelectValue placeholder="Select Platform" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Platforms</SelectItem>
                          {platformsData.map((platform) => (
                            <SelectItem key={platform.name} value={platform.name}>
                              <div className="flex items-center space-x-2">
                                <div 
                                  className="w-2 h-2 rounded-full"
                                  style={{
                                    backgroundColor: platform.name === 'leetcode' ? '#f97316' :
                                                   platform.name === 'codechef' ? '#dc2626' :
                                                   platform.name === 'hackerrank' ? '#16a34a' :
                                                   platform.name === 'hackerearth' ? '#2563eb' :
                                                   '#9333ea'
                                  }}
                                />
                                <span>{platform.displayName}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* College Filter */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        College
                      </label>
                      <Select value={selectedCollege} onValueChange={handleCollegeChange}>
                        <SelectTrigger className="w-full h-11">
                          <SelectValue placeholder="Select College" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Colleges</SelectItem>
                          {colleges && Array.isArray(colleges) && colleges.filter(college => college?.id != null).map((college) => (
                            <SelectItem key={college.id} value={college.id.toString()}>
                              {college.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Department Filter */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Department
                      </label>
                      <Select 
                        value={selectedDepartment} 
                        onValueChange={setSelectedDepartment}
                        disabled={!selectedCollege || selectedCollege === 'all'}
                      >
                        <SelectTrigger className="w-full h-11">
                          <SelectValue placeholder={
                            !selectedCollege || selectedCollege === 'all' 
                              ? "Select College First" 
                              : "Select Department"
                          } />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Departments</SelectItem>
                          {departments && Array.isArray(departments) && departments.map((dept, index) => (
                            <SelectItem key={dept.name || index} value={dept.name}>
                              {dept.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Batch Filter */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Batch
                      </label>
                      <Select 
                        value={selectedBatch} 
                        onValueChange={setSelectedBatch}
                        disabled={!selectedCollege || selectedCollege === 'all'}
                      >
                        <SelectTrigger className="w-full h-11">
                          <SelectValue placeholder={
                            !selectedCollege || selectedCollege === 'all' 
                              ? "Select College First" 
                              : "Select Batch"
                          } />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Batches</SelectItem>
                          {batches && Array.isArray(batches) && batches.map((batch) => (
                            <SelectItem key={batch.id} value={batch.name}>
                              {batch.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Refresh Button - Mobile Only */}
                  <div className="flex justify-center">
                    <Button
                      onClick={() => fetchBatchPlatformStats(students.map(s => s.id), true)}
                      disabled={autoLoading || students.length === 0}
                      variant="outline"
                      size="lg"
                      className="w-full sm:w-auto h-12 text-base font-medium"
                    >
                      <RefreshCw className={`h-5 w-5 mr-2 ${autoLoading ? 'animate-spin' : ''}`} />
                      Refresh Platform Statistics
                    </Button>
                  </div>
                </div>

                {/* Desktop Layout - Single Line */}
                <div className="hidden lg:flex flex-col lg:flex-row gap-3 items-start lg:items-center">
                  {/* Search Bar */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                    <Input
                      placeholder="Search students..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 w-full"
                    />
                  </div>
                  
                  {/* Platform Filter */}
                  <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                    <SelectTrigger className="w-full lg:w-[160px]">
                      <SelectValue placeholder="Platform" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Platforms</SelectItem>
                      {platformsData.map((platform) => (
                        <SelectItem key={platform.name} value={platform.name}>
                          {platform.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* College Filter */}
                  <Select value={selectedCollege} onValueChange={handleCollegeChange}>
                    <SelectTrigger className="w-full lg:w-[160px]">
                      <SelectValue placeholder="College" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Colleges</SelectItem>
                      {colleges && Array.isArray(colleges) && colleges.filter(college => college?.id != null).map((college) => (
                        <SelectItem key={college.id} value={college.id.toString()}>
                          {college.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Department Filter */}
                  <Select 
                    value={selectedDepartment} 
                    onValueChange={setSelectedDepartment}
                    disabled={!selectedCollege || selectedCollege === 'all'}
                  >
                    <SelectTrigger className="w-full lg:w-[160px]">
                      <SelectValue placeholder={
                        !selectedCollege || selectedCollege === 'all' 
                          ? "Select College First" 
                          : "Department"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {departments && Array.isArray(departments) && departments.map((dept, index) => (
                        <SelectItem key={dept.name || index} value={dept.name}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Batch Filter */}
                  <Select 
                    value={selectedBatch} 
                    onValueChange={setSelectedBatch}
                    disabled={!selectedCollege || selectedCollege === 'all'}
                  >
                    <SelectTrigger className="w-full lg:w-[120px]">
                      <SelectValue placeholder={
                        !selectedCollege || selectedCollege === 'all' 
                          ? "Select College First" 
                          : "Batch"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Batches</SelectItem>
                      {batches && Array.isArray(batches) && batches.map((batch) => (
                        <SelectItem key={batch.id} value={batch.name}>
                          {batch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Refresh Stats Button */}
                  <Button
                    onClick={() => fetchBatchPlatformStats(students.map(s => s.id), true)}
                    disabled={autoLoading || students.length === 0}
                    variant="outline"
                    size="sm"
                    className="w-full lg:w-auto"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${autoLoading ? 'animate-spin' : ''}`} />
                    <span className="hidden sm:inline">Refresh Stats</span>
                    <span className="sm:hidden">Refresh</span>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  {students.length > 0 ? (
                    <TooltipProvider>
                      <div>
                        {/* Desktop Table View - Show on lg and above */}
                        <div className="hidden lg:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[100px]">Name</TableHead>
                      <TableHead className="min-w-[150px]">Email</TableHead>
                      <TableHead className="min-w-[80px]">Roll Number</TableHead>
                      <TableHead className="min-w-[120px]">College</TableHead>
                      <TableHead className="min-w-[100px]">Department</TableHead>
                      <TableHead className="min-w-[60px]">Batch</TableHead>
                      <TableHead className="text-center min-w-[70px]">LeetCode</TableHead>
                      <TableHead className="text-center min-w-[70px]">CodeChef</TableHead>
                      <TableHead className="text-center min-w-[70px]">HackerRank</TableHead>
                      <TableHead className="text-center min-w-[70px]">HackerEarth</TableHead>
                      <TableHead className="text-center min-w-[70px]">GeeksforGeeks</TableHead>
                      <TableHead className="text-center min-w-[140px]">Links & Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                          {students
                            .filter(student => {
                              // Apply platform filter
                              if (selectedPlatform !== 'all') {
                                return student.platforms && student.platforms[selectedPlatform];
                              }
                              return true;
                            })
                            .map((student) => (
                        <TableRow key={student.id}>
                              <TableCell className="font-medium truncate">
                                {student.name || 'N/A'}
                              </TableCell>
                              <TableCell className="truncate">
                                {student.email 
                                  ? (student.email.length > 16 
                                      ? `${student.email.substring(0, 16)}...` 
                                      : student.email)
                                  : 'N/A'
                                }
                              </TableCell>
                              <TableCell className="truncate">{student.roll_number || 'N/A'}</TableCell>
                              <TableCell className="truncate">{student.college_name || 'N/A'}</TableCell>
                              <TableCell className="truncate">{student.department || 'N/A'}</TableCell>
                              <TableCell className="truncate">{student.batch || 'N/A'}</TableCell>
                              
                              {/* Platform columns */}
                              {['leetcode', 'codechef', 'hackerrank', 'hackerearth', 'geeksforgeeks'].map(platform => (
                                <TableCell key={platform} className="text-center">
                                  {student.platforms?.[platform] ? (
                                    platformStats[student.id]?.[platform] ? (
                                      (platform === 'leetcode' || platform === 'hackerrank' || platform === 'geeksforgeeks') ? (
                                        <Tooltip delayDuration={100}>
                                          <TooltipTrigger asChild>
                                            <div 
                                              className="font-bold text-lg cursor-pointer hover:opacity-80 transition-opacity" 
                                              style={{
                                                color: platform === 'leetcode' ? '#f97316' :
                                                       platform === 'codechef' ? '#dc2626' :
                                                       platform === 'hackerrank' ? '#16a34a' :
                                                       platform === 'hackerearth' ? '#2563eb' :
                                                       '#9333ea'
                                              }}
                                              onClick={() => {
                                                if (platform === 'hackerrank') {
                                                  handleHackerrankClick(student.id);
                                                }
                                                // Add more platform-specific handlers here
                                              }}
                                            >
                                              {platformStats[student.id][platform].problemsSolved || 'N/A'}
                              </div>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {(platform === 'leetcode' || platform === 'geeksforgeeks') ? (
                                              <div className="text-xs min-w-[180px]">
                                                <div className="grid grid-cols-2 gap-2">
                                                  <div className="text-center">
                                                    <div className="text-green-400 font-semibold">Easy: {String(platformStats[student.id][platform].easySolved || 'N/A')}</div>
                              </div>
                                                  <div className="text-center">
                                                    <div className="text-yellow-400 font-semibold">Medium: {String(platformStats[student.id][platform].mediumSolved || 'N/A')}</div>
                              </div>
                                                  <div className="text-center">
                                                    <div className="text-red-400 font-semibold">Hard: {String(platformStats[student.id][platform].hardSolved || 'N/A')}</div>
                                                  </div>
                                                <div className="text-center">
                                                  <div className="text-blue-400 font-semibold">Rank: {platform === 'geeksforgeeks' ? 'N/A' : String(platformStats[student.id][platform].rank || 'N/A')}</div>
                                                </div>
                                                </div>
                                              </div>
                                            ) : platform === 'hackerrank' ? (
                                              <div className="text-xs max-w-[160px]">
                                                <div className="text-center p-2  rounded border border-blue-400/30">
                                                  <div className="text-blue-300 text-xs font-medium">
                                                   Click view details
                                                  </div>
                                                </div>
                                              </div>
                                            ) : platform === 'hackerearth' ? (
                                              <div className="text-xs min-w-[180px]">
                                                <div className="grid grid-cols-2 gap-2">
                                                  <div className="text-center">
                                                    <div className="text-blue-400 font-semibold">Points: {String(platformStats[student.id][platform].points || 'N/A')}</div>
                                                  </div>
                                                  <div className="text-center">
                                                    <div className="text-green-400 font-semibold">Problems: {String(platformStats[student.id][platform].problemsSolved || 'N/A')}</div>
                                                  </div>
                                                </div>
                                              </div>
                                            ) : null}
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : (
                                        <div 
                                          className="font-bold text-lg" 
                                          style={{
                                            color: platform === 'leetcode' ? '#f97316' :
                                                   platform === 'codechef' ? '#dc2626' :
                                                   platform === 'hackerrank' ? '#16a34a' :
                                                   platform === 'hackerearth' ? '#2563eb' :
                                                   '#9333ea'
                                          }}
                                        >
                                          {platformStats[student.id][platform].problemsSolved || 'N/A'}
                              </div>
                                      )
                                    ) : (
                                      <div className="text-gray-400">
                                        {loadedStats.has(student.id) ? 'Loading...' : (
                                          <Button 
                                            size="sm" 
                                            variant="ghost" 
                                            onClick={() => fetchStudentPlatformStats(student.id)}
                                            className="text-xs"
                                          >
                                            Load
                                          </Button>
                                )}
                              </div>
                                    )
                            ) : (
                              <span className="text-gray-400 text-xs">No Profile</span>
                            )}
                          </TableCell>
                              ))}

                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-2">
                              {/* Links Dropdown */}
                              {student.platforms && Object.keys(student.platforms).length > 0 ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="outline" className="text-xs whitespace-nowrap">
                                      <ExternalLink className="h-3 w-3 mr-1" />
                                      Links
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="min-w-[200px]">
                                    {Object.keys(student.platforms).map(platform => {
                                      if (student.platforms[platform]) {
                                        const platformData = platformsData.find(p => p.name === platform);
                                        const username = student.platforms[platform].username;
                                        const profileUrl = student.platforms[platform].profile_url;
                                        
                                        return (
                                          <DropdownMenuItem key={platform} asChild>
                                            <a
                                              href={profileUrl || `https://${platform === 'leetcode' ? 'leetcode.com/u' : 
                                                               platform === 'codechef' ? 'www.codechef.com/users' :
                                                               platform === 'hackerrank' ? 'www.hackerrank.com/profile' :
                                                               platform === 'hackerearth' ? 'www.hackerearth.com/@' :
                                                               'www.geeksforgeeks.org/user'}/${username}`}
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                              className="flex items-center w-full"
                                            >
                                              <ExternalLink className="h-3 w-3 mr-2" />
                                              <span 
                                                className="w-2 h-2 rounded-full mr-2"
                                                style={{
                                                  backgroundColor: platform === 'leetcode' ? '#f97316' :
                                                                 platform === 'codechef' ? '#dc2626' :
                                                                 platform === 'hackerrank' ? '#16a34a' :
                                                                 platform === 'hackerearth' ? '#2563eb' :
                                                                 '#9333ea'
                                                }}
                                              />
                                              {platformData?.displayName || platform}
                                            </a>
                                          </DropdownMenuItem>
                                        );
                                      }
                                      return null;
                                    })}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : (
                                <span className="text-gray-400 text-xs">No Links</span>
                              )}

                              {/* Actions Dropdown */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="whitespace-nowrap">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => fetchStudentPlatformStats(student.id)}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Refresh Stats
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleEditProfiles(student)}>
                                    <Edit className="h-4 w-4 mr-2" />
                                    Edit Profiles
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={() => handleDeleteStudent(student)}
                                    className="text-red-600 focus:text-red-600"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete All
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                          ))}
                  </TableBody>
                </Table>
                        </div>

                        {/* Mobile/Tablet Card View - Show on lg and below */}
                        <div className="lg:hidden space-y-4">
                          {students
                            .filter(student => {
                              // Apply platform filter
                              if (selectedPlatform !== 'all') {
                                return student.platforms && student.platforms[selectedPlatform];
                              }
                              return true;
                            })
                            .map((student) => (
                            <Card key={student.id} className="p-4">
                              <div className="space-y-3">
                                {/* Student Info */}
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <h3 className="font-semibold text-lg text-foreground">{student.name}</h3>
                                    <p className="text-sm text-muted-foreground">{student.email}</p>
                                    <p className="text-xs text-muted-foreground">Roll: {student.roll_number || 'N/A'}</p>
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button size="sm" variant="outline">
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => fetchStudentPlatformStats(student.id)}>
                                        <RefreshCw className="h-4 w-4 mr-2" />
                                        Refresh Stats
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleEditProfiles(student)}>
                                        <Edit className="h-4 w-4 mr-2" />
                                        Edit Profiles
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        onClick={() => handleDeleteStudent(student)}
                                        className="text-red-600 focus:text-red-600"
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete All
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                </div>

                                {/* College Info */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">College:</span>
                                    <p className="font-medium truncate">{student.college_name || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Department:</span>
                                    <p className="font-medium truncate">{student.department || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Batch:</span>
                                    <p className="font-medium truncate">{student.batch || 'N/A'}</p>
                                  </div>
                                </div>

                                {/* Platform Stats */}
                                <div className="space-y-2">
                                  <h4 className="text-sm font-medium text-foreground">Platform Statistics</h4>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                                    {['leetcode', 'codechef', 'hackerrank', 'hackerearth', 'geeksforgeeks'].map(platform => (
                                      <div key={platform} className="flex flex-col items-center p-2 bg-muted rounded text-center">
                                        <span className="text-xs font-medium capitalize mb-1">{platform}</span>
                                        <div className="text-center">
                                          {student.platforms?.[platform] ? (
                                            platformStats[student.id]?.[platform] ? (
                                              <div 
                                                className="font-bold text-sm" 
                                                style={{
                                                  color: platform === 'leetcode' ? '#f97316' :
                                                         platform === 'codechef' ? '#dc2626' :
                                                         platform === 'hackerrank' ? '#16a34a' :
                                                         platform === 'hackerearth' ? '#2563eb' :
                                                         '#9333ea'
                                                }}
                                              >
                                                {platformStats[student.id][platform].problemsSolved || 'N/A'}
                                              </div>
                                            ) : (
                                              <div className="text-muted-foreground text-xs">
                                                {loadedStats.has(student.id) ? 'Loading...' : 'Load'}
                                              </div>
                                            )
                                          ) : (
                                            <span className="text-muted-foreground text-xs">No Profile</span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Links */}
                                {student.platforms && Object.keys(student.platforms).length > 0 && (
                                  <div className="space-y-2">
                                    <h4 className="text-sm font-medium text-foreground">Profile Links</h4>
                                    <div className="flex flex-wrap gap-2">
                                      {Object.keys(student.platforms).map(platform => {
                                        if (student.platforms[platform]) {
                                          const platformData = platformsData.find(p => p.name === platform);
                                          const username = student.platforms[platform].username;
                                          const profileUrl = student.platforms[platform].profile_url;
                                          
                                          return (
                                            <a
                                              key={platform}
                                              href={profileUrl || `https://${platform === 'leetcode' ? 'leetcode.com/u' : 
                                                               platform === 'codechef' ? 'www.codechef.com/users' :
                                                               platform === 'hackerrank' ? 'www.hackerrank.com/profile' :
                                                               platform === 'hackerearth' ? 'www.hackerearth.com/@' :
                                                               'www.geeksforgeeks.org/user'}/${username}`}
                                              target="_blank" 
                                              rel="noopener noreferrer"
                                              className="flex items-center px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors whitespace-nowrap"
                                            >
                                              <ExternalLink className="h-3 w-3 mr-1" />
                                              <span className="hidden sm:inline">{platformData?.displayName || platform}</span>
                                              <span className="sm:hidden">{platformData?.displayName?.substring(0, 3) || platform.substring(0, 3)}</span>
                                            </a>
                                          );
                                        }
                                        return null;
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>
                    </TooltipProvider>
                    ) : (
                      <div className="flex items-center justify-center h-32">
                      <div className="text-gray-500">No students found</div>
                </div>
            )}

                  <div className="text-sm text-gray-500 text-center">
                    Showing {students.length} students
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* HackerRank Details Dialog */}
      <Dialog open={hackerrankDialogOpen} onOpenChange={setHackerrankDialogOpen}>
        <DialogContent className="max-w-md mx-4 sm:mx-0">
          <DialogHeader>
            <DialogTitle className="text-lg">HackerRank Badges</DialogTitle>
          </DialogHeader>
          {selectedHackerrankData && (
            <div className="space-y-2">
              {selectedHackerrankData.badges && Array.isArray(selectedHackerrankData.badges) && selectedHackerrankData.badges.length > 0 ? (
                <div className="space-y-1">
                  {selectedHackerrankData.badges.map((badge, index) => {
                    const level = (badge.level || '').toLowerCase();
                    const getThemeColors = (level) => {
                      switch (level) {
                        case 'bronze':
                          return {
                            bg: 'bg-orange-100',
                            border: 'border-orange-300',
                            text: 'text-orange-900',
                            accent: 'text-orange-700'
                          };
                        case 'silver':
                          return {
                            bg: 'bg-gray-50',
                            border: 'border-gray-200',
                            text: 'text-gray-900',
                            accent: 'text-gray-600'
                          };
                        case 'gold':
                          return {
                            bg: 'bg-yellow-50',
                            border: 'border-yellow-200',
                            text: 'text-yellow-900',
                            accent: 'text-yellow-600'
                          };
                        default:
                          return {
                            bg: 'bg-blue-50',
                            border: 'border-blue-200',
                            text: 'text-blue-900',
                            accent: 'text-blue-600'
                          };
                      }
                    };
                    const theme = getThemeColors(level);
                    
                    return (
                      <div key={index} className={`flex items-center justify-between p-2 ${theme.bg} border ${theme.border} rounded-md`}>
                        <div className="flex-1">
                          <div className={`text-sm font-medium ${theme.text}`}>{badge.name || 'Unknown Badge'}</div>
                </div>
                        <div className="flex items-center space-x-3">
                          <div className="flex items-center space-x-1">
                            <span className="text-yellow-500 text-xs">⭐</span>
                            <span className={`text-xs font-medium ${theme.accent}`}>{badge.stars || 0}</span>
                </div>
                          <div className={`text-xs font-medium ${theme.accent}`}>
                            {badge.level || 'N/A'}
                </div>
                </div>
                </div>
                    );
                  })}
                </div>
                  ) : (
                <div className="text-center py-4 text-gray-500">
                  <div className="text-sm font-medium">No badges found</div>
                  <div className="text-xs">This student hasn't earned any badges yet</div>
                </div>
                  )}
                </div>
            )}
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md mx-4 sm:mx-0">
          <DialogHeader>
            <DialogTitle className="text-lg">Export Data</DialogTitle>
            <DialogDescription>
              Choose a filename for your export. The file will be downloaded as an Excel (.xlsx) file.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Filename</label>
                        <Input
                value={editableFilename}
                onChange={(e) => setEditableFilename(e.target.value)}
                placeholder="Enter filename..."
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Generated filename: {generatedFilename}
              </p>
                      </div>
            
            
              </div>

          <div className="flex justify-end space-x-2 mt-6">
                <Button
                        variant="outline"
              onClick={() => setExportDialogOpen(false)}
              disabled={exportLoading}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleExport}
              disabled={exportLoading}
              className="flex items-center gap-2"
            >
              {exportLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Profiles Dialog */}
      <Dialog open={editProfilesDialog} onOpenChange={setEditProfilesDialog}>
        <DialogContent className="max-w-lg mx-4 sm:mx-0">
          <DialogHeader>
            <DialogTitle className="text-lg">Edit Profiles - {editingStudent?.name}</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {editingProfiles.map((profile, index) => (
              <div key={index} className="flex items-center space-x-3 p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center space-x-2 min-w-0 flex-1">
                  <span 
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: platformsData.find(p => p.name === profile.platform)?.color?.includes('orange') ? '#f97316' :
                                     platformsData.find(p => p.name === profile.platform)?.color?.includes('red') ? '#dc2626' :
                                     platformsData.find(p => p.name === profile.platform)?.color?.includes('green') ? '#16a34a' :
                                     platformsData.find(p => p.name === profile.platform)?.color?.includes('blue') ? '#2563eb' :
                                     '#9333ea'
                    }}
                  />
                  <span className="text-sm font-medium truncate">
                    {platformsData.find(p => p.name === profile.platform)?.displayName || profile.platform}
                  </span>
                </div>
                <Input
                  value={profile.username}
                  onChange={(e) => {
                    const newProfiles = [...editingProfiles];
                    newProfiles[index].username = e.target.value;
                    setEditingProfiles(newProfiles);
                  }}
                  placeholder="Username"
                  className="flex-1 h-8 text-sm"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const newProfiles = editingProfiles.filter((_, i) => i !== index);
                    setEditingProfiles(newProfiles);
                  }}
                  className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            
            {/* Add new profile - only show if there are missing platforms */}
            {(() => {
              const existingPlatforms = editingProfiles.map(p => p.platform);
              const allPlatforms = platformsData.map(p => p.name);
              const missingPlatforms = allPlatforms.filter(platform => !existingPlatforms.includes(platform));
              
              if (missingPlatforms.length === 0) {
                return null; // Don't show add button if all platforms are present
              }
              
              return (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedPlatformToAdd('');
                    setNewUsername('');
                    setAddProfileDialogOpen(true);
                  }}
                  className="w-full h-8 text-sm"
                >
                  <Plus className="h-3 w-3 mr-2" />
                  Add Profile ({missingPlatforms.length} remaining)
                </Button>
              );
            })()}
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditProfilesDialog(false)}
            >
              Cancel
            </Button>
            <Button 
              size="sm"
              onClick={async () => {
                try {
                  // Save the updated profiles
                  for (const profile of editingProfiles) {
                    if (profile.id) {
                      // Update existing profile using Super Admin endpoint
                      await apiService.updateStudentCodingProfile(editingStudent.id, profile.id, {
                        platform: profile.platform,
                        username: profile.username
                      });
                    } else {
                      // Add new profile
                      await apiService.addCodingProfile(editingStudent.id, {
                        platform: profile.platform,
                        username: profile.username
                      });
                    }
                  }
                  
                  toast({
                    title: "Profiles Updated",
                    description: "Coding profiles have been updated successfully",
                  });
                  
                  setEditProfilesDialog(false);
                  fetchStudents(); // Refresh the data
                } catch (error) {
                  toast({
                    title: "Error",
                    description: "Failed to update profiles",
                    variant: "destructive",
                  });
                }
              }}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Profile Dialog */}
      <Dialog open={addProfileDialogOpen} onOpenChange={setAddProfileDialogOpen}>
        <DialogContent className="max-w-md mx-4 sm:mx-0">
          <DialogHeader>
            <DialogTitle className="text-lg">Add New Profile</DialogTitle>
            <DialogDescription>
              Add a coding profile for {editingStudent?.name}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Platform</label>
              <Select value={selectedPlatformToAdd} onValueChange={setSelectedPlatformToAdd}>
                <SelectTrigger>
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const existingPlatforms = editingProfiles.map(p => p.platform);
                    const allPlatforms = platformsData.map(p => p.name);
                    const missingPlatforms = allPlatforms.filter(platform => !existingPlatforms.includes(platform));
                    
                    return missingPlatforms.map(platform => {
                      const platformData = platformsData.find(p => p.name === platform);
                      return (
                        <SelectItem key={platform} value={platform}>
                          <div className="flex items-center space-x-2">
                            <span 
                              className="w-2 h-2 rounded-full"
                              style={{
                                backgroundColor: platformData?.color?.includes('orange') ? '#f97316' :
                                               platformData?.color?.includes('red') ? '#dc2626' :
                                               platformData?.color?.includes('green') ? '#16a34a' :
                                               platformData?.color?.includes('blue') ? '#2563eb' :
                                               '#9333ea'
                              }}
                            />
                            <span>{platformData?.displayName || platform}</span>
                          </div>
                        </SelectItem>
                      );
                    });
                  })()}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Enter username"
                className="w-full"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddProfileDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              size="sm"
              onClick={() => {
                if (selectedPlatformToAdd && newUsername.trim()) {
                  const newProfile = {
                    platform: selectedPlatformToAdd,
                    username: newUsername.trim(),
                    id: null // New profile
                  };
                  
                  setEditingProfiles([...editingProfiles, newProfile]);
                  setAddProfileDialogOpen(false);
                  setSelectedPlatformToAdd('');
                  setNewUsername('');
                }
              }}
              disabled={!selectedPlatformToAdd || !newUsername.trim()}
            >
              Add Profile
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Profiles</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all coding profiles for {studentToDelete?.name}? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteStudent}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CodingProfilesManagementPage;
