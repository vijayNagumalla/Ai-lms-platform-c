import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';
import { 
  Plus, Search, Filter, Edit, Trash, Eye, Copy, Calendar, Clock, 
  Users, Target, BarChart3, Settings, FileText, Code, CheckSquare,
  BookOpen, Database, Globe, Lock, Unlock, Archive, RefreshCw, Shield, Mail,
  Grid3X3, List
} from 'lucide-react';


import apiService from '@/services/api';
import CopyAssessmentDialog from '@/components/CopyAssessmentDialog';

const AssessmentManagementPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDifficulty, setFilterDifficulty] = useState('all');
  const [currentTab, setCurrentTab] = useState('assessments');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' or 'list'

  // Dialog states
  const [showCreateQuestion, setShowCreateQuestion] = useState(false);
  const [selectedAssessment, setSelectedAssessment] = useState(null);

  // Assessment action states
  const [showViewAssessment, setShowViewAssessment] = useState(false);
  const [showDeleteAssessment, setShowDeleteAssessment] = useState(false);
  const [showCopyAssessment, setShowCopyAssessment] = useState(false);
  const [assessmentToDelete, setAssessmentToDelete] = useState(null);
  const [assessmentToView, setAssessmentToView] = useState(null);
  const [assessmentToCopy, setAssessmentToCopy] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Category management states
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showEditCategory, setShowEditCategory] = useState(false);
  const [showDeleteCategory, setShowDeleteCategory] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categorySearchTerm, setCategorySearchTerm] = useState('');
  const [categoryFilterParent, setCategoryFilterParent] = useState('all');

  // Category navigation states
  const [categoryView, setCategoryView] = useState('categories'); // 'categories', 'subcategories', 'questions'
  const [selectedParentCategory, setSelectedParentCategory] = useState(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState(null);
  const [categoryQuestions, setCategoryQuestions] = useState([]);
  const [categoryBreadcrumb, setCategoryBreadcrumb] = useState([]);
  const [questionStatusFilter, setQuestionStatusFilter] = useState('active'); // Filter for questions view





  const [questionForm, setQuestionForm] = useState({
    title: '',
    content: '',
    question_type: 'multiple_choice',
    difficulty_level: 'medium',
    points: 10,
    category_id: '',
    tags: [],
    options: ['', '', '', ''],
    correct_answer: [],
    explanation: ''
  });

  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    parent_id: null,
    color: '#3B82F6',
    icon: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  // Reload questions when status filter changes
  useEffect(() => {
    if (categoryView === 'questions' && selectedSubcategory) {
      loadCategoryQuestions(selectedSubcategory.id);
    }
  }, [questionStatusFilter]);



  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load assessments
      console.log('Loading assessments...');
      const assessmentsResponse = await apiService.getAssessmentTemplates();
      console.log('Assessments response:', assessmentsResponse);
      
      if (assessmentsResponse.success) {
        setAssessments(assessmentsResponse.data);
        console.log('Assessments loaded:', assessmentsResponse.data.length);
      } else {
        console.error('Failed to load assessments:', assessmentsResponse.message);
        toast({
          variant: "destructive",
          title: "Error",
          description: `Failed to load assessments: ${assessmentsResponse.message}`
        });
      }

      // Load questions
      const questionsResponse = await apiService.getQuestions();
      if (questionsResponse.success) {
        setQuestions(questionsResponse.data);
      }

      // Load categories
      const categoriesResponse = await apiService.getQuestionCategories();
      if (categoriesResponse.success) {
        setCategories(categoriesResponse.data);
      }

      // Load tags
      const tagsResponse = await apiService.getQuestionTags();
      if (tagsResponse.success) {
        setTags(tagsResponse.data);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: `Failed to load assessment data: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  };





  const handleCreateQuestion = async () => {
    try {
      const response = await apiService.createQuestion(questionForm);
      if (response.success) {
        toast({
          title: "Success",
          description: "Question created successfully"
        });
        setShowCreateQuestion(false);
        setQuestionForm({
          title: '',
          content: '',
          question_type: 'multiple_choice',
          difficulty_level: 'medium',
          points: 10,
          category_id: '',
          tags: [],
          options: ['', '', '', ''],
          correct_answer: [],
          explanation: ''
        });
        loadData();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create question"
      });
    }
  };

  const handleCreateCategory = async () => {
    try {
      // If we're in subcategories view, pre-select the parent category
      const formData = categoryView === 'subcategories' 
        ? { ...categoryForm, parent_id: selectedParentCategory?.id }
        : categoryForm;

      const response = await apiService.createQuestionCategory(formData);
      if (response.success) {
        toast({
          title: "Success",
          description: categoryView === 'subcategories' ? "Subcategory created successfully" : "Category created successfully"
        });
        setShowCreateCategory(false);
        setCategoryForm({
          name: '',
          description: '',
          parent_id: null,
          color: '#3B82F6',
          icon: ''
        });
        loadData();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create category"
      });
    }
  };

  const handleUpdateCategory = async () => {
    try {
      const response = await apiService.updateQuestionCategory(selectedCategory.id, categoryForm);
      if (response.success) {
        toast({
          title: "Success",
          description: "Category updated successfully"
        });
        setShowEditCategory(false);
        setSelectedCategory(null);
        setCategoryForm({
          name: '',
          description: '',
          parent_id: null,
          color: '#3B82F6',
          icon: ''
        });
        loadData();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update category"
      });
    }
  };

  const handleDeleteCategory = async () => {
    try {
      const response = await apiService.deleteQuestionCategory(selectedCategory.id);
      if (response.success) {
        toast({
          title: "Success",
          description: "Category deleted successfully"
        });
        setShowDeleteCategory(false);
        setSelectedCategory(null);
        loadData();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete category"
      });
    }
  };

  const openEditCategory = (category) => {
    setSelectedCategory(category);
    setCategoryForm({
      name: category.name,
      description: category.description || '',
      parent_id: category.parent_id,
      color: category.color || '#3B82F6',
      icon: category.icon || ''
    });
    setShowEditCategory(true);
  };

  const openDeleteCategory = (category) => {
    setSelectedCategory(category);
    setShowDeleteCategory(true);
  };

  const getParentCategories = () => {
    return categories.filter(cat => cat.parent_id === null);
  };

  const getSubcategories = (parentId) => {
    return categories.filter(cat => cat.parent_id === parentId);
  };

  const filteredCategories = categories.filter(category => {
    // FIX: Add null checks to prevent undefined errors
    const categoryName = category?.name || '';
    const categoryDescription = category?.description || '';
    const matchesSearch = categoryName.toLowerCase().includes(categorySearchTerm.toLowerCase()) ||
                         categoryDescription.toLowerCase().includes(categorySearchTerm.toLowerCase());
    const matchesParent = categoryFilterParent === 'all' || 
                         (categoryFilterParent === 'main' && category.parent_id === null) ||
                         (categoryFilterParent === 'sub' && category.parent_id !== null) ||
                         category.parent_id === categoryFilterParent;
    
    // In categories view, only show main categories (no parent_id)
    const isMainCategory = category.parent_id === null;
    
    return matchesSearch && matchesParent && (categoryView === 'categories' ? isMainCategory : true);
  });

  const getAssessmentTypeIcon = (type) => {
    switch (type) {
      case 'quiz': return <CheckSquare className="h-4 w-4" />;
      case 'test': return <FileText className="h-4 w-4" />;
      case 'exam': return <BookOpen className="h-4 w-4" />;
      case 'assignment': return <Code className="h-4 w-4" />;
      case 'coding_challenge': return <Code className="h-4 w-4" />;
      case 'survey': return <BarChart3 className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const getDifficultyColor = (difficulty) => {
    switch (difficulty) {
      case 'beginner': return 'bg-green-100 text-green-800';
      case 'intermediate': return 'bg-yellow-100 text-yellow-800';
      case 'advanced': return 'bg-red-100 text-red-800';
      case 'expert': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'published': return 'bg-green-100 text-green-800';
      case 'archived': return 'bg-red-100 text-red-800';
      case 'scheduled': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTimingStatus = (assessment) => {
    // Check if assessment has assignment dates and times
    const hasAssignmentDates = assessment.start_date_only && assessment.end_date_only;
    const hasAssignmentTimes = assessment.start_time_only && assessment.end_time_only;
    
    if (!hasAssignmentDates) {
      return { status: 'no-schedule', color: 'bg-gray-100 text-gray-800', text: 'No Schedule' };
    }
    
    const now = new Date();
    
    // Create proper datetime objects including time
    let startDateTime, endDateTime;
    
    // Check if the date fields already contain time information
    const startDateHasTime = assessment.start_date_only && assessment.start_date_only.includes('T');
    const endDateHasTime = assessment.end_date_only && assessment.end_date_only.includes('T');
    
    if (startDateHasTime && endDateHasTime && hasAssignmentTimes) {
      // Date fields contain datetime but we also have separate time fields
      // Extract just the date part and combine with the time
      const startDateOnly = assessment.start_date_only.split('T')[0];
      const endDateOnly = assessment.end_date_only.split('T')[0];
      
      startDateTime = new Date(`${startDateOnly}T${assessment.start_time_only}`);
      endDateTime = new Date(`${endDateOnly}T${assessment.end_time_only}`);
      
      // Validate the dates
      if (isNaN(startDateTime.getTime())) {
        console.warn(`Invalid start datetime for assessment ${assessment.id}: ${startDateOnly}T${assessment.start_time_only}`);
        startDateTime = null;
      }
      if (isNaN(endDateTime.getTime())) {
        console.warn(`Invalid end datetime for assessment ${assessment.id}: ${endDateOnly}T${assessment.end_time_only}`);
        endDateTime = null;
      }
    } else if (startDateHasTime && endDateHasTime) {
      // Date fields already contain full datetime and no separate time fields
      startDateTime = new Date(assessment.start_date_only);
      endDateTime = new Date(assessment.end_date_only);
      
      // Validate the dates
      if (isNaN(startDateTime.getTime())) {
        console.warn(`Invalid start datetime for assessment ${assessment.id}: ${assessment.start_date_only}`);
        startDateTime = null;
      }
      if (isNaN(endDateTime.getTime())) {
        console.warn(`Invalid end datetime for assessment ${assessment.id}: ${assessment.end_date_only}`);
        endDateTime = null;
      }
    } else if (hasAssignmentTimes) {
      // Combine date and time (for legacy data)
      startDateTime = new Date(`${assessment.start_date_only}T${assessment.start_time_only}`);
      endDateTime = new Date(`${assessment.end_date_only}T${assessment.end_time_only}`);
      
      // Validate the dates
      if (isNaN(startDateTime.getTime())) {
        console.warn(`Invalid start datetime for assessment ${assessment.id}: ${assessment.start_date_only}T${assessment.start_time_only}`);
        startDateTime = null;
      }
      if (isNaN(endDateTime.getTime())) {
        console.warn(`Invalid end datetime for assessment ${assessment.id}: ${assessment.end_date_only}T${assessment.end_time_only}`);
        endDateTime = null;
      }
    } else {
      // Use only dates (end of day for end date)
      startDateTime = new Date(assessment.start_date_only);
      endDateTime = new Date(assessment.end_date_only);
      
      // Validate the dates
      if (isNaN(startDateTime.getTime())) {
        console.warn(`Invalid start date for assessment ${assessment.id}: ${assessment.start_date_only}`);
        startDateTime = null;
      }
      if (isNaN(endDateTime.getTime())) {
        console.warn(`Invalid end date for assessment ${assessment.id}: ${assessment.end_date_only}`);
        endDateTime = null;
      } else {
        endDateTime.setHours(23, 59, 59, 999); // End of day
      }
    }
    

    
    // Handle cases where dates are invalid
    if (!startDateTime || !endDateTime) {
      return { status: 'no-schedule', color: 'bg-gray-100 text-gray-800', text: 'No Schedule' };
    }
    
    if (now < startDateTime) {
      return { status: 'upcoming', color: 'bg-blue-100 text-blue-800', text: 'Upcoming' };
    } else if (now >= startDateTime && now <= endDateTime) {
      return { status: 'active', color: 'bg-green-100 text-green-800', text: 'Active' };
    } else {
      return { status: 'expired', color: 'bg-red-100 text-red-800', text: 'Expired' };
    }
  };

  const formatDateTime = (dateString, timeString = null) => {
    if (!dateString) return 'Not set';
    
    const date = new Date(dateString);
    const formattedDate = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    
    if (timeString) {
      // Format time properly
      let time = timeString;
      if (typeof timeString === 'string' && timeString.includes(':')) {
        // If it's already in HH:MM format, use it as is
        time = timeString;
      } else if (typeof timeString === 'string') {
        // If it's just a time string, format it
        time = timeString.length === 4 ? `${timeString.slice(0, 2)}:${timeString.slice(2)}` : timeString;
      }
      return `${formattedDate} ${time}`;
    }
    
    return formattedDate;
  };

  const getTimeRemaining = (endDate) => {
    if (!endDate) return null;
    
    const now = new Date();
    const end = new Date(endDate);
    const diff = end - now;
    
    if (diff <= 0) return null;
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
      return `${days}d ${hours}h remaining`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    } else {
      return `${minutes}m remaining`;
    }
  };

  const filteredAssessments = assessments.filter(assessment => {
    // FIX: Add null checks to prevent undefined errors
    const assessmentTitle = assessment?.title || '';
    const assessmentDescription = assessment?.description || '';
    const matchesSearch = assessmentTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         assessmentDescription.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || assessment?.assessment_type === filterType;
    const matchesStatus = filterStatus === 'all' || assessment?.status === filterStatus;
    const matchesDifficulty = filterDifficulty === 'all' || assessment?.difficulty_level === filterDifficulty;
    
    return matchesSearch && matchesType && matchesStatus && matchesDifficulty;
  });

  const navigateToSubcategories = (category) => {
    setSelectedParentCategory(category);
    setCategoryView('subcategories');
    setCategoryBreadcrumb([
      { name: 'Categories', action: () => navigateToCategories() },
      { name: category.name, action: () => navigateToSubcategories(category) }
    ]);
  };

  const navigateToQuestions = (subcategory) => {
    setSelectedSubcategory(subcategory);
    setCategoryView('questions');
    setCategoryBreadcrumb([
      { name: 'Categories', action: () => navigateToCategories() },
      { name: selectedParentCategory.name, action: () => navigateToSubcategories(selectedParentCategory) },
      { name: subcategory.name, action: () => navigateToQuestions(subcategory) }
    ]);
    loadCategoryQuestions(subcategory.id);
  };

  const navigateToCategories = () => {
    setCategoryView('categories');
    setSelectedParentCategory(null);
    setSelectedSubcategory(null);
    setCategoryBreadcrumb([]);
  };

  const loadCategoryQuestions = async (categoryId) => {
    try {
      // Build params object and only include status if not 'all'
      const params = { category_id: categoryId };
      if (questionStatusFilter !== 'all') {
        params.status = questionStatusFilter;
      }
      // Load questions with status filter
      const response = await apiService.getQuestions(params);
      if (response.success) {
        setCategoryQuestions(response.data);
      }
    } catch (error) {
      console.error('Error loading category questions:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load questions for this category"
      });
    }
  };

  // Assessment action handlers
  const handleViewAssessment = async (assessment) => {
    try {
      setActionLoading(true);
      const response = await apiService.getAssessmentTemplateById(assessment.id);
      if (response.success) {
        setAssessmentToView(response.data);
        setShowViewAssessment(true);
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: response.message || "Failed to load assessment details"
        });
      }
    } catch (error) {
      console.error('Error loading assessment details:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to load assessment details. Please try again."
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditAssessment = (assessment) => {
    // Navigate to assessment wizard with edit mode
    navigate(`/assessments/create?edit=${assessment.id}`);
  };

  const handleSendReminder = async (assessment) => {
    try {
      setActionLoading(true);
      
      const response = await apiService.sendAssessmentReminder(assessment.id);
      
      if (response.success) {
        toast({
          title: "Reminder Sent",
          description: response.message,
        });
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to send reminder emails",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error sending reminder:', error);
      toast({
        title: "Error",
        description: "Failed to send reminder emails",
        variant: "destructive"
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDuplicateAssessment = (assessment) => {
    setAssessmentToCopy(assessment);
    setShowCopyAssessment(true);
  };

  const handleStatusChange = async (assessmentId, newStatus) => {
    try {
      setActionLoading(true);
      
      const response = await apiService.updateAssessmentTemplate(assessmentId, { status: newStatus });
      
      if (response.success) {
        // Update the local state
        setAssessments(prev => 
          prev.map(assessment => 
            assessment.id === assessmentId 
              ? { ...assessment, status: newStatus }
              : assessment
          )
        );
        
        toast({
          title: "Status Updated",
          description: `Assessment status changed to ${newStatus}`,
        });

        // If changing to published, assign to students and send notifications
        if (newStatus === 'published') {
          await assignAssessmentToAllStudents(assessmentId);
        }
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to update assessment status",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error updating assessment status:', error);
      toast({
        title: "Error",
        description: "Failed to update assessment status",
        variant: "destructive"
      });
    } finally {
      setActionLoading(false);
    }
  };

  const sendAssessmentNotifications = async (assessmentId) => {
    try {
      // Get assessment details
      const assessment = assessments.find(a => a.id === assessmentId);
      if (!assessment) return;

      // Get assigned students for this assessment
      const assignmentsResponse = await apiService.getAssessmentAssignments(assessmentId);
      if (assignmentsResponse.success && assignmentsResponse.data.length > 0) {
        // Send notifications to all assigned students
        const notificationPromises = assignmentsResponse.data.map(assignment => {
          if (assignment.assignment_type === 'individual') {
            return apiService.sendAssessmentNotification(assessmentId, assignment.target_id, {
              type: 'assessment_published',
              title: 'New Assessment Available',
              message: `A new assessment "${assessment?.title || 'Untitled Assessment'}" has been published and is now available for you to take.`
            });
          }
          return Promise.resolve();
        });

        await Promise.all(notificationPromises);
        
        toast({
          title: "Notifications Sent",
          description: `Assessment published and notifications sent to assigned students`,
        });
      }
    } catch (error) {
      console.error('Error sending assessment notifications:', error);
      // Don't show error toast here as the status update was successful
    }
  };

  const handleCopyAssessment = async (copyData) => {
    try {
      setActionLoading(true);
      
      // Create the assessment copy with all details
      const duplicateData = {
        title: copyData.title,
        description: copyData.description,
        instructions: copyData.instructions,
        assessment_type: assessmentToCopy.assessment_type,
        difficulty_level: assessmentToCopy.difficulty_level,
        time_limit_minutes: parseInt(copyData.timeLimit),
        total_points: parseInt(copyData.totalPoints),
        passing_score: parseInt(copyData.passingScore),
        max_attempts: parseInt(copyData.maxAttempts),
        shuffle_questions: copyData.questionSettings.shuffleQuestions,
        show_results_immediately: copyData.questionSettings.showResultsImmediately,
        allow_review: copyData.questionSettings.allowReview,
        require_proctoring: copyData.assignmentSettings.requireProctoring,
        access_password: copyData.assignmentSettings.accessPassword,
        department: assessmentToCopy.department,
        tags: assessmentToCopy.tags && Array.isArray(assessmentToCopy.tags) ? assessmentToCopy.tags : [],
        proctoring_settings: assessmentToCopy.proctoring_settings || {},
        status: 'draft',
        // Proper scheduling structure
        scheduling: {
          start_date: copyData.startDate,
          start_time: copyData.startTime || '09:00',
          end_date: copyData.endDate,
          end_time: copyData.endTime || '17:00',
          timezone: copyData.timezone || 'UTC',
          early_access_hours: parseInt(copyData.earlyAccessHours) || 0,
          late_submission_minutes: parseInt(copyData.lateSubmissionMinutes) || 0
        }
      };
      
      // Create the assessment template
      const response = await apiService.createAssessmentTemplate(duplicateData);
      if (response.success) {
        const newAssessmentId = response.data.id;
        
        // Copy all questions from original assessment
          await copyAssessmentQuestions(assessmentToCopy.id, newAssessmentId);
        
        // Assign to students if selected
        if (copyData.selectedStudents && copyData.selectedStudents.length > 0) {
          await assignAssessmentToStudents(newAssessmentId, copyData.selectedStudents);
        }
        
        // Send reminders if configured
        if (copyData.reminderSettings.sendImmediately) {
          await sendAssessmentReminders(newAssessmentId, copyData.reminderSettings, copyData.selectedStudents);
        }
        
        // Get question count for success message
        const questionsResponse = await apiService.getAssessmentQuestionsForAdmin(assessmentToCopy.id);
        const questionCount = questionsResponse.success ? questionsResponse.data?.length || 0 : 0;
        
        toast({
          title: "Success",
          description: `Assessment copied successfully with ${questionCount} questions linked${copyData.selectedStudents?.length > 0 ? ` and assigned to ${copyData.selectedStudents.length} students` : ''}`
        });
        
        loadData();
        setShowCopyAssessment(false);
        setAssessmentToCopy(null);
      } else {
        throw new Error(response.message || "Failed to create assessment copy");
      }
    } catch (error) {
      console.error('Error copying assessment:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to copy assessment. Please try again."
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Function to generate intelligent test cases based on question content
  // NOTE: This function provides suggestions only - actual test cases should be created by instructors
  // Removed hardcoded test data to prevent using mock data in production
  const generateTestCasesFromQuestion = (questionContent, codeTemplate, question) => {
    // Return empty array - instructors should create their own test cases
    // This prevents hardcoded test data from being used in production
    return [];
    
    // Previous hardcoded test case logic removed to prevent mock data usage
    // If test case generation is needed, it should be done via AI/ML service or manual creation
  };

  const copyAssessmentQuestions = async (originalAssessmentId, newAssessmentId) => {
    try {
      // Get all questions from original assessment (using admin API)
      const questionsResponse = await apiService.getAssessmentQuestionsForAdmin(originalAssessmentId);
      
      if (questionsResponse.success && questionsResponse.data && questionsResponse.data.length > 0) {
        // Link existing questions to the new assessment
        let copiedCount = 0;
        for (const question of questionsResponse.data) {
          try {
            // Add the existing question to the new assessment
            const addToAssessmentResponse = await apiService.addQuestionToAssessment(
              newAssessmentId, 
              question.id, // Use existing question ID
              null, // section_id - will be added to default section
              copiedCount + 1, // question_order
              question.points || 1, // points
              question.time_limit || null, // time_limit_seconds
              question.is_required !== false // is_required
            );
            
            if (addToAssessmentResponse.success) {
              copiedCount++;
            }
          } catch (questionError) {
            console.error('Error linking question to assessment:', questionError);
          }
        }
      }
    } catch (error) {
      console.error('Error copying questions:', error);
      // Don't throw error here as assessment copy should still succeed even if questions fail
    }
  };

  const assignAssessmentToStudents = async (assessmentId, students) => {
    try {
      const studentIds = students.map(student => student.id);
      const response = await apiService.assignAssessmentToStudents(assessmentId, studentIds);
      if (!response.success) {
        throw new Error(response.message || 'Failed to assign assessment to students');
      }
    } catch (error) {
      console.error('Error assigning assessment to students:', error);
      throw new Error('Failed to assign assessment to students');
    }
  };

  const assignAssessmentToAllStudents = async (assessmentId) => {
    try {
      // Get all students
      const studentsResponse = await apiService.getStudents();
      if (studentsResponse.success && studentsResponse.data.length > 0) {
        const students = studentsResponse.data;
        
        // Assign assessment to all students
        await assignAssessmentToStudents(assessmentId, students);
        
        // Send notifications to all students
        await sendAssessmentNotifications(assessmentId);
        
        toast({
          title: "Assessment Published",
          description: `Assessment has been assigned to ${students.length} students and notifications sent`,
        });
      } else {
        toast({
          title: "No Students Found",
          description: "No students available to assign this assessment to",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error assigning assessment to all students:', error);
      toast({
        title: "Assignment Error",
        description: "Failed to assign assessment to students, but status was updated",
        variant: "destructive"
      });
    }
  };

  const sendAssessmentReminders = async (assessmentId, reminderSettings, selectedStudents = null) => {
    try {
      const reminderData = {
        assessment_id: assessmentId,
        send_immediately: reminderSettings.sendImmediately,
        send_before_start: reminderSettings.sendBeforeStart,
        send_before_end: reminderSettings.sendBeforeEnd,
        custom_message: reminderSettings.customReminderMessage,
        student_ids: selectedStudents ? selectedStudents.map(student => student.id) : null
      };
      
      const response = await apiService.sendAssessmentReminders(reminderData);
      if (!response.success) {
        console.warn('Failed to send reminders:', response.message);
      }
    } catch (error) {
      console.error('Error sending reminders:', error);
      // Don't throw error here as it's not critical
    }
  };

  const handleDeleteAssessment = async () => {
    try {
      setActionLoading(true);
      const response = await apiService.deleteAssessmentTemplate(assessmentToDelete.id);
      if (response.success) {
        toast({
          title: "Success",
          description: "Assessment deleted successfully"
        });
        setShowDeleteAssessment(false);
        setAssessmentToDelete(null);
        loadData();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete assessment"
      });
    } finally {
      setActionLoading(false);
    }
  };

  const openDeleteAssessment = (assessment) => {
    setAssessmentToDelete(assessment);
    setShowDeleteAssessment(true);
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading assessment platform...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
          <div className="flex-1">
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
            <Button onClick={() => navigate('/assessments/create')} className="whitespace-nowrap">
              <Plus className="mr-2 h-4 w-4" />
              Create Assessment Wizard
            </Button>
            <Button variant="outline" onClick={() => navigate('/create-question')} className="whitespace-nowrap">
              <Plus className="mr-2 h-4 w-4" />
              Add Question
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="assessments">Assessments</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
          </TabsList>

          {/* Assessments Tab */}
          <TabsContent value="assessments" className="space-y-6">
            {/* Filters */}
            <Card>
              <CardContent>
                <div className="grid mt-4 gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                  <div>
                    <Label htmlFor="search">Search</Label>
                    <Input
                      id="search"
                      placeholder="Search assessments..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="type">Type</Label>
                    <Select value={filterType} onValueChange={setFilterType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="quiz">Quiz</SelectItem>
                        <SelectItem value="test">Test</SelectItem>
                        <SelectItem value="exam">Exam</SelectItem>
                        <SelectItem value="assignment">Assignment</SelectItem>
                        <SelectItem value="coding_challenge">Coding Challenge</SelectItem>
                        <SelectItem value="survey">Survey</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="status">Status</Label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="published">Published</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="difficulty">Difficulty</Label>
                    <Select value={filterDifficulty} onValueChange={setFilterDifficulty}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Difficulties</SelectItem>
                        <SelectItem value="beginner">Beginner</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                        <SelectItem value="expert">Expert</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2 sm:space-x-2">
                    <div className="flex items-center space-x-1 border rounded-md">
                      <Button
                        variant={viewMode === 'cards' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setViewMode('cards')}
                        className="h-8 px-2"
                      >
                        <Grid3X3 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={viewMode === 'list' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setViewMode('list')}
                        className="h-8 px-2"
                      >
                        <List className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button variant="outline" onClick={loadData} className="h-8">
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Assessments View */}
            {viewMode === 'cards' ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredAssessments.map((assessment) => (
                  <motion.div
                    key={assessment.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Card className="h-full hover:shadow-lg transition-shadow">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-2">
                            {getAssessmentTypeIcon(assessment.assessment_type)}
                            <CardTitle className="text-lg">{assessment?.title || 'Untitled Assessment'}</CardTitle>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Select
                              value={assessment.status}
                              onValueChange={(newStatus) => handleStatusChange(assessment.id, newStatus)}
                              disabled={actionLoading}
                            >
                              <SelectTrigger className="w-28 h-8 text-xs px-2">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="draft">
                                  <div className="flex items-center space-x-2 py-1">
                                    <div className="w-3 h-3 rounded-full bg-yellow-500 border border-yellow-600 flex-shrink-0"></div>
                                    <span>Draft</span>
                                  </div>
                                </SelectItem>
                                <SelectItem value="published">
                                  <div className="flex items-center space-x-2 py-1">
                                    <div className="w-3 h-3 rounded-full bg-green-500 border border-green-600 flex-shrink-0"></div>
                                    <span>Published</span>
                                  </div>
                                </SelectItem>
                                <SelectItem value="archived">
                                  <div className="flex items-center space-x-2 py-1">
                                    <div className="w-3 h-3 rounded-full bg-gray-500 border border-gray-600 flex-shrink-0"></div>
                                    <span>Archived</span>
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <Badge className={`text-xs ${getTimingStatus(assessment).color}`}>
                              {getTimingStatus(assessment).text}
                            </Badge>
                          </div>
                        </div>
                        {/* Description hidden as requested */}
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Time and Points */}
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center">
                            <Clock className="mr-1 h-3 w-3" />
                            {assessment.time_limit_minutes} min
                          </span>
                          <span className="flex items-center">
                            <Target className="mr-1 h-3 w-3" />
                            {assessment.total_points} pts
                          </span>
                        </div>

                        {/* Difficulty and Questions */}
                        <div className="flex items-center justify-between">
                          <Badge className={getDifficultyColor(assessment.difficulty_level)}>
                            {assessment.difficulty_level}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {assessment.question_count || 0} questions
                          </span>
                        </div>

                        {/* Start and End Time */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center text-muted-foreground">
                              <Calendar className="mr-1 h-3 w-3" />
                              Start:
                            </span>
                            <span className="text-xs">
                              {formatDateTime(assessment.start_date_only, assessment.start_time_only)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center text-muted-foreground">
                              <Calendar className="mr-1 h-3 w-3" />
                              End:
                            </span>
                            <span className="text-xs">
                              {formatDateTime(assessment.end_date_only, assessment.end_time_only)}
                            </span>
                          </div>
                          {getTimingStatus(assessment).status === 'active' && getTimeRemaining(assessment.end_date_only) && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center text-green-600">
                                <Clock className="mr-1 h-3 w-3" />
                                Time Left:
                              </span>
                              <span className="text-xs text-green-600 font-medium">
                                {getTimeRemaining(assessment.end_date_only)}
                              </span>
                            </div>
                          )}
                        </div>

                        <Separator />

                        {/* Submissions and Creator */}
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center text-muted-foreground">
                            <Users className="mr-1 h-3 w-3" />
                            {assessment.submission_count || 0} submissions
                          </span>
                          <span className="text-muted-foreground">
                            {assessment.creator_name}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleViewAssessment(assessment)}
                            disabled={actionLoading}
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            View
                          </Button>
                          <div className="flex space-x-1">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleSendReminder(assessment)}
                              disabled={actionLoading}
                              title="Send Reminder Email"
                            >
                              <Mail className="h-3 w-3" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleEditAssessment(assessment)}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleDuplicateAssessment(assessment)}
                              disabled={actionLoading}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => openDeleteAssessment(assessment)}
                              disabled={actionLoading}
                            >
                              <Trash className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredAssessments.map((assessment) => (
                  <motion.div
                    key={assessment.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Card className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4 sm:p-6">
                        {/* Main content area */}
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                          {/* Assessment info */}
                          <div className="flex items-start space-x-3 flex-1 min-w-0">
                            {getAssessmentTypeIcon(assessment.assessment_type)}
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-lg truncate">{assessment?.title || 'Untitled Assessment'}</h3>
                              {/* Description hidden as requested */}
                            </div>
                          </div>
                          
                          {/* Status and timing */}
                          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                            <div className="flex items-center space-x-2">
                              <Select
                                value={assessment.status}
                                onValueChange={(newStatus) => handleStatusChange(assessment.id, newStatus)}
                                disabled={actionLoading}
                              >
                                <SelectTrigger className="w-28 h-8 text-xs px-2">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="draft">
                                    <div className="flex items-center space-x-2 py-1">
                                      <div className="w-3 h-3 rounded-full bg-yellow-500 border border-yellow-600 flex-shrink-0"></div>
                                      <span>Draft</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="published">
                                    <div className="flex items-center space-x-2 py-1">
                                      <div className="w-3 h-3 rounded-full bg-green-500 border border-green-600 flex-shrink-0"></div>
                                      <span>Published</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="archived">
                                    <div className="flex items-center space-x-2 py-1">
                                      <div className="w-3 h-3 rounded-full bg-gray-500 border border-gray-600 flex-shrink-0"></div>
                                      <span>Archived</span>
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <Badge className={`text-xs ${getTimingStatus(assessment).color}`}>
                                {getTimingStatus(assessment).text}
                              </Badge>
                            </div>
                          </div>
                        </div>

                        {/* Assessment details */}
                        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                            <span className="flex items-center">
                              <Clock className="mr-1 h-4 w-4" />
                              {assessment.time_limit_minutes} min
                            </span>
                            <span className="flex items-center">
                              <Target className="mr-1 h-4 w-4" />
                              {assessment.total_points} pts
                            </span>
                            <span className="flex items-center">
                              <Users className="mr-1 h-4 w-4" />
                              {assessment.submission_count || 0} submissions
                            </span>
                            <Badge className={getDifficultyColor(assessment.difficulty_level)}>
                              {assessment.difficulty_level}
                            </Badge>
                          </div>
                        </div>

                        {/* Metadata */}
                        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                            <span>Created by: {assessment.creator_name}</span>
                            <span>Questions: {assessment.question_count || 0}</span>
                            <span className="hidden sm:inline">Start: {formatDateTime(assessment.start_date_only, assessment.start_time_only)}</span>
                            <span className="hidden sm:inline">End: {formatDateTime(assessment.end_date_only, assessment.end_time_only)}</span>
                          </div>
                          {getTimingStatus(assessment).status === 'active' && getTimeRemaining(assessment.end_date_only) && (
                            <span className="text-green-600 font-medium">
                              Time Left: {getTimeRemaining(assessment.end_date_only)}
                            </span>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleViewAssessment(assessment)}
                            disabled={actionLoading}
                            className="flex-1 sm:flex-none"
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            View
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleSendReminder(assessment)}
                            disabled={actionLoading}
                            title="Send Reminder Email"
                          >
                            <Mail className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleEditAssessment(assessment)}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleDuplicateAssessment(assessment)}
                            disabled={actionLoading}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => openDeleteAssessment(assessment)}
                            disabled={actionLoading}
                          >
                            <Trash className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}

            {filteredAssessments.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No assessments found</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    {searchTerm || filterType !== 'all' || filterStatus !== 'all' || filterDifficulty !== 'all'
                      ? 'Try adjusting your filters or search terms'
                      : 'Create your first assessment to get started'}
                  </p>
                  <Button onClick={() => navigate('/assessments/create')}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Assessment Wizard
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>



          {/* Categories Tab */}
          <TabsContent value="categories" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>
                      {categoryView === 'categories' && 'Question Categories'}
                      {categoryView === 'subcategories' && `Subcategories - ${selectedParentCategory?.name}`}
                      {categoryView === 'questions' && `Questions - ${selectedSubcategory?.name}`}
                    </CardTitle>
                    <CardDescription>
                      {categoryView === 'categories' && 'Organize questions by categories and subcategories'}
                      {categoryView === 'subcategories' && `Subcategories under ${selectedParentCategory?.name}`}
                      {categoryView === 'questions' && `Questions in ${selectedSubcategory?.name}`}
                    </CardDescription>
                  </div>
                  {categoryView === 'categories' && (
                    <Button onClick={() => setShowCreateCategory(true)} className="mt-4 sm:mt-0">
                      <Plus className="mr-2 h-4 w-4" />
                      Create Category
                    </Button>
                  )}
                </div>

                {/* Breadcrumb Navigation */}
                {categoryBreadcrumb.length > 0 && (
                  <div className="flex items-center space-x-2 text-sm text-muted-foreground mt-2">
                    {categoryBreadcrumb.map((item, index) => (
                      <div key={index} className="flex items-center">
                        <button
                          onClick={item.action}
                          className="hover:text-foreground transition-colors"
                        >
                          {item.name}
                        </button>
                        {index < categoryBreadcrumb.length - 1 && (
                          <span className="mx-2">/</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {/* Search and Filter - Only show for categories view */}
                {categoryView === 'categories' && (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
                    <div>
                      <Label htmlFor="category-search">Search Categories</Label>
                      <Input
                        id="category-search"
                        placeholder="Search by name or description..."
                        value={categorySearchTerm}
                        onChange={(e) => setCategorySearchTerm(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="category-filter">Filter by Type</Label>
                      <Select value={categoryFilterParent} onValueChange={setCategoryFilterParent}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          <SelectItem value="main">Main Categories</SelectItem>
                          <SelectItem value="sub">Subcategories</SelectItem>
                          {getParentCategories().map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category?.name || 'Unnamed Category'} (Parent)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Categories View */}
                {categoryView === 'categories' && (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredCategories.map((category) => (
                      <Card 
                        key={category.id} 
                        className="h-full hover:shadow-lg transition-shadow cursor-pointer"
                        onClick={() => navigateToSubcategories(category)}
                      >
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="flex items-center space-x-2">
                              <div 
                                className="w-4 h-4 rounded-full"
                                style={{ backgroundColor: category.color }}
                              />
                              <CardTitle className="text-lg">{category?.name || 'Unnamed Category'}</CardTitle>
                            </div>
                            <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditCategory(category)}
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDeleteCategory(category)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground mb-4">
                            {category.description || 'No description provided'}
                          </p>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              {category.question_count || 0} questions
                            </span>
                            <span className="text-muted-foreground">
                              {category.subcategory_count || 0} subcategories
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Subcategories View */}
                {categoryView === 'subcategories' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Subcategories</h3>
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setCategoryForm({
                            name: '',
                            description: '',
                            parent_id: selectedParentCategory?.id,
                            color: '#3B82F6',
                            icon: ''
                          });
                          setShowCreateCategory(true);
                        }}
                        size="sm"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Subcategory
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {getSubcategories(selectedParentCategory?.id).map((subcategory) => (
                        <Card 
                          key={subcategory.id} 
                          className="h-full hover:shadow-lg transition-shadow cursor-pointer"
                          onClick={() => navigateToQuestions(subcategory)}
                        >
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <div className="flex items-center space-x-2">
                                <div 
                                  className="w-4 h-4 rounded-full"
                                  style={{ backgroundColor: subcategory.color }}
                                />
                                <CardTitle className="text-lg">{subcategory.name}</CardTitle>
                              </div>
                              <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditCategory(subcategory)}
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openDeleteCategory(subcategory)}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              Subcategory
                            </Badge>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground mb-4">
                              {subcategory.description || 'No description provided'}
                            </p>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                {subcategory.question_count || 0} questions
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {getSubcategories(selectedParentCategory?.id).length === 0 && (
                      <div className="text-center py-8">
                        <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">No subcategories found</p>
                        <Button 
                          variant="outline" 
                          onClick={() => {
                            setCategoryForm({
                              name: '',
                              description: '',
                              parent_id: selectedParentCategory?.id,
                              color: '#3B82F6',
                              icon: ''
                            });
                            setShowCreateCategory(true);
                          }}
                          className="mt-2"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Create First Subcategory
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Questions View */}
                {categoryView === 'questions' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Questions</h3>
                      <div className="flex items-center space-x-2">
                        <Select value={questionStatusFilter} onValueChange={setQuestionStatusFilter}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Questions</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="archived">Archived</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button 
                          variant="outline" 
                          onClick={() => navigate('/create-question')}
                          size="sm"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Question
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {categoryQuestions.map((question) => (
                        <Card key={question.id} className="h-full hover:shadow-lg transition-shadow">
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <div className="flex items-center space-x-2">
                                <div className="w-4 h-4 rounded-full bg-blue-500" />
                                <CardTitle className="text-lg line-clamp-2">{question.title}</CardTitle>
                              </div>
                              <div className="flex items-center space-x-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => navigate(`/create-question?edit=${question.id}`)}
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Badge className={getDifficultyColor(question.difficulty_level)}>
                                {question.difficulty_level}
                              </Badge>
                              <Badge className={getStatusColor(question.status)}>
                                {question.status}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground mb-4 line-clamp-3">
                              {question.content || question.question_text}
                            </p>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                {question.question_type || question.type}
                              </span>
                              <span className="text-muted-foreground">
                                {question.points || 0} points
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {categoryQuestions.length === 0 && (
                      <div className="text-center py-8">
                        <CheckSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">No questions found in this category</p>
                        <Button 
                          variant="outline" 
                          onClick={() => navigate('/create-question')}
                          className="mt-2"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Create First Question
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {categoryView === 'categories' && filteredCategories.length === 0 && (
                  <div className="text-center py-8">
                    <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No categories found</p>
                    <Button 
                      variant="outline" 
                      onClick={() => setShowCreateCategory(true)}
                      className="mt-2"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Create First Category
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>


        </Tabs>



        {/* Create Question Dialog */}
        <Dialog open={showCreateQuestion} onOpenChange={setShowCreateQuestion}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Question</DialogTitle>
              <DialogDescription>
                Add a new question to your question bank
              </DialogDescription>
            </DialogHeader>
                <div className="space-y-4">
              <div>
                <Label htmlFor="question_title">
                  Question Title 
                  {questionForm.question_type === 'coding' && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  id="question_title"
                  value={questionForm.title}
                  onChange={(e) => setQuestionForm({...questionForm, title: e.target.value})}
                  placeholder={questionForm.question_type === 'coding' ? "Enter question title (required)" : "Enter question title (optional)"}
                />
                </div>

              <div>
                <Label htmlFor="question_content">Question Content *</Label>
                <Textarea
                  id="question_content"
                  value={questionForm.content}
                  onChange={(e) => setQuestionForm({...questionForm, content: e.target.value})}
                  placeholder="Enter question content"
                />
                  </div>

              <div className="grid gap-4 md:grid-cols-2">
                    <div>
                  <Label htmlFor="question_type">Question Type *</Label>
                  <Select 
                    value={questionForm.question_type} 
                    onValueChange={(value) => setQuestionForm({...questionForm, question_type: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                      <SelectItem value="single_choice">Single Choice</SelectItem>
                      <SelectItem value="true_false">True/False</SelectItem>
                      <SelectItem value="short_answer">Short Answer</SelectItem>
                      <SelectItem value="essay">Essay</SelectItem>
                      <SelectItem value="coding">Coding</SelectItem>
                      <SelectItem value="fill_blank">Fill in the Blank</SelectItem>
                    </SelectContent>
                  </Select>
                    </div>
                <div>
                  <Label htmlFor="question_difficulty">Difficulty Level</Label>
                  <Select 
                    value={questionForm.difficulty_level} 
                    onValueChange={(value) => setQuestionForm({...questionForm, difficulty_level: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="easy">Easy</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="hard">Hard</SelectItem>
                      <SelectItem value="expert">Expert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                    </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                    <div>
                  <Label htmlFor="question_points">Points</Label>
                      <Input
                    id="question_points"
                        type="number"
                    value={questionForm.points}
                    onChange={(e) => setQuestionForm({...questionForm, points: parseInt(e.target.value)})}
                      />
                    </div>
                <div>
                  <Label htmlFor="question_category">Category</Label>
                  <Select 
                    value={questionForm.category_id} 
                    onValueChange={(value) => setQuestionForm({...questionForm, category_id: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category?.name || 'Unnamed Category'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                </div>

              {['multiple_choice', 'single_choice'].includes(questionForm.question_type) && (
            <div>
                  <Label>Options</Label>
              <div className="space-y-2">
                    {questionForm.options.map((option, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <Input
                          value={option}
                          onChange={(e) => {
                            const newOptions = [...questionForm.options];
                            newOptions[index] = e.target.value;
                            setQuestionForm({...questionForm, options: newOptions});
                          }}
                          placeholder={`Option ${index + 1}`}
                        />
                    <Checkbox
                          checked={questionForm.correct_answer.includes(index)}
                      onCheckedChange={(checked) => {
                            const newCorrectAnswer = checked 
                              ? [...questionForm.correct_answer, index]
                              : questionForm.correct_answer.filter(i => i !== index);
                            setQuestionForm({...questionForm, correct_answer: newCorrectAnswer});
                          }}
                        />
                  </div>
                ))}
              </div>
                      </div>
                    )}
              
                  <div>
                <Label htmlFor="question_explanation">Explanation</Label>
                <Textarea
                  id="question_explanation"
                  value={questionForm.explanation}
                  onChange={(e) => setQuestionForm({...questionForm, explanation: e.target.value})}
                  placeholder="Explain the correct answer"
                />
            </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateQuestion(false)}>
                Cancel
        </Button>
              <Button onClick={handleCreateQuestion}>
                Create Question
        </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Category Dialog */}
        <Dialog open={showCreateCategory} onOpenChange={setShowCreateCategory}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {categoryView === 'categories' ? 'Create New Category' : 'Create New Subcategory'}
              </DialogTitle>
              <DialogDescription>
                {categoryView === 'categories' 
                  ? 'Add a new category to organize your questions' 
                  : `Add a new subcategory under ${selectedParentCategory?.name}`
                }
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="category_name">Category Name *</Label>
                <Input
                  id="category_name"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({...categoryForm, name: e.target.value})}
                  placeholder="Enter category name"
                />
              </div>
              <div>
                <Label htmlFor="category_description">Description</Label>
                <Textarea
                  id="category_description"
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({...categoryForm, description: e.target.value})}
                  placeholder="Enter category description"
                />
              </div>
              <div>
                <Label htmlFor="category_parent">Parent Category</Label>
                <Select 
                  value={categoryForm.parent_id || 'none'} 
                  onValueChange={(value) => setCategoryForm({...categoryForm, parent_id: value === 'none' ? null : value})}
                  disabled={categoryView === 'subcategories'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select parent category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Parent</SelectItem>
                    {getParentCategories().map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category?.name || 'Unnamed Category'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categoryView === 'subcategories' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This will be a subcategory of {selectedParentCategory?.name}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="category_color">Color</Label>
                <Input
                  id="category_color"
                  type="color"
                  value={categoryForm.color}
                  onChange={(e) => setCategoryForm({...categoryForm, color: e.target.value})}
                />
              </div>
              <div>
                <Label htmlFor="category_icon">Icon (e.g., smiley, book, star)</Label>
                <Input
                  id="category_icon"
                  value={categoryForm.icon}
                  onChange={(e) => setCategoryForm({...categoryForm, icon: e.target.value})}
                  placeholder="Enter icon name (e.g., smiley, book, star)"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateCategory(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateCategory}>
                Create Category
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Category Dialog */}
        <Dialog open={showEditCategory} onOpenChange={setShowEditCategory}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Category</DialogTitle>
              <DialogDescription>
                Modify the details of the category
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit_category_name">Category Name *</Label>
                <Input
                  id="edit_category_name"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({...categoryForm, name: e.target.value})}
                  placeholder="Enter category name"
                />
              </div>
              <div>
                <Label htmlFor="edit_category_description">Description</Label>
                <Textarea
                  id="edit_category_description"
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({...categoryForm, description: e.target.value})}
                  placeholder="Enter category description"
                />
              </div>
              <div>
                <Label htmlFor="edit_category_parent">Parent Category</Label>
                <Select 
                  value={categoryForm.parent_id || 'none'} 
                  onValueChange={(value) => setCategoryForm({...categoryForm, parent_id: value === 'none' ? null : value})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select parent category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Parent</SelectItem>
                    {getParentCategories().map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category?.name || 'Unnamed Category'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit_category_color">Color</Label>
                <Input
                  id="edit_category_color"
                  type="color"
                  value={categoryForm.color}
                  onChange={(e) => setCategoryForm({...categoryForm, color: e.target.value})}
                />
              </div>
              <div>
                <Label htmlFor="edit_category_icon">Icon (e.g., smiley, book, star)</Label>
                <Input
                  id="edit_category_icon"
                  value={categoryForm.icon}
                  onChange={(e) => setCategoryForm({...categoryForm, icon: e.target.value})}
                  placeholder="Enter icon name (e.g., smiley, book, star)"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditCategory(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateCategory}>
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Category Dialog */}
        <Dialog open={showDeleteCategory} onOpenChange={setShowDeleteCategory}>
          <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Are you absolutely sure?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. This will permanently delete your category.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowDeleteCategory(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteCategory}>
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* View Assessment Dialog */}
        <Dialog open={showViewAssessment} onOpenChange={setShowViewAssessment}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Assessment Details
              </DialogTitle>
              <DialogDescription>
                Comprehensive view of the assessment template and its configuration.
              </DialogDescription>
            </DialogHeader>
            {assessmentToView ? (
              <div className="space-y-6">
                {/* Header Section */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg border">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        {getAssessmentTypeIcon(assessmentToView.assessment_type)}
                        <h2 className="text-2xl font-bold text-gray-900">{assessmentToView.title}</h2>
                        <Badge className={getStatusColor(assessmentToView.status)}>
                          {assessmentToView.status}
                        </Badge>
                      </div>
                      {assessmentToView.description && (
                        <p className="text-gray-600 mb-4">{assessmentToView.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {assessmentToView.time_limit_minutes} minutes
                        </div>
                        <div className="flex items-center gap-1">
                          <Target className="h-4 w-4" />
                          {assessmentToView.total_points} points
                        </div>
                        <div className="flex items-center gap-1">
                          <CheckSquare className="h-4 w-4" />
                          {assessmentToView.question_count || 0} questions
                        </div>
                        <div className="flex items-center gap-1">
                          <Users className="h-4 w-4" />
                          {assessmentToView.creator_name}
                        </div>
                      </div>
                    </div>
                    <Badge className={getDifficultyColor(assessmentToView.difficulty_level)}>
                      {assessmentToView.difficulty_level}
                    </Badge>
                  </div>
                </div>

                {/* Compact Assessment Details */}
                <Card>
                  <CardContent className="p-6">
                    <div className="max-w-7xl mx-auto">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-6">
                      
                      {/* Basic Info Section */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                          <Settings className="h-4 w-4" />
                          Basic Info
                        </h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Type:</span>
                            <span className="font-medium">{assessmentToView.assessment_type}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Difficulty:</span>
                            <Badge className={getDifficultyColor(assessmentToView.difficulty_level)} size="sm">
                              {assessmentToView.difficulty_level}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Time Limit:</span>
                            <span className="font-medium">{assessmentToView.time_limit_minutes}m</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Points:</span>
                            <span className="font-medium">{assessmentToView.total_points}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Passing:</span>
                            <span className="font-medium">{assessmentToView.passing_score}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Attempts:</span>
                            <span className="font-medium">{assessmentToView.max_attempts}</span>
                          </div>
                        </div>
                      </div>

                      {/* Settings Section */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                          <Settings className="h-4 w-4" />
                          Settings
                        </h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Shuffle:</span>
                            <Badge variant={assessmentToView.shuffle_questions ? "default" : "secondary"} size="sm">
                              {assessmentToView.shuffle_questions ? 'On' : 'Off'}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Results:</span>
                            <Badge variant={assessmentToView.show_results_immediately ? "default" : "secondary"} size="sm">
                              {assessmentToView.show_results_immediately ? 'Immediate' : 'Delayed'}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Review:</span>
                            <Badge variant={assessmentToView.allow_review ? "default" : "secondary"} size="sm">
                              {assessmentToView.allow_review ? 'Allowed' : 'Disabled'}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      {/* Proctoring & Access Section */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                          <Shield className="h-4 w-4" />
                          Proctoring & Access
                        </h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Proctoring:</span>
                            <div className="flex items-center gap-1">
                              <div className={`w-2 h-2 rounded-full ${assessmentToView.require_proctoring ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                              <span className="font-medium text-xs">
                                {assessmentToView.require_proctoring ? 'Required' : 'None'}
                              </span>
                            </div>
                          </div>
                          {assessmentToView.proctoring_settings && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Type:</span>
                              <span className="font-medium text-xs">{assessmentToView.proctoring_settings.proctoring_type || 'None'}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-500">Access Password:</span>
                            {assessmentToView.assignments && assessmentToView.assignments.length > 0 && assessmentToView.assignments[0].password ? (
                              <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded text-green-600">
                                {assessmentToView.assignments[0].password}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs italic">None</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Scheduling Section */}
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          Scheduling
                        </h3>
                        <div className="space-y-2 text-sm">
                          {assessmentToView.assignments && assessmentToView.assignments.length > 0 ? (
                            assessmentToView.assignments.map((assignment, index) => (
                              <div key={assignment.id || index} className="border-l-2 border-blue-200 pl-2">
                                <div className="text-xs font-medium text-gray-600 mb-1">
                                  Assignment {index + 1} ({assignment.assignment_type})
                                </div>
                                {assignment.start_date_only && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500 text-xs">Start:</span>
                                    <span className="font-medium text-xs">
                                      {new Date(assignment.start_date_only).toLocaleDateString()}
                                      {assignment.start_time_only && ` ${assignment.start_time_only}`}
                                    </span>
                                  </div>
                                )}
                                {assignment.end_date_only && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500 text-xs">End:</span>
                                    <span className="font-medium text-xs">
                                      {new Date(assignment.end_date_only).toLocaleDateString()}
                                      {assignment.end_time_only && ` ${assignment.end_time_only}`}
                                    </span>
                                  </div>
                                )}
                                {assignment.assessment_timezone && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500 text-xs">TZ:</span>
                                    <span className="font-medium text-xs">{assignment.assessment_timezone}</span>
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            assessmentToView.scheduling && (
                              <>
                                {assessmentToView.scheduling.start_date && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500 text-xs">Start:</span>
                                    <span className="font-medium text-xs">
                                      {new Date(assessmentToView.scheduling.start_date).toLocaleDateString()}
                                      {assessmentToView.scheduling.start_time && ` ${assessmentToView.scheduling.start_time}`}
                                    </span>
                                  </div>
                                )}
                                {assessmentToView.scheduling.end_date && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-500 text-xs">End:</span>
                                    <span className="font-medium text-xs">
                                      {new Date(assessmentToView.scheduling.end_date).toLocaleDateString()}
                                      {assessmentToView.scheduling.end_time && ` ${assessmentToView.scheduling.end_time}`}
                                    </span>
                                  </div>
                                )}
                              </>
                            )
                          )}
                        </div>
                      </div>

                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Instructions & Tags Section */}
                {(assessmentToView.instructions || (assessmentToView.tags && Array.isArray(assessmentToView.tags) && assessmentToView.tags.length > 0)) && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        
                        {/* Instructions */}
                        {assessmentToView.instructions && (
                          <div>
                            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                              <FileText className="h-4 w-4" />
                              Instructions
                            </h3>
                            <div className="bg-gray-50 p-3 rounded text-sm text-gray-700 max-h-32 overflow-y-auto">
                              <p className="whitespace-pre-wrap">{assessmentToView.instructions}</p>
                            </div>
                          </div>
                        )}

                        {/* Tags */}
                        {assessmentToView.tags && Array.isArray(assessmentToView.tags) && assessmentToView.tags.length > 0 && (
                          <div>
                            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                              <Globe className="h-4 w-4" />
                              Tags
                            </h3>
                            <div className="flex flex-wrap gap-1">
                              {assessmentToView.tags.map((tag, index) => (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Sections and Questions Preview */}
                {assessmentToView.sections && assessmentToView.sections.length > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
                        <BookOpen className="h-4 w-4" />
                        Sections & Questions
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {assessmentToView.sections.map((section, index) => (
                          <div key={section.id || index} className="border rounded-lg p-3 bg-gray-50">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-medium text-gray-900 text-sm">{section.name}</h4>
                              <Badge variant="outline" className="text-xs">
                                {section.questions ? section.questions.length : 0}q
                              </Badge>
                            </div>
                            {section.description && (
                              <p className="text-xs text-gray-600 mb-2 line-clamp-2">{section.description}</p>
                            )}
                            {section.questions && section.questions.length > 0 && (
                              <div className="space-y-1">
                                {section.questions.slice(0, 2).map((question, qIndex) => (
                                  <div key={qIndex} className="flex items-center gap-1 text-xs text-gray-600">
                                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0"></div>
                                    <span className="truncate flex-1">{question.title || 'Untitled'}</span>
                                    <span className="text-xs text-gray-500">{question.points || 1}p</span>
                                  </div>
                                ))}
                                {section.questions.length > 2 && (
                                  <div className="text-xs text-gray-500 italic">
                                    +{section.questions.length - 2} more
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No assessment selected for viewing.</p>
              </div>
            )}
            <DialogFooter className="flex flex-col sm:flex-row gap-2">
              <div className="flex gap-2 order-2 sm:order-1">
                <Button variant="outline" onClick={() => setShowViewAssessment(false)}>
                  Close
                </Button>
                <Button variant="outline" onClick={() => handleDuplicateAssessment(assessmentToView)} disabled={actionLoading}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </Button>
              </div>
              <div className="flex gap-2 order-1 sm:order-2">
                <Button onClick={() => handleEditAssessment(assessmentToView)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit with Wizard
                </Button>
                <Button variant="destructive" onClick={() => openDeleteAssessment(assessmentToView)} disabled={actionLoading}>
                  <Trash className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Assessment Dialog */}
        <Dialog open={showDeleteAssessment} onOpenChange={setShowDeleteAssessment}>
          <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Are you absolutely sure?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. This will permanently delete your assessment.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowDeleteAssessment(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteAssessment} disabled={actionLoading}>
                {actionLoading ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Copy Assessment Dialog */}
        <CopyAssessmentDialog
          isOpen={showCopyAssessment}
          onClose={() => {
            setShowCopyAssessment(false);
            setAssessmentToCopy(null);
          }}
          assessment={assessmentToCopy}
          onCopy={handleCopyAssessment}
          loading={actionLoading}
        />
      </motion.div>
    </div>
  );
};

export default AssessmentManagementPage; 