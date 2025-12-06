import React, { useState, useEffect } from 'react';
import * as ExcelJS from 'exceljs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { 
  Users, 
  Plus, 
  Search, 
  Filter, 
  Download, 
  Upload, 
  Edit, 
  Trash2, 
  Eye, 
  EyeOff,
  Building,
  UserPlus,
  Table,
  Loader2,
  RefreshCw,
  Copy,
  Key,
  RotateCcw,
  Save,
  Crown,
  GraduationCap,
  User,
  CheckSquare,
  Square,
  Code,
  Info,
  AlertCircle
} from 'lucide-react';
import apiService from '@/services/api';

const UserManagementPage = () => {
  const [users, setUsers] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [filteredDepartments, setFilteredDepartments] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [collegeFilter, setCollegeFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isChangePasswordDialogOpen, setIsChangePasswordDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedRole, setSelectedRole] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [bulkUploadRole, setBulkUploadRole] = useState('super-admin');
  const [bulkUploadCollege, setBulkUploadCollege] = useState('');
  const [bulkUploadDepartment, setBulkUploadDepartment] = useState('');
  const [bulkUploadBatch, setBulkUploadBatch] = useState('no-batch');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [parsedUsers, setParsedUsers] = useState([]);
  const [showParsedData, setShowParsedData] = useState(false);
  const [showPasswords, setShowPasswords] = useState({});
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [changedPassword, setChangedPassword] = useState(null);
  const [isPasswordSuccessDialogOpen, setIsPasswordSuccessDialogOpen] = useState(false);
  const [userCreationResults, setUserCreationResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [skillsDialogOpen, setSkillsDialogOpen] = useState(false);
  const [selectedUserSkills, setSelectedUserSkills] = useState('');
  
  // Multi-delete states
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [isMultiDeleteDialogOpen, setIsMultiDeleteDialogOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  
  // Bulk upload dialog state
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  
  // Batch Mapping states
  const [isBatchMappingOpen, setIsBatchMappingOpen] = useState(false);
  const [batchMappingCollege, setBatchMappingCollege] = useState('');
  const [batchMappingBatch, setBatchMappingBatch] = useState('');
  const [batchMappingStudents, setBatchMappingStudents] = useState('');
  const [batchMappingFile, setBatchMappingFile] = useState(null);
  const [batchMappingResults, setBatchMappingResults] = useState([]);
  const [showBatchMappingResults, setShowBatchMappingResults] = useState(false);
  const [batchMappingLoading, setBatchMappingLoading] = useState(false);
  const [showTemplateHelp, setShowTemplateHelp] = useState(false);
  
  const { toast } = useToast();

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'student',
    college_id: '',
    department: '',
    batch: 'no-batch',
    student_id: '',
    admission_type: 'regular',
    joining_year: new Date().getFullYear(),
    final_year: new Date().getFullYear() + 4,
    phone: '',
    is_active: true,
    // Faculty-specific fields
    faculty_type: 'Internal',
    address: '',
    designation: '',
    technical_skills: '',
    languages_known: '',
    current_location: '',
    bank_account_number: '',
    bank_name: '',
    bank_ifsc: '',
    bank_branch_address: '',
    faculty_status: 'Available',
    payment_type: 'Monthly',
    pan_number: '',
    payment_amount: ''
  });

  useEffect(() => {
    fetchAllUsers();
    fetchColleges();
  }, []);

  // Fetch departments and batches when college changes
  useEffect(() => {
    if (formData.college_id && formData.role === 'student') {
      fetchDepartments(formData.college_id);
      fetchBatches(formData.college_id);
    } else {
      setDepartments([]);
      setBatches([]);
      setFormData(prev => ({ ...prev, department: '', batch: 'no-batch' }));
    }
  }, [formData.college_id, formData.role]);

  // Update filtered departments when departments change
  useEffect(() => {
    setFilteredDepartments(departments);
  }, [departments]);

  // Handle role changes - initialize year fields for students
  useEffect(() => {
    if (formData.role === 'student') {
      const currentYear = new Date().getFullYear();
      setFormData(prev => ({
        ...prev,
        joining_year: currentYear,
        final_year: currentYear + 4
      }));
    }
  }, [formData.role]);

  // Fetch departments and batches when college filter changes (for filtering purposes)
  useEffect(() => {
    if (collegeFilter !== 'all') {
      fetchDepartments(collegeFilter);
      fetchBatches(collegeFilter);
    } else {
      setFilteredDepartments([]);
      setBatches([]);
    }
  }, [collegeFilter]);

  // Fetch batches for bulk upload when college changes
  useEffect(() => {
    if (bulkUploadCollege && bulkUploadRole === 'student') {
      fetchBatches(bulkUploadCollege);
    } else {
      setBatches([]);
      setBulkUploadBatch('no-batch');
    }
  }, [bulkUploadCollege, bulkUploadRole]);

  // Debounce search term to prevent excessive filtering
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 150); // Reduced from 300ms for faster response

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Clear selection when filters change
  useEffect(() => {
    clearSelection();
  }, [roleFilter, collegeFilter, departmentFilter, batchFilter, statusFilter, selectedRole]);

  // Clear selection when search term changes
  useEffect(() => {
    clearSelection();
  }, [debouncedSearchTerm]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      // Request a high limit to get all users, or implement pagination
      const response = await apiService.getUsers({ limit: 1000, page: 1 });
      if (response.success) {
        setUsers(response.data);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to fetch users"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchAllUsers = async () => {
    try {
      setLoading(true);
      // Try to get all users without pagination
      const response = await apiService.getUsers({ limit: 10000, page: 1 });
      if (response.success) {
        setUsers(response.data);
      }
    } catch (error) {
      console.error('Error fetching all users:', error);
      // Fallback to regular fetch
      await fetchUsers();
    } finally {
      setLoading(false);
    }
  };

  const fetchColleges = async () => {
    try {
      const response = await apiService.getSuperAdminColleges();
      if (response.success) {
        setColleges(response.data.colleges || response.data || []);
      }
    } catch (error) {
      console.error('Error fetching colleges:', error);
      setColleges([]); // Set empty array as fallback
    }
  };

  const fetchDepartments = async (collegeId) => {
    try {
      setLoadingDepartments(true);
      const response = await apiService.getCollegeDepartments(collegeId);
      if (response.success) {
        setDepartments(response.data || []);
      } else {
        setDepartments([]);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
      setDepartments([]);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to fetch departments for the selected college"
      });
    } finally {
      setLoadingDepartments(false);
    }
  };

  const fetchBatches = async (collegeId) => {
    try {
      setLoadingBatches(true);
      const response = await apiService.getCollegeBatches(collegeId);
      if (response.success) {
        setBatches(response.data || []);
      } else {
        setBatches([]);
      }
    } catch (error) {
      console.error('Error fetching batches:', error);
      setBatches([]);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to fetch batches for the selected college"
      });
    } finally {
      setLoadingBatches(false);
    }
  };

  // Batch Mapping Functions
  const parseBatchMappingFile = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(e.target.result);
          const worksheet = workbook.getWorksheet(1);
          
          const rollNumbers = [];
          let isFirstRow = true;
          
          worksheet.eachRow((row, rowNumber) => {
            if (isFirstRow) {
              isFirstRow = false;
              return; // Skip header row
            }
            
            const rollNumber = row.getCell(1)?.value;
            if (rollNumber && String(rollNumber).trim()) {
              rollNumbers.push(String(rollNumber).trim().toUpperCase());
            }
          });
          
          resolve(rollNumbers);
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const parseBatchMappingText = (text) => {
    if (!text.trim()) return [];
    
    return text
      .split(',')
      .map(item => item.trim().toUpperCase())
      .filter(item => item.length > 0);
  };

  const handleBatchMapping = async () => {
    if (!batchMappingCollege || !batchMappingBatch) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select both college and batch"
      });
      return;
    }

    let rollNumbers = [];
    
    try {
      setBatchMappingLoading(true);
      
      if (batchMappingFile) {
        // Parse Excel file
        rollNumbers = await parseBatchMappingFile(batchMappingFile);
      } else if (batchMappingStudents.trim()) {
        // Parse text area
        rollNumbers = parseBatchMappingText(batchMappingStudents);
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please provide either an Excel file or comma-separated roll numbers"
        });
        return;
      }

      if (rollNumbers.length === 0) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "No valid roll numbers found"
        });
        return;
      }

      // Find students and update their batch
      const results = [];
      for (const rollNumber of rollNumbers) {
        try {
          // Find student by roll number
          const student = users.find(user => 
            user.role === 'student' && 
            user.student_id === rollNumber &&
            user.college_id === batchMappingCollege
          );

          if (student) {
            // Update student batch
            const response = await apiService.updateUser(student.id, {
              ...student,
              batch: batchMappingBatch
            });

            if (response.success) {
              results.push({
                success: true,
                rollNumber,
                student: student.name,
                message: `Successfully mapped to ${batchMappingBatch}`
              });
            } else {
              results.push({
                success: false,
                rollNumber,
                error: response.message || 'Failed to update batch'
              });
            }
          } else {
            results.push({
              success: false,
              rollNumber,
              error: 'Student not found in selected college'
            });
          }
        } catch (error) {
          results.push({
            success: false,
            rollNumber,
            error: error.message || 'Unknown error'
          });
        }
      }

      setBatchMappingResults(results);
      setShowBatchMappingResults(true);
      
      // Show summary toast
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;
      
      let message = `Successfully mapped ${successCount} students to ${batchMappingBatch}`;
      if (errorCount > 0) {
        message += `. ${errorCount} errors occurred. Check the results below for details.`;
      }
        
      toast({
        title: "Batch Mapping Complete",
        description: message
      });
      
      // Refresh user list
      fetchUsers();
      
    } catch (error) {
      console.error('Error in batch mapping:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to process batch mapping"
      });
    } finally {
      setBatchMappingLoading(false);
    }
  };

  const resetBatchMapping = () => {
    setBatchMappingCollege('');
    setBatchMappingBatch('');
    setBatchMappingStudents('');
    setBatchMappingFile(null);
    setBatchMappingResults([]);
    setShowBatchMappingResults(false);
    setBatches([]);
  };

  const handleAddUser = async () => {
    try {
      // Validate required fields
      if (!formData.name || !formData.email || !formData.role) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please fill in all required fields"
        });
        return;
      }
      
      // Validate college for non-super-admin and non-faculty users
      if (formData.role !== 'super-admin' && formData.role !== 'faculty' && !formData.college_id) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please select a college"
        });
        return;
      }
      
      // Validate department for students
      if (formData.role === 'student' && !formData.department) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please select a department for the student"
        });
        return;
      }
      
      // Validate student ID for students
      if (formData.role === 'student' && !formData.student_id) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Student ID (Roll Number) is required for students"
        });
        return;
      }
      
      // Validate year fields for students
      if (formData.role === 'student' && !formData.joining_year) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Joining Year is required for students"
        });
        return;
      }
      
      if (formData.role === 'student' && !formData.final_year) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Final Year is required for students"
        });
        return;
      }
      
      // Validate faculty-specific fields
      if (formData.role === 'faculty') {
        if (!formData.phone) {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Mobile number is required for faculty (will be used as password)"
          });
          return;
        }
        
        // Validate mobile number format (10 digits)
        const phoneRegex = /^[0-9]{10}$/;
        const cleanPhone = formData.phone.replace(/[^0-9]/g, '');
        if (!phoneRegex.test(cleanPhone)) {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Invalid mobile number format. Please enter a 10-digit number"
          });
          return;
        }
        
        // Validate payment amount
        if (!formData.payment_amount || parseFloat(formData.payment_amount) <= 0) {
          toast({
            variant: "destructive",
            title: "Error",
            description: `Payment amount is required for ${formData.payment_type === 'Monthly' ? 'monthly' : 'per day'} payment`
          });
          return;
        }
      }
      
      // Clean the data before sending to backend
      const cleanFormData = {
        ...formData,
        batch: formData.batch === 'no-batch' ? '' : formData.batch
      };
      
      const response = await apiService.createUser(cleanFormData);
      if (response.success) {
        const { data } = response;
        let message = "User added successfully";
        
        // Show generated credentials if available
        if (data && data.password) {
          if (formData.role === 'student' && data.student_id) {
            message = `Student created! Roll Number: ${data.student_id}, Password: ${data.password}`;
          } else if (formData.role === 'faculty') {
            message = `Faculty created! Email: ${formData.email}, Password: ${data.password} (Mobile Number)`;
          } else {
            message = `User created! Password: ${data.password}`;
          }
        }
        
        toast({
          title: "Success",
          description: message
        });
        setIsAddDialogOpen(false);
        resetForm();
        // Refresh users list to get updated plain_password
        fetchUsers();
      }
    } catch (error) {
      console.error('Error adding user:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.response?.data?.message || error.message || "Failed to add user"
      });
    }
  };

  const handleEditUser = async () => {
    try {
      // Clean the data before sending to backend
      const cleanFormData = {
        ...formData,
        batch: formData.batch === 'no-batch' ? '' : formData.batch
      };
      
      const response = await apiService.updateUser(selectedUser.id, cleanFormData);
      if (response.success) {
        toast({
          title: "Success",
          description: "User updated successfully"
        });
        setIsEditDialogOpen(false);
        setSelectedUser(null);
        resetForm();
        fetchUsers();
      }
    } catch (error) {
      console.error('Error updating user:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update user"
      });
    }
  };

  const handleDeleteUser = async (userId) => {
    try {
      const response = await apiService.deleteUser(userId);
      if (response.success) {
        toast({
          title: "Success",
          description: "User deleted successfully"
        });
        fetchUsers();
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete user"
      });
    }
  };

  // Multi-delete functions
  const handleSelectUser = (userId) => {
    setSelectedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const handleSelectAllUsers = () => {
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(user => user.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No users selected for deletion"
      });
      return;
    }

    try {
      setBulkDeleteLoading(true);
      const userIds = Array.from(selectedUsers);
      const results = [];
      
      // Delete users one by one
      for (const userId of userIds) {
        try {
          const response = await apiService.deleteUser(userId);
          if (response.success) {
            results.push({ success: true, userId });
          } else {
            results.push({ success: false, userId, error: response.message || 'Failed to delete' });
          }
        } catch (error) {
          results.push({ success: false, userId, error: error.message || 'Unknown error' });
        }
      }

      // Show results
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;
      
      if (successCount > 0) {
        toast({
          title: "Bulk Delete Complete",
          description: `Successfully deleted ${successCount} users${errorCount > 0 ? `. ${errorCount} errors occurred.` : ''}`
        });
      } else {
        toast({
          variant: "destructive",
          title: "Bulk Delete Failed",
          description: "Failed to delete any users. Check the console for details."
        });
      }

      // Log detailed results
      // console.log('Bulk delete results:', results);
      
      // Clear selection and refresh users
      setSelectedUsers(new Set());
      setIsMultiDeleteDialogOpen(false);
      fetchUsers();
      
    } catch (error) {
      console.error('Error in bulk delete:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to perform bulk delete operation"
      });
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const clearSelection = () => {
    setSelectedUsers(new Set());
  };

  const handleToggleStatus = async (userId) => {
    try {
      const response = await apiService.toggleUserStatus(userId);
      if (response.success) {
        toast({
          title: "Success",
          description: "User status updated successfully"
        });
        fetchUsers();
      }
    } catch (error) {
      console.error('Error toggling user status:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update user status"
      });
    }
  };

  const handleResetPassword = async (userId) => {
    try {
      const response = await apiService.patch(`/users/${userId}/reset-password`);
      if (response.success) {
        const { data } = response;
        let message = "Password reset successfully";
        
        if (data && data.password) {
          message = `Password reset! New password: ${data.password}`;
        }
        
        toast({
          title: "Success",
          description: message
        });
        fetchUsers();
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.response?.data?.message || "Failed to reset password"
      });
    }
  };

  const handleUpdateStudentYears = async () => {
    try {
      const response = await apiService.post('/users/update-student-years');
      if (response.success) {
        toast({
          title: "Success",
          description: response.data?.result || "Student years updated successfully"
        });
        fetchUsers(); // Refresh the user list to show updated years
      }
    } catch (error) {
      console.error('Error updating student years:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.response?.data?.message || "Failed to update student years"
      });
    }
  };

  // Password validation helper
  const validatePassword = (password) => {
    const validations = {
      minLength: password.length >= 8,
      hasUpperCase: /[A-Z]/.test(password),
      hasLowerCase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password)
    };
    
    const isValid = Object.values(validations).every(v => v === true);
    return { isValid, validations };
  };

  const handleChangePassword = async () => {
    try {
      if (!newPassword.trim()) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please enter a new password"
        });
        return;
      }

      // Client-side validation
      const { isValid, validations } = validatePassword(newPassword);
      if (!isValid) {
        const missing = [];
        if (!validations.minLength) missing.push("at least 8 characters");
        if (!validations.hasUpperCase) missing.push("one uppercase letter");
        if (!validations.hasLowerCase) missing.push("one lowercase letter");
        if (!validations.hasNumber) missing.push("one number");
        if (!validations.hasSpecialChar) missing.push("one special character (!@#$%^&*(),.?\":{}|<>)");
        
        toast({
          variant: "destructive",
          title: "Password Requirements Not Met",
          description: `Password must contain: ${missing.join(", ")}`
        });
        return;
      }

      const response = await apiService.patch(`/users/${selectedUser.id}/change-password`, {
        newPassword: newPassword.trim()
      });
      
      if (response.success) {
        const { data } = response;
        
        // Store the plain text password for display
        if (data && data.password) {
          setChangedPassword(data.password);
          setIsPasswordSuccessDialogOpen(true);
        } else {
          toast({
            title: "Success",
            description: "Password changed successfully"
          });
        }
        
        // Update the user's plain_password in the local state immediately
        if (response.data && response.data.password) {
          setUsers(prevUsers => 
            prevUsers.map(u => 
              u.id === selectedUser.id 
                ? { ...u, plain_password: response.data.password }
                : u
            )
          );
        }
        setIsChangePasswordDialogOpen(false);
        setNewPassword('');
        setShowNewPassword(false);
        setSelectedUser(null);
        fetchUsers();
      }
    } catch (error) {
      console.error('Error changing password:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.response?.data?.message || "Failed to change password"
      });
    }
  };

  const openChangePasswordDialog = (user) => {
    setSelectedUser(user);
    setNewPassword('');
    setShowNewPassword(false);
    setIsChangePasswordDialogOpen(true);
  };

  const handleBulkUpload = async () => {
    if (!uploadFile) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select a file to upload"
      });
      return;
    }

    if (bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment)) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select both college and department for student upload"
      });
      return;
    }

    try {
      setUploadLoading(true);
      
      // Show processing message
      toast({
        title: "Processing File",
        description: "Reading and validating Excel file...",
        duration: 3000
      });
      
      // Read and parse the Excel file
      const users = await parseExcelFile(uploadFile);
      
      if (users.length === 0) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "No valid data found in the uploaded file"
        });
        return;
      }

      // Store parsed users and show the data
      setParsedUsers(users);
      setShowParsedData(true);
      
      toast({
        title: "File Parsed Successfully",
        description: `Found ${users.length} users in the file. Review the data below and click "Create Users" to create them.`
      });
      
    } catch (error) {
      console.error('Error uploading file:', error);
      
      // Handle validation errors specifically
      if (error.message && error.message.includes('Validation errors found:')) {
        toast({
          variant: "destructive",
          title: "Validation Errors",
          description: "Please fix the errors in your Excel file and try again. Check the console for details.",
          duration: 8000
        });
        // Log detailed errors to console
        console.error('Detailed validation errors:', error.message);
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message || "Failed to parse file"
        });
      }
    } finally {
      setUploadLoading(false);
    }
  };

  const parseExcelFile = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      // Note: All cell values are automatically trimmed to remove leading/trailing whitespace
      // This prevents common errors caused by accidental spaces in Excel cells
      
      // Add timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        reader.abort();
        reject(new Error('File reading timeout. Please try again with a smaller file.'));
      }, 30000); // 30 second timeout
      
      reader.onload = async (e) => {
        try {
          clearTimeout(timeoutId); // Clear timeout on success
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(e.target.result);
          const worksheet = workbook.getWorksheet(1);
          
          const users = [];
          const errors = [];
          let isFirstRow = true;
          let rowNumber = 1;
          
          // Helper function to safely extract cell value
          const getCellValue = (cell) => {
            if (!cell) return '';
            
            let value = '';
            
            // Handle rich text objects
            if (cell.richText && Array.isArray(cell.richText)) {
              value = cell.richText.map(rt => rt.text).join('');
            }
            // Handle hyperlinks
            else if (cell.hyperlink) {
              value = cell.hyperlink.text || cell.hyperlink.address || '';
            }
            // Handle formula results
            else if (cell.result) {
              value = String(cell.result);
            }
            // Handle regular values
            else if (cell.value !== null && cell.value !== undefined) {
              value = String(cell.value);
            }
            
            // Always trim the value to remove leading/trailing whitespace
            return value.trim();
          };

          // Helper function to validate required fields
          const validateRequiredField = (value, fieldName, rowNum) => {
            if (!value || value === '') {
              errors.push(`Row ${rowNum}: ${fieldName} is required`);
              return false;
            }
            return true;
          };

          // Helper function to validate email format
          const validateEmail = (email, rowNum) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
              errors.push(`Row ${rowNum}: Invalid email format for ${email}`);
              return false;
            }
            return true;
          };

          // Helper function to validate year format
          const validateYear = (year, rowNum) => {
            const yearNum = parseInt(year);
            const currentYear = new Date().getFullYear();
            if (isNaN(yearNum) || yearNum < 2000 || yearNum > currentYear + 10) {
              errors.push(`Row ${rowNum}: Invalid year format. Year should be between 2000 and ${currentYear + 10}`);
              return false;
            }
            return true;
          };

          // Helper function to validate admission type
          const validateAdmissionType = (admissionType, rowNum) => {
            if (admissionType && admissionType.trim() !== '') {
              const validTypes = ['regular', 'lateral'];
              const normalizedType = admissionType.toLowerCase().trim();
              if (!validTypes.includes(normalizedType)) {
                errors.push(`Row ${rowNum}: Invalid admission type '${admissionType}'. Must be 'regular' or 'lateral' (case insensitive)`);
                return false;
              }
            }
            return true;
          };

          // Helper function to validate batch length
          const validateBatchLength = (batch, rowNum) => {
            if (batch && batch.length > 100) {
              errors.push(`Row ${rowNum}: Batch name is too long. Maximum 100 characters allowed.`);
              return false;
            }
            return true;
          };
          
          worksheet.eachRow((row, rowIndex) => {
            rowNumber = rowIndex;
            if (isFirstRow) {
              isFirstRow = false;
              return; // Skip header row
            }
            
            // console.log(`Processing row ${rowNumber}:`, {
            //   name: getCellValue(row.getCell(1)),
            //   email: getCellValue(row.getCell(2)),
            //   phone: getCellValue(row.getCell(3)),
            //   student_id: getCellValue(row.getCell(4)),
            //   admission_type: getCellValue(row.getCell(5)),
            //   batch: getCellValue(row.getCell(6)),
            //   joining_year: getCellValue(row.getCell(7)),
            //   final_year: getCellValue(row.getCell(8))
            // });
            
            if (bulkUploadRole === 'super-admin') {
              const name = getCellValue(row.getCell(1)).trim();
              const email = getCellValue(row.getCell(2)).trim();
              const phone = getCellValue(row.getCell(3)).trim();
              const password = getCellValue(row.getCell(4)).trim();
              
              // Validate required fields
              const isNameValid = validateRequiredField(name, 'Name', rowNumber);
              const isEmailValid = validateRequiredField(email, 'Email ID', rowNumber) && validateEmail(email, rowNumber);
              
              if (isNameValid && isEmailValid) {
                users.push({
                  name: name,
                  email: email,
                  phone: phone,
                  password: password,
                  role: 'super-admin',
                  is_active: true
                });
              }
            } else if (bulkUploadRole === 'student') {
              const name = getCellValue(row.getCell(1)).trim();
              const email = getCellValue(row.getCell(2)).trim();
              const phone = getCellValue(row.getCell(3)).trim();
              const student_id = getCellValue(row.getCell(4)).trim();
              const admission_type = getCellValue(row.getCell(5)).trim();
              const batch = getCellValue(row.getCell(6)).trim();
              const joining_year = getCellValue(row.getCell(7)).trim();
              const final_year = getCellValue(row.getCell(8)).trim();
              
              // Validate required fields
              const isNameValid = validateRequiredField(name, 'Name', rowNumber);
              const isEmailValid = validateRequiredField(email, 'Email ID', rowNumber) && validateEmail(email, rowNumber);
              const isStudentIdValid = validateRequiredField(student_id, 'Roll Number', rowNumber);
              const isJoiningYearValid = validateRequiredField(joining_year, 'Joining Year', rowNumber) && validateYear(joining_year, rowNumber);
              const isFinalYearValid = validateRequiredField(final_year, 'Ending Year', rowNumber) && validateYear(final_year, rowNumber);
              
              // Only validate admission type and batch if they have values
              const isAdmissionTypeValid = admission_type === '' || validateAdmissionType(admission_type, rowNumber);
              const isBatchValid = batch === '' || validateBatchLength(batch, rowNumber);
              
              // Validate year logic only if both years are valid
              let yearLogicValid = true;
              if (isJoiningYearValid && isFinalYearValid) {
                const joiningYearNum = parseInt(joining_year);
                const finalYearNum = parseInt(final_year);
                if (finalYearNum <= joiningYearNum) {
                  errors.push(`Row ${rowNumber}: Ending Year must be greater than Joining Year`);
                  yearLogicValid = false;
                }
              }
              
              if (isNameValid && isEmailValid && isStudentIdValid && isAdmissionTypeValid && isBatchValid && isJoiningYearValid && isFinalYearValid && yearLogicValid) {
                // console.log(`Row ${rowNumber} validation passed, adding user`);
                users.push({
                  name: name,
                  email: email,
                  phone: phone,
                  student_id: student_id,
                  admission_type: (admission_type || 'regular').toLowerCase(), // Default to regular if not specified, convert to lowercase
                  batch: batch || (bulkUploadBatch === 'no-batch' ? '' : bulkUploadBatch), // Use Excel batch or selected batch (already trimmed)
                  joining_year: parseInt(joining_year),
                  final_year: parseInt(final_year),
                  role: 'student',
                  college_id: bulkUploadCollege,
                  department: bulkUploadDepartment,
                  is_active: true
                });
              } else {
                // console.log(`Row ${rowNumber} validation failed:`, {
                //   isNameValid,
                //   isEmailValid,
                //   isStudentIdValid,
                //   isAdmissionTypeValid,
                //   isBatchValid,
                //   isJoiningYearValid,
                //   isFinalYearValid,
                //   yearLogicValid
                // });
              }
            }
          });
          
          // If there are validation errors, reject with detailed error messages
          if (errors.length > 0) {
            // console.log('Validation errors found:', errors);
            reject(new Error(`Validation errors found:\n${errors.join('\n')}`));
            return;
          }
          
          // console.log(`Parsing completed successfully. Found ${users.length} valid users:`, users);
          resolve(users);
        } catch (error) {
          clearTimeout(timeoutId); // Clear timeout on error
          reject(error);
        }
      };
      
      reader.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error('Failed to read file. Please check if the file is corrupted or try a different file.'));
      };
      
      reader.onabort = () => {
        reject(new Error('File reading was aborted due to timeout.'));
      };
      
      reader.readAsArrayBuffer(file);
    });
  };

  const processBulkUsers = async (users) => {
    const results = [];
    
    for (const user of users) {
      try {
        // Validate required fields
        if (!user.name || !user.email) {
          results.push({ success: false, user, error: 'Name and email are required' });
          continue;
        }
        
        // Create user via API
        const response = await apiService.createUser(user);
      if (response.success) {
          results.push({ success: true, user, data: response.data });
        } else {
          results.push({ success: false, user, error: response.message || 'Failed to create user' });
        }
      } catch (error) {
        results.push({ success: false, user, error: error.message || 'Unknown error' });
      }
    }
    
    return results;
  };

  const handleCreateUsers = async () => {
    if (parsedUsers.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No users to create"
      });
      return;
    }

    try {
      setUploadLoading(true);
      
      // Process users based on role
      const results = await processBulkUsers(parsedUsers);
      
      // Store results and show them
      setUserCreationResults(results);
      setShowResults(true);
      
      // Show summary toast
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;
      
      let message = `Successfully created ${successCount} users`;
      if (errorCount > 0) {
        message += `. ${errorCount} errors occurred. Check the results below for details.`;
      }
        
      toast({
        title: "Users Created",
        description: message
      });
      
      // Refresh user list
      fetchUsers();
      
    } catch (error) {
      console.error('Error creating users:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create users"
      });
    } finally {
      setUploadLoading(false);
    }
  };

  const handleResetAndUpload = () => {
    setParsedUsers([]);
    setShowParsedData(false);
    setUploadFile(null);
    setUserCreationResults([]);
    setShowResults(false);
    setBulkUploadBatch('no-batch');
  };

  const handleDownloadTemplate = async (role) => {
    try {
      if (role === 'student' && (!bulkUploadCollege || !bulkUploadDepartment)) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please select both college and department first"
        });
        return;
      }

      // Generate template based on role
      const templateData = generateTemplateData(role);
      
      // Create workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Users');
      
      // Add headers row
      const headerRow = worksheet.addRow(templateData.headers);
      
      // Style headers - make them bold and with background color
      headerRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, size: 12 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      
      // Add sample data row
      const sampleRow = worksheet.addRow(templateData.sampleData);
      
      // Style sample data row
      sampleRow.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      
      // Set column widths based on content
      const maxWidths = templateData.headers.map((header, index) => {
        const headerLength = header.length;
        const sampleLength = templateData.sampleData[index] ? templateData.sampleData[index].toString().length : 0;
        return Math.max(headerLength, sampleLength) + 3;
      });
      
      // Apply column widths
      maxWidths.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
      });
      
      // Generate and download file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
              const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${role}_template.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Success",
        description: `${role === 'super-admin' ? 'Super Admin' : 'Student'} template downloaded successfully`
      });
    } catch (error) {
      console.error('Error downloading template:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to download template"
      });
    }
  };

  const generateTemplateData = (role) => {
    if (role === 'super-admin') {
      return {
        headers: ['Name', 'Email ID', 'Contact', 'Password'],
        sampleData: ['John Doe', 'john@example.com', '+1234567890', 'password123']
      };
    } else if (role === 'student') {
      return {
        headers: ['Name *', 'Email ID *', 'Phone Number', 'Roll Number *', 'Admission Type', 'Batch', 'Joining Year', 'Ending Year'],
        sampleData: ['Jane Smith', 'jane.smith@example.com', '+91-9876543210', 'CS2024001', 'regular', '2024', '2024', '2028']
      };
    }
    return { headers: [], sampleData: [] };
  };

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      role: 'student',
      college_id: '',
      department: '',
      batch: 'no-batch',
      student_id: '',
      admission_type: 'regular',
      joining_year: new Date().getFullYear(),
      final_year: new Date().getFullYear() + 4,
      phone: '',
      is_active: true,
      // Faculty-specific fields
      faculty_type: 'Internal',
      address: '',
      designation: '',
      technical_skills: '',
      languages_known: '',
      current_location: '',
      bank_account_number: '',
      bank_name: '',
      bank_ifsc: '',
      bank_branch_address: '',
      faculty_status: 'Available',
      payment_type: 'Monthly',
      pan_number: '',
      payment_amount: ''
    });
    setDepartments([]);
    setBatches([]);
    setCollegeFilter('all');
    setDepartmentFilter('all');
    setBatchFilter('all');
  };

  const openEditDialog = (user) => {
    setSelectedUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      role: user.role,
      college_id: user.college_id,
      department: user.department || '',
      batch: user.batch || 'no-batch',
      student_id: user.student_id || '',
      admission_type: user.admission_type || 'regular',
      joining_year: user.joining_year || new Date().getFullYear(),
      final_year: user.final_year || new Date().getFullYear() + 4,
      phone: user.phone || '',
      is_active: user.is_active
    });
    
    // Fetch departments and batches if editing a student with a college
    if (user.role === 'student' && user.college_id) {
      fetchDepartments(user.college_id);
      fetchBatches(user.college_id);
    } else {
      setDepartments([]);
      setBatches([]);
    }
    
    setIsEditDialogOpen(true);
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                         user.email.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                         (user.student_id && user.student_id.toLowerCase().includes(debouncedSearchTerm.toLowerCase()));
    
    // If a role is selected, only show users of that role
    const matchesRole = selectedRole ? user.role === selectedRole : (roleFilter === 'all' || user.role === roleFilter);
    const matchesCollege = collegeFilter === 'all' || user.college_id === collegeFilter;
    const matchesDepartment = departmentFilter === 'all' || user.department === departmentFilter;
    const matchesBatch = batchFilter === 'all' || user.batch === batchFilter;
    const matchesStatus = statusFilter === 'all' || 
                         (statusFilter === 'active' && user.is_active) ||
                         (statusFilter === 'inactive' && !user.is_active);

    return matchesSearch && matchesRole && matchesCollege && matchesDepartment && matchesBatch && matchesStatus;
  });

  const getCollegeName = (collegeId) => {
    if (!colleges || !Array.isArray(colleges)) return 'Unknown College';
    const college = colleges.find(c => c.id === collegeId);
    return college ? college.name : 'Unknown College';
  };

  const getDepartmentName = (departmentName) => {
    return departmentName || 'Not specified';
  };

  // Helper function to format technical skills
  const formatTechnicalSkills = (skills) => {
    if (!skills || !skills.trim()) return [];
    return skills.split(',').map(skill => skill.trim()).filter(skill => skill.length > 0);
  };

  // Helper function to get missing faculty details
  const getMissingFacultyDetails = (user) => {
    const missing = [];
    if (!user.faculty_type) missing.push('Faculty Type');
    if (!user.address) missing.push('Address');
    if (!user.designation) missing.push('Designation');
    if (!user.technical_skills) missing.push('Technical Skills');
    if (!user.languages_known) missing.push('Languages Known');
    if (!user.current_location) missing.push('Current Location');
    if (!user.bank_account_number) missing.push('Bank Account Number');
    if (!user.bank_name) missing.push('Bank Name');
    if (!user.bank_ifsc) missing.push('IFSC Code');
    if (!user.bank_branch_address) missing.push('Branch Address');
    if (!user.pan_number) missing.push('PAN Number');
    if (!user.payment_amount) missing.push('Payment Amount');
    return missing;
  };

  // Helper function to check if field is empty
  const isEmpty = (value) => {
    return !value || (typeof value === 'string' && !value.trim());
  };

  // Function to open skills dialog
  const openSkillsDialog = (skills) => {
    setSelectedUserSkills(skills || '');
    setSkillsDialogOpen(true);
  };

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'super-admin': return 'bg-red-100 text-red-800';
      case 'college-admin': return 'bg-blue-100 text-blue-800';
      case 'faculty': return 'bg-green-100 text-green-800';
      case 'student': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getAcademicYearText = (year, joiningYear) => {
    if (!year || !joiningYear) return 'Not Set';
    const yearDiff = year - joiningYear;
    
    if (yearDiff < 0) return 'Invalid';
    
    switch (yearDiff) {
      case 0: return '1st Year';
      case 1: return '2nd Year';
      case 2: return '3rd Year';
      case 3: return '4th Year';
      case 4: return '5th Year';
      default: return `${yearDiff + 1}th Year`;
    }
  };

  const calculateCurrentYear = (joiningYear) => {
    if (!joiningYear) return null;
    
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1; // January is 0
    
    // Academic year starts from June (month 6)
    // If current month is June or later, use current year
    // If current month is before June, use previous year
    const academicYear = currentMonth >= 6 ? currentYear : currentYear - 1;
    
    return academicYear;
  };

  const getCurrentYearDisplay = (joiningYear, finalYear) => {
    if (!joiningYear || !finalYear) return 'Not Set';
    
    const currentYear = calculateCurrentYear(joiningYear);
    if (!currentYear) return 'Not Set';
    
    // Check if student has crossed final year
    if (currentYear > finalYear) {
      return 'Passout';
    }
    
    // Calculate academic year
    const yearDiff = currentYear - joiningYear;
    
    switch (yearDiff) {
      case 0: return '1st Year';
      case 1: return '2nd Year';
      case 2: return '3rd Year';
      case 3: return '4th Year';
      case 4: return '5th Year';
      default: return `${yearDiff + 1}th Year`;
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "Password copied to clipboard",
    });
  };

  const toggleUserPassword = (userId) => {
    setShowPasswords(prev => ({
      ...prev,
      [userId]: !prev[userId]
    }));
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-end gap-2">
          <Button onClick={fetchAllUsers} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh All
        </Button>
        <Button 
          variant="outline"
          onClick={() => setIsBulkUploadOpen(true)}
        >
          <Upload className="h-4 w-4 mr-2" />
          Bulk Upload
          </Button>
          <Dialog open={isBatchMappingOpen} onOpenChange={setIsBatchMappingOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Users className="h-4 w-4 mr-2" />
                Batch Mapping
              </Button>
            </DialogTrigger>
          </Dialog>
      </div>

      {/* Add User Dialog */}
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold">Add New User</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Create a new user account with appropriate role and permissions
                </DialogDescription>
              </DialogHeader>
  
              <div className="space-y-6">
                {/* Basic Information Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary border-b pb-2">Basic Information</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-sm font-medium">Full Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => {
                          const value = e.target.value;
                          setFormData({...formData, name: value});
                        }}
                        onBlur={(e) => {
                          const value = e.target.value.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
                          setFormData({...formData, name: value});
                        }}
                        placeholder="Enter full name"
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Name will be automatically formatted to Title Case
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-sm font-medium">Email Address *</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => {
                          const value = e.target.value;
                          setFormData({...formData, email: value});
                        }}
                        onBlur={(e) => {
                          const value = e.target.value.toLowerCase().trim();
                          setFormData({...formData, email: value});
                        }}
                        placeholder="Enter email address"
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Email will be automatically converted to lowercase
                      </p>
                    </div>
                  </div>
                </div>

                {/* Role and College Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary border-b pb-2">Role & Institution</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="role" className="text-sm font-medium">Role *</Label>
                      <Select 
                        value={formData.role || ''} 
                        onValueChange={(value) => setFormData({...formData, role: value})}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="student">Student</SelectItem>
                          <SelectItem value="faculty">Faculty</SelectItem>
                          <SelectItem value="college-admin">College Admin</SelectItem>
                          <SelectItem value="super-admin">Super Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {formData.role !== 'super-admin' && formData.role !== 'faculty' && (
                      <div className="space-y-2">
                        <Label htmlFor="college" className="text-sm font-medium">College *</Label>
                        <Select 
                          value={formData.college_id || ''} 
                          onValueChange={(value) => setFormData({...formData, college_id: value})}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select college" />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.isArray(colleges) && colleges.filter(college => college?.id != null).map(college => (
                              <SelectItem key={college.id} value={college.id.toString()}>
                                {college.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {formData.role === 'student' && formData.college_id && loadingDepartments && (
                          <div className="text-xs text-muted-foreground mt-1 flex items-center">
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-2"></div>
                            Loading departments for {colleges.find(c => c.id === formData.college_id)?.name}...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Student Specific Fields */}
                {formData.role === 'student' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-primary border-b pb-2">Student Details</h3>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> Student roll numbers will be automatically stored in CAPS format for consistency.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="department" className="text-sm font-medium">Department *</Label>
                        <Select 
                          value={formData.department || ''} 
                          onValueChange={(value) => setFormData({...formData, department: value})}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select department" />
                          </SelectTrigger>
                          <SelectContent>
                            {loadingDepartments ? (
                              <SelectItem value="loading" disabled>Loading departments...</SelectItem>
                            ) : departments.length === 0 ? (
                              <SelectItem value="no-departments" disabled>No departments found for this college</SelectItem>
                            ) : (
                              departments.map(dept => (
                                <SelectItem key={dept.id} value={dept.name}>
                                  {dept.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="joining_year" className="text-sm font-medium">Joining Year *</Label>
                        <Select 
                          value={formData.joining_year?.toString() || ''} 
                          onValueChange={(value) => {
                            const joiningYear = parseInt(value);
                            setFormData({
                              ...formData, 
                              joining_year: joiningYear,
                              final_year: joiningYear + 4 // Automatically set final year to 4 years later
                            });
                          }}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select joining year" />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 10 }, (_, i) => {
                              const year = new Date().getFullYear() - 5 + i;
                              return (
                                <SelectItem key={year} value={year.toString()}>
                                  {year} - {year + 1}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          Academic year when student joined (cycle starts from June). Final year will be automatically set to {formData.joining_year ? formData.joining_year + 4 : 'joining year + 4'}.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="final_year" className="text-sm font-medium">Final Year *</Label>
                        <Select 
                          value={formData.final_year?.toString() || ''} 
                          onValueChange={(value) => setFormData({...formData, final_year: parseInt(value)})}
                          disabled={!formData.joining_year} // Disable if joining year not selected
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder={formData.joining_year ? "Select final year" : "Select joining year first"} />
                          </SelectTrigger>
                          <SelectContent>
                            {formData.joining_year ? (
                              // Generate years based on selected joining year
                              Array.from({ length: 8 }, (_, i) => {
                                const year = formData.joining_year + i;
                                return (
                                  <SelectItem key={year} value={year.toString()}>
                                    {year} - {year + 1}
                                  </SelectItem>
                                );
                              })
                            ) : (
                              // Show message if joining year not selected
                              <SelectItem value="" disabled>
                                Please select joining year first
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formData.joining_year 
                            ? `Expected completion year (based on joining year ${formData.joining_year})`
                            : "Expected completion year (select joining year first)"
                          }
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="admission_type" className="text-sm font-medium">Admission Type *</Label>
                        <Select 
                          value={formData.admission_type} 
                          onValueChange={(value) => {
                            setFormData({
                              ...formData, 
                              admission_type: value,
                              // For lateral students, adjust years accordingly
                              joining_year: value === 'lateral' ? formData.joining_year + 1 : formData.joining_year,
                              final_year: value === 'lateral' ? formData.final_year + 1 : formData.final_year
                            });
                          }}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select admission type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="regular">Regular</SelectItem>
                            <SelectItem value="lateral">Lateral</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          Lateral students get +1 year added to their joining year for academic calculations
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="student_id" className="text-sm font-medium">Student ID (Roll Number) *</Label>
                        <Input
                          id="student_id"
                          value={formData.student_id}
                          onChange={(e) => {
                            const value = e.target.value.toUpperCase();
                            setFormData({...formData, student_id: value});
                          }}
                          onBlur={(e) => {
                            const value = e.target.value.toUpperCase();
                            setFormData({...formData, student_id: value});
                          }}
                          placeholder="Enter roll number (will be used as password)"
                          required
                          className="h-10"
                          maxLength={50}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Roll number is mandatory for students and will be used as their login password. Will be stored in CAPS.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="batch" className="text-sm font-medium">Batch</Label>
                        <Select 
                          value={formData.batch || 'no-batch'} 
                          onValueChange={(value) => setFormData({...formData, batch: value === 'no-batch' ? '' : value})}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select batch" />
                          </SelectTrigger>
                          <SelectContent>
                            {loadingBatches ? (
                              <SelectItem value="loading" disabled>Loading batches...</SelectItem>
                            ) : batches.length === 0 ? (
                              <SelectItem value="no-batches" disabled>No batches found for this college</SelectItem>
                            ) : (
                              <>
                                <SelectItem value="no-batch">No batch (optional)</SelectItem>
                                {batches.map(batch => (
                                  <SelectItem key={batch.id} value={batch.name}>
                                    {batch.name} ({batch.code})
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {loadingBatches ? 'Loading available batches...' : 
                           batches.length === 0 ? 'No batches available for this college' : 
                           'Select from available batches or leave empty'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Faculty Specific Fields */}
                {formData.role === 'faculty' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-primary border-b pb-2">Faculty Details</h3>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> Mobile number will be used as the password for faculty login.
                      </p>
                    </div>
                    
                    {/* Basic Faculty Information */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="text-sm font-medium">Mobile Number *</Label>
                        <Input
                          id="phone"
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                            setFormData({...formData, phone: value});
                          }}
                          placeholder="Enter 10-digit mobile number"
                          className="h-10"
                          maxLength={10}
                          required
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          This will be used as the password for faculty login
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="faculty_type" className="text-sm font-medium">Faculty Type *</Label>
                        <Select 
                          value={formData.faculty_type || 'Internal'} 
                          onValueChange={(value) => setFormData({...formData, faculty_type: value})}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select faculty type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Internal">Internal</SelectItem>
                            <SelectItem value="Freelancer">Freelancer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="designation" className="text-sm font-medium">Designation</Label>
                        <Input
                          id="designation"
                          value={formData.designation}
                          onChange={(e) => setFormData({...formData, designation: e.target.value})}
                          placeholder="e.g., Professor, Assistant Professor"
                          className="h-10"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="current_location" className="text-sm font-medium">Current Location</Label>
                        <Input
                          id="current_location"
                          value={formData.current_location}
                          onChange={(e) => setFormData({...formData, current_location: e.target.value})}
                          placeholder="Enter current location"
                          className="h-10"
                        />
                      </div>
                    </div>
                    
                    {/* Address */}
                    <div className="space-y-2">
                      <Label htmlFor="address" className="text-sm font-medium">Address</Label>
                      <Textarea
                        id="address"
                        value={formData.address}
                        onChange={(e) => setFormData({...formData, address: e.target.value})}
                        placeholder="Enter full address"
                        rows={3}
                        className="resize-none"
                      />
                    </div>
                    
                    {/* Skills and Languages */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="technical_skills" className="text-sm font-medium">Technical Skills</Label>
                        <Textarea
                          id="technical_skills"
                          value={formData.technical_skills}
                          onChange={(e) => setFormData({...formData, technical_skills: e.target.value})}
                          placeholder="e.g., JavaScript, Python, React, Node.js (comma-separated)"
                          rows={3}
                          className="resize-none"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="languages_known" className="text-sm font-medium">Languages Known</Label>
                        <Textarea
                          id="languages_known"
                          value={formData.languages_known}
                          onChange={(e) => setFormData({...formData, languages_known: e.target.value})}
                          placeholder="e.g., English, Hindi, Tamil (comma-separated)"
                          rows={3}
                          className="resize-none"
                        />
                      </div>
                    </div>
                    
                    {/* Bank Details */}
                    <div className="space-y-4">
                      <h4 className="text-md font-semibold text-primary border-b pb-2">Bank Details</h4>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                        <div className="space-y-2">
                          <Label htmlFor="bank_account_number" className="text-sm font-medium">Account Number</Label>
                          <Input
                            id="bank_account_number"
                            value={formData.bank_account_number}
                            onChange={(e) => setFormData({...formData, bank_account_number: e.target.value})}
                            placeholder="Enter bank account number"
                            className="h-10"
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="bank_name" className="text-sm font-medium">Bank Name</Label>
                          <Input
                            id="bank_name"
                            value={formData.bank_name}
                            onChange={(e) => setFormData({...formData, bank_name: e.target.value})}
                            placeholder="Enter bank name"
                            className="h-10"
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="bank_ifsc" className="text-sm font-medium">IFSC Code</Label>
                          <Input
                            id="bank_ifsc"
                            value={formData.bank_ifsc}
                            onChange={(e) => setFormData({...formData, bank_ifsc: e.target.value.toUpperCase()})}
                            placeholder="Enter IFSC code"
                            className="h-10"
                            maxLength={11}
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="bank_branch_address" className="text-sm font-medium">Branch Address</Label>
                          <Textarea
                            id="bank_branch_address"
                            value={formData.bank_branch_address}
                            onChange={(e) => setFormData({...formData, bank_branch_address: e.target.value})}
                            placeholder="Enter branch address"
                            rows={2}
                            className="resize-none"
                          />
                        </div>
                      </div>
                    </div>
                    
                    {/* Status and Payment */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="faculty_status" className="text-sm font-medium">Status *</Label>
                        <Select 
                          value={formData.faculty_status || 'Available'} 
                          onValueChange={(value) => setFormData({...formData, faculty_status: value})}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Available">Available</SelectItem>
                            <SelectItem value="Occupied">Occupied</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          Default: Available
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="payment_type" className="text-sm font-medium">Payment Type *</Label>
                        <Select 
                          value={formData.payment_type || 'Monthly'} 
                          onValueChange={(value) => setFormData({...formData, payment_type: value})}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select payment type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Monthly">Monthly</SelectItem>
                            <SelectItem value="Per Day">Per Day</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          Default: Monthly
                        </p>
                      </div>
                    </div>
                    
                    {/* PAN Number and Payment Amount */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="pan_number" className="text-sm font-medium">PAN Number</Label>
                        <Input
                          id="pan_number"
                          value={formData.pan_number}
                          onChange={(e) => {
                            const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
                            setFormData({...formData, pan_number: value});
                          }}
                          placeholder="ABCDE1234F"
                          className="h-10"
                          maxLength={10}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Format: ABCDE1234F (5 letters, 4 digits, 1 letter)
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="payment_amount" className="text-sm font-medium">
                          Payment Amount ({formData.payment_type === 'Monthly' ? 'Monthly' : 'Per Day'}) *
                        </Label>
                        <Input
                          id="payment_amount"
                          type="number"
                          value={formData.payment_amount}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9.]/g, '');
                            setFormData({...formData, payment_amount: value});
                          }}
                          placeholder={formData.payment_type === 'Monthly' 
                            ? 'Enter monthly payment amount (e.g., 50000)' 
                            : 'Enter per day payment amount (e.g., 2000)'}
                          className="h-10"
                          min="0"
                          step="0.01"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          {formData.payment_type === 'Monthly' 
                            ? 'Enter the monthly payment amount in INR' 
                            : 'Enter the per day payment amount in INR'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Additional Information Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary border-b pb-2">Additional Information</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                    {formData.role !== 'faculty' && (
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="text-sm font-medium">Phone Number</Label>
                        <Input
                          id="phone"
                          value={formData.phone}
                          onChange={(e) => setFormData({...formData, phone: e.target.value})}
                          placeholder="Enter phone number"
                          className="h-10"
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="is_active" className="text-sm font-medium">Account Status</Label>
                      <div className="flex items-center space-x-3 pt-2">
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="is_active"
                            checked={formData.is_active}
                            onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                            className="rounded border-gray-300 text-primary focus:ring-primary"
                          />
                          <Label htmlFor="is_active" className="text-sm">Active Account</Label>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Active accounts can log in immediately. Inactive accounts are suspended.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t">
                  <Button onClick={handleAddUser} className="flex-1 h-11 text-base font-medium">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Create User
                  </Button>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="flex-1 h-11 text-base font-medium">
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

      <div className="space-y-4">
          {!selectedRole ? (
            // Role Selection View
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Users className="h-5 w-5" />
                    <span>User Roles</span>
                  </div>
                  <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add User
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Super Admin Card */}
                  <Card 
                    className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105 border-2 hover:border-red-200"
                    onClick={() => setSelectedRole('super-admin')}
                  >
                    <CardHeader className="text-center pb-3">
                      <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Crown className="h-8 w-8" />
                      </div>
                      <CardTitle className="text-lg">Super Admin</CardTitle>
                      <CardDescription>
                        {users.filter(u => u.role === 'super-admin').length} users
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                      <p className="text-sm text-muted-foreground">
                        System administrators with full access
                      </p>
                    </CardContent>
                  </Card>

                  {/* College Admin Card */}
                  <Card 
                    className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105 border-2 hover:border-blue-200"
                    onClick={() => setSelectedRole('college-admin')}
                  >
                    <CardHeader className="text-center pb-3">
                      <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Building className="h-8 w-8" />
                      </div>
                      <CardTitle className="text-lg">College Admin</CardTitle>
                      <CardDescription>
                        {users.filter(u => u.role === 'college-admin').length} users
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                      <p className="text-sm text-muted-foreground">
                        College-level administrators
                      </p>
                    </CardContent>
                  </Card>

                  {/* Faculty Card */}
                  <Card 
                    className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105 border-2 hover:border-green-200"
                    onClick={() => setSelectedRole('faculty')}
                  >
                    <CardHeader className="text-center pb-3">
                      <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                        <GraduationCap className="h-8 w-8" />
                      </div>
                      <CardTitle className="text-lg">Faculty</CardTitle>
                      <CardDescription>
                        {users.filter(u => u.role === 'faculty').length} users
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                      <p className="text-sm text-muted-foreground">
                        Teaching staff and instructors
                      </p>
                    </CardContent>
                  </Card>

                  {/* Student Card */}
                  <Card 
                    className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105 border-2 hover:border-purple-200"
                    onClick={() => setSelectedRole('student')}
                  >
                    <CardHeader className="text-center pb-3">
                      <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Users className="h-8 w-8" />
                      </div>
                      <CardTitle className="text-lg">Students</CardTitle>
                      <CardDescription>
                        {users.filter(u => u.role === 'student').length} users
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                      <p className="text-sm text-muted-foreground">
                        Enrolled students
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          ) : (
            // Role-Specific User List View
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setSelectedRole(null)}
                      className="p-0 h-auto"
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Back to Roles
                    </Button>
                    <div className="flex items-center space-x-2">
                      {selectedRole === 'super-admin' && <Crown className="h-5 w-5 text-red-600" />}
                      {selectedRole === 'college-admin' && <Building className="h-5 w-5 text-blue-600" />}
                      {selectedRole === 'faculty' && <GraduationCap className="h-5 w-5 text-green-600" />}
                      {selectedRole === 'student' && <Users className="h-5 w-5 text-purple-600" />}
                      <span className="capitalize">
                        {selectedRole === 'super-admin' ? 'Super Administrators' : 
                         selectedRole === 'college-admin' ? 'College Administrators' : 
                         selectedRole === 'faculty' ? 'Faculty Members' : 
                         'Students'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Add {selectedRole === 'student' ? 'Student' : selectedRole === 'faculty' ? 'Faculty' : selectedRole === 'college-admin' ? 'College Admin' : 'Super Admin'}
                    </Button>
                  </div>
                </CardTitle>
                <div className="text-sm text-muted-foreground mb-4">
                  <div className="flex items-center justify-between mt-4">
                    <div className="flex items-center space-x-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={`Search ${selectedRole === 'super-admin' ? 'super administrators' : selectedRole.replace('-', ' ')} users...`}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 max-w-sm"
                    />
                  </div>
                    {selectedRole !== 'super-admin' && (
                      <Select value={collegeFilter} onValueChange={(value) => {
                        setCollegeFilter(value);
                        setDepartmentFilter('all');
                        setBatchFilter('all');
                      }}>
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="Filter by college" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Colleges</SelectItem>
                          {colleges.filter(college => college?.id != null).map(college => (
                            <SelectItem key={college.id} value={college.id.toString()}>
                              {college.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                                          {selectedRole === 'student' && collegeFilter !== 'all' && (
                        <Select value={departmentFilter} onValueChange={(value) => {
                          setDepartmentFilter(value);
                          setBatchFilter('all');
                        }}>
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Filter by department" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Departments</SelectItem>
                            {filteredDepartments.map(dept => (
                              <SelectItem key={dept.id} value={dept.name}>
                                {dept.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {selectedRole === 'student' && collegeFilter !== 'all' && (
                        <Select value={batchFilter} onValueChange={(value) => {
                          setBatchFilter(value);
                          setDepartmentFilter('all');
                        }}>
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Filter by batch" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Batches</SelectItem>
                            {batches.map(batch => (
                              <SelectItem key={batch.id} value={batch.name}>
                                {batch.name} ({batch.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                  </div>
                  
                  {/* Multi-delete controls */}
                  {filteredUsers.length > 0 && (
                    <div className="flex items-center space-x-3 mt-4 p-3 bg-muted/30 rounded-lg border">
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleSelectAllUsers}
                          className="h-8 px-3"
                        >
                          {selectedUsers.size === filteredUsers.length ? (
                            <>
                              <CheckSquare className="h-4 w-4 mr-2" />
                              Deselect All
                            </>
                          ) : (
                            <>
                              <Square className="h-4 w-4 mr-2" />
                              Select All
                            </>
                          )}
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          {selectedUsers.size} of {filteredUsers.length} users selected
                        </span>
                      </div>
                      
                      {selectedUsers.size > 0 && (
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={clearSelection}
                            className="h-8 px-3"
                          >
                            Clear Selection
                          </Button>
                          <AlertDialog open={isMultiDeleteDialogOpen} onOpenChange={setIsMultiDeleteDialogOpen}>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="h-8 px-3"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete Selected ({selectedUsers.size})
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Multiple Users</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete {selectedUsers.size} selected users? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction 
                                  onClick={handleBulkDelete}
                                  disabled={bulkDeleteLoading}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  {bulkDeleteLoading ? (
                                    <>
                                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                      Deleting...
                                    </>
                                  ) : (
                                    `Delete ${selectedUsers.size} Users`
                                  )}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </div>
                    )}
                </div>
                </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center items-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <>

                  
                  <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="text-left p-3 font-medium">
                                <div className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    checked={selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
                                    onChange={handleSelectAllUsers}
                                    className="rounded border-gray-300 text-primary focus:ring-primary"
                                  />
                                  <span>Select</span>
                                </div>
                              </th>
                              <th className="text-left p-3 font-medium">User</th>
                              <th className="text-left p-3 font-medium">Status</th>
                              <th className="text-left p-3 font-medium">Contact</th>
                              {selectedRole !== 'super-admin' && (
                                <>
                                  {selectedRole === 'faculty' ? (
                                    <>
                                      <th className="text-left p-3 font-medium">Faculty Type</th>
                                      <th className="text-left p-3 font-medium">Technical Skills</th>
                                      <th className="text-left p-3 font-medium">Payment Type</th>
                                      <th className="text-left p-3 font-medium">Amount</th>
                                    </>
                                  ) : (
                                    <>
                                      <th className="text-left p-3 font-medium">College</th>
                                      <th className="text-left p-3 font-medium">Department</th>
                                      <th className="text-left p-3 font-medium">Batch</th>
                                      {selectedRole === 'student' && (
                                        <>
                                          <th className="text-left p-3 font-medium">Student ID</th>
                                          <th className="text-left p-3 font-medium">Current Year</th>
                                        </>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                              <th className="text-left p-3 font-medium">Password</th>
                              <th className="text-left p-3 font-medium">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                  {filteredUsers.map(user => {
                              const missingDetails = user.role === 'faculty' ? getMissingFacultyDetails(user) : [];
                              const hasMissingDetails = missingDetails.length > 0;
                              
                              return (
                              <tr 
                                key={user.id} 
                                className={`border-b hover:bg-muted/30 ${hasMissingDetails ? 'relative' : ''}`}
                                title={hasMissingDetails ? `Missing details: ${missingDetails.join(', ')}` : ''}
                              >
                                <td className="p-3">
                                  <div className="flex items-center justify-center">
                                    <input
                                      type="checkbox"
                                      checked={selectedUsers.has(user.id)}
                                      onChange={() => handleSelectUser(user.id)}
                                      className="rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                  </div>
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center space-x-3">
                                    {user.role === 'faculty' ? (
                                      (() => {
                                        const missingDetails = getMissingFacultyDetails(user);
                                        const hasAllDetails = missingDetails.length === 0;
                                        
                                        return (
                                          <div 
                                            className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                              hasAllDetails ? 'bg-green-500' : 'bg-red-500'
                                            }`}
                                            title={hasAllDetails 
                                              ? 'All details filled' 
                                              : `Missing details: ${missingDetails.join(', ')}`}
                                          >
                                            {hasAllDetails ? (
                                              <div className="w-3 h-3 bg-white rounded-full"></div>
                                            ) : (
                                              <AlertCircle className="h-4 w-4 text-white" />
                                            )}
                                          </div>
                                        );
                                      })()
                                    ) : (
                                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                        user.role === 'super-admin' ? 'bg-red-100 text-red-600' :
                                        user.role === 'college-admin' ? 'bg-blue-100 text-blue-600' :
                                        user.role === 'faculty' ? 'bg-green-100 text-green-600' :
                                        user.role === 'student' ? 'bg-purple-100 text-purple-600' :
                                        'bg-gray-100 text-gray-600'
                                      }`}>
                                        {user.role === 'super-admin' ? <Crown className="h-4 w-4" /> :
                                         user.role === 'college-admin' ? <Building className="h-4 w-4" /> :
                                         user.role === 'faculty' ? <GraduationCap className="h-4 w-4" /> :
                                         user.role === 'student' ? <Users className="h-4 w-4" /> :
                                         <User className="h-4 w-4" />}
                                      </div>
                                    )}
                                    <div>
                                      <div className="font-medium">{user.name}</div>
                                      <div className="text-sm text-muted-foreground">{user.email}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="p-3">
                                  {user.role === 'faculty' ? (
                                    <Badge variant={user.faculty_status === 'Available' ? "default" : "secondary"}>
                                      {user.faculty_status || 'Available'}
                                    </Badge>
                                  ) : (
                                    <Badge variant={user.is_active ? "default" : "secondary"}>
                                      {user.is_active ? "Active" : "Inactive"}
                                    </Badge>
                                  )}
                                </td>
                                <td className="p-3">
                                  <div className="text-sm">
                                    {user.phone || 'Not provided'}
                          </div>
                                </td>
                                {selectedRole !== 'super-admin' && (
                                  <>
                                    {selectedRole === 'faculty' ? (
                                      <>
                                        {/* Faculty Type */}
                                        <td className="p-3">
                                          <div className={`text-sm ${isEmpty(user.faculty_type) ? 'text-muted-foreground italic' : ''}`}>
                                            {isEmpty(user.faculty_type) ? (
                                              <span 
                                                className="flex items-center gap-1 text-orange-600 cursor-help"
                                                title="Missing: Faculty Type"
                                              >
                                                <AlertCircle className="h-3 w-3" />
                                                Not set
                                              </span>
                                            ) : (
                                              user.faculty_type
                                            )}
                                          </div>
                                        </td>
                                        
                                        {/* Technical Skills */}
                                        <td className="p-3">
                                          {isEmpty(user.technical_skills) ? (
                                            <span 
                                              className="flex items-center gap-1 text-sm text-orange-600 cursor-help"
                                              title="Missing: Technical Skills"
                                            >
                                              <AlertCircle className="h-3 w-3" />
                                              Not set
                                            </span>
                                          ) : (
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm text-muted-foreground">
                                                {formatTechnicalSkills(user.technical_skills).length} skill(s)
                                              </span>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openSkillsDialog(user.technical_skills)}
                                                className="h-6 w-6 p-0"
                                                title="View Technical Skills"
                                              >
                                                <Info className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          )}
                                        </td>
                                        
                                        {/* Payment Type */}
                                        <td className="p-3">
                                          <div className={`text-sm ${isEmpty(user.payment_type) ? 'text-muted-foreground italic' : ''}`}>
                                            {isEmpty(user.payment_type) ? (
                                              <span 
                                                className="flex items-center gap-1 text-orange-600 cursor-help"
                                                title="Missing: Payment Type"
                                              >
                                                <AlertCircle className="h-3 w-3" />
                                                Not set
                                              </span>
                                            ) : (
                                              user.payment_type
                                            )}
                                          </div>
                                        </td>
                                        
                                        {/* Payment Amount */}
                                        <td className="p-3">
                                          <div className={`text-sm ${isEmpty(user.payment_amount) ? 'text-muted-foreground italic' : 'font-medium'}`}>
                                            {isEmpty(user.payment_amount) ? (
                                              <span 
                                                className="flex items-center gap-1 text-orange-600 cursor-help"
                                                title="Missing: Payment Amount"
                                              >
                                                <AlertCircle className="h-3 w-3" />
                                                Not set
                                              </span>
                                            ) : (
                                              `₹${parseFloat(user.payment_amount).toLocaleString('en-IN')}`
                                            )}
                                          </div>
                                        </td>
                                      </>
                                    ) : (
                                      <>
                                        <td className="p-3">
                                          <div className="flex items-center text-sm">
                                            <Building className="h-3 w-3 mr-1 text-muted-foreground" />
                                            {getCollegeName(user.college_id)}
                                          </div>
                                        </td>
                                        <td className="p-3">
                                          <div className="text-sm text-muted-foreground">
                                            {getDepartmentName(user.department)}
                                          </div>
                                        </td>
                                        <td className="p-3">
                                          <div className="text-sm text-muted-foreground">
                                            {user.batch || 'Not set'}
                                          </div>
                                        </td>
                                        {selectedRole === 'student' && (
                                          <>
                                            <td className="p-3">
                                              <div className="text-sm font-medium">
                                                {user.student_id || 'Not set'}
                                              </div>
                                            </td>
                                            <td className="p-3">
                                              <div className="text-sm text-muted-foreground">
                                                {user.joining_year ? getCurrentYearDisplay(user.joining_year, user.final_year) : 'Not set'}
                                              </div>
                                            </td>
                                          </>
                                        )}
                                      </>
                                    )}
                                  </>
                                )}
                                <td className="p-3">
                                <div className="flex items-center space-x-2">
                                <code className="text-xs bg-muted px-2 py-1 rounded">
                                      {showPasswords[user.id] 
                                        ? (() => {
                                            // Always prioritize plain_password if it exists
                                            if (user.plain_password) {
                                              return user.plain_password;
                                            }
                                            // If no plain_password, check if password is a hash
                                            if (user.password) {
                                              const isHash = user.password.startsWith('$2a$') || 
                                                           user.password.startsWith('$2b$') || 
                                                           user.password.startsWith('$2y$') ||
                                                           user.password.length > 60;
                                              if (isHash) {
                                                return <span className="text-orange-600 italic text-[10px]">Encrypted - Change password to view</span>;
                                              }
                                              // If it's not a hash and short, might be plain text (legacy)
                                              return user.password;
                                            }
                                            return 'Not set';
                                          })()
                                        : '••••••••'}
                                  </code>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                      onClick={() => toggleUserPassword(user.id)}
                                    className="h-6 w-6 p-0"
                                      title={showPasswords[user.id] ? 'Hide Password' : 'Show Password'}
                                  >
                                      {showPasswords[user.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                  </Button>
                                    {showPasswords[user.id] && user.plain_password && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                        onClick={() => copyToClipboard(user.plain_password)}
                                    className="h-6 w-6 p-0"
                                        title="Copy Password to Clipboard"
                                  >
                                        <Copy className="h-3 w-3" />
                                  </Button>
                          )}
                        </div>
                                </td>
                                <td className="p-3">
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleStatus(user.id)}
                                      title={user.is_active ? 'Deactivate User' : 'Activate User'}
                        >
                          {user.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(user)}
                                      title="Edit User"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openChangePasswordDialog(user)}
                                      title="Change Password"
                                    >
                                      <Key className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                                        <Button 
                                          variant="outline" 
                                          size="sm"
                                          title="Delete User"
                                        >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete User</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete {user.name}? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteUser(user.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                                </td>
                              </tr>
                            );
                          })}
                          </tbody>
                        </table>
                        {filteredUsers.length === 0 && (
                          <div className="text-center py-8 text-muted-foreground">
                            No {selectedRole.replace('-', ' ')} users found matching your criteria.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
        </Card>
            )}
              </div>

      {/* Edit User Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Edit User</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update user information and permissions
            </DialogDescription>
          </DialogHeader>
                    <div className="space-y-6">
            {/* Basic Information Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary border-b pb-2">Basic Information</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                <div className="space-y-2">
                  <Label htmlFor="edit-name" className="text-sm font-medium">Full Name *</Label>
                  <Input
                    id="edit-name"
                    value={formData.name}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({...formData, name: value});
                    }}
                    onBlur={(e) => {
                      const value = e.target.value.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
                      setFormData({...formData, name: value});
                    }}
                    placeholder="Enter full name"
                    className="h-10"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Name will be automatically formatted to Title Case
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-email" className="text-sm font-medium">Email Address *</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({...formData, email: value});
                    }}
                    onBlur={(e) => {
                      const value = e.target.value.toLowerCase().trim();
                      setFormData({...formData, email: value});
                    }}
                    placeholder="Enter email address"
                    className="h-10"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Email will be automatically converted to lowercase
                  </p>
                </div>
              </div>
            </div>

            {/* Role and College Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary border-b pb-2">Role & Institution</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                <div className="space-y-2">
                  <Label htmlFor="edit-role" className="text-sm font-medium">User Role *</Label>
                  <Select value={formData.role} onValueChange={(value) => setFormData({...formData, role: value})}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select user role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="student">Student</SelectItem>
                      <SelectItem value="faculty">Faculty</SelectItem>
                      <SelectItem value="college-admin">College Admin</SelectItem>
                      <SelectItem value="super-admin">Super Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-college" className="text-sm font-medium">College *</Label>
                  <Select value={formData.college_id} onValueChange={(value) => setFormData({...formData, college_id: value})}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select college" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.isArray(colleges) && colleges.filter(college => college?.id != null).map(college => (
                        <SelectItem key={college.id} value={college.id.toString()}>
                          {college.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {formData.role === 'student' && formData.college_id && loadingDepartments && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-2"></div>
                      Loading departments for {colleges.find(c => c.id === formData.college_id)?.name}...
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Student Specific Fields */}
            {formData.role === 'student' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-primary border-b pb-2">Student Details</h3>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-blue-800">
                    <strong>Note:</strong> Student roll numbers will be automatically stored in CAPS format for consistency.
                  </p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="edit-department" className="text-sm font-medium">Department *</Label>
                    <Select value={formData.department} onValueChange={(value) => setFormData({...formData, department: value})}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {loadingDepartments ? (
                          <SelectItem value="loading" disabled>Loading departments...</SelectItem>
                        ) : departments.length === 0 ? (
                          <SelectItem value="no-departments" disabled>No departments found for this college</SelectItem>
                        ) : (
                          departments.map(dept => (
                            <SelectItem key={dept.id} value={dept.name}>
                              {dept.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-joining_year" className="text-sm font-medium">Joining Year</Label>
                    <Select value={formData.joining_year} onValueChange={(value) => {
                      const joiningYear = parseInt(value);
                      setFormData({
                        ...formData, 
                        joining_year: joiningYear,
                        final_year: joiningYear + 4 // Automatically set final year
                      });
                    }}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select joining year" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, i) => {
                          const year = new Date().getFullYear() - 5 + i;
                          return (
                            <SelectItem key={year} value={year.toString()}>
                              {year} - {year + 1}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-final_year" className="text-sm font-medium">Final Year</Label>
                    <Select value={formData.final_year} onValueChange={(value) => setFormData({...formData, final_year: parseInt(value)})}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select final year" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 8 }, (_, i) => {
                          const year = formData.joining_year || new Date().getFullYear() + i;
                          return (
                            <SelectItem key={year} value={year.toString()}>
                              {year} - {year + 1}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-admission_type" className="text-sm font-medium">Admission Type</Label>
                    <Select 
                      value={formData.admission_type || 'regular'} 
                      onValueChange={(value) => {
                        setFormData({
                          ...formData, 
                          admission_type: value,
                          // For lateral students, adjust years accordingly
                          joining_year: value === 'lateral' ? formData.joining_year + 1 : formData.joining_year,
                          final_year: value === 'lateral' ? formData.final_year + 1 : formData.final_year
                        });
                      }}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select admission type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="regular">Regular</SelectItem>
                        <SelectItem value="lateral">Lateral</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Lateral students get +1 year added to their joining year for academic calculations
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-student_id" className="text-sm font-medium">Student ID (Roll Number)</Label>
                    <Input
                      id="edit-student_id"
                      value={formData.student_id}
                      onChange={(e) => {
                        const value = e.target.value.toUpperCase();
                        setFormData({...formData, student_id: value});
                      }}
                      onBlur={(e) => {
                        const value = e.target.value.toUpperCase();
                        setFormData({...formData, student_id: value});
                      }}
                      placeholder="Enter student ID"
                      className="h-10"
                      maxLength={50}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Student roll number will be stored in CAPS.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-batch" className="text-sm font-medium">Batch</Label>
                    <Select 
                      value={formData.batch || 'no-batch'} 
                      onValueChange={(value) => setFormData({...formData, batch: value === 'no-batch' ? '' : value})}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select batch" />
                      </SelectTrigger>
                      <SelectContent>
                        {loadingBatches ? (
                          <SelectItem value="loading" disabled>Loading batches...</SelectItem>
                        ) : batches.length === 0 ? (
                          <SelectItem value="no-batches" disabled>No batches found for this college</SelectItem>
                        ) : (
                          <>
                            <SelectItem value="">No batch (optional)</SelectItem>
                            {batches.map(batch => (
                              <SelectItem key={batch.id} value={batch.name}>
                                {batch.name} ({batch.code})
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {loadingBatches ? 'Loading available batches...' : 
                       batches.length === 0 ? 'No batches available for this college' : 
                       'Select from available batches or leave empty'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Additional Information Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary border-b pb-2">Additional Information</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                <div className="space-y-2">
                  <Label htmlFor="edit-phone" className="text-sm font-medium">Phone Number</Label>
                  <Input
                    id="edit-phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    placeholder="Enter phone number"
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-is_active" className="text-sm font-medium">Account Status</Label>
                  <div className="flex items-center space-x-3 pt-2">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="edit-is_active"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                        className="rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <Label htmlFor="edit-is_active" className="text-sm">Active Account</Label>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Active accounts can log in immediately. Inactive accounts are suspended.
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              <Button onClick={handleEditUser} className="flex-1 h-11 text-base font-medium">
                <Save className="h-4 w-4 mr-2" />
                Update User
              </Button>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} className="flex-1 h-11 text-base font-medium">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={isChangePasswordDialogOpen} onOpenChange={setIsChangePasswordDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Change password for {selectedUser?.name} ({selectedUser?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative mt-1">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                >
                  {showNewPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              {newPassword && (
                <div className="mt-3 space-y-1.5 text-sm">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Password Requirements:</p>
                  {(() => {
                    const { validations } = validatePassword(newPassword);
                    return (
                      <div className="space-y-1">
                        <div className={`flex items-center gap-2 ${validations.minLength ? 'text-green-600' : 'text-gray-500'}`}>
                          {validations.minLength ? (
                            <CheckSquare className="h-3.5 w-3.5" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                          <span>At least 8 characters</span>
                        </div>
                        <div className={`flex items-center gap-2 ${validations.hasUpperCase ? 'text-green-600' : 'text-gray-500'}`}>
                          {validations.hasUpperCase ? (
                            <CheckSquare className="h-3.5 w-3.5" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                          <span>One uppercase letter (A-Z)</span>
                        </div>
                        <div className={`flex items-center gap-2 ${validations.hasLowerCase ? 'text-green-600' : 'text-gray-500'}`}>
                          {validations.hasLowerCase ? (
                            <CheckSquare className="h-3.5 w-3.5" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                          <span>One lowercase letter (a-z)</span>
                        </div>
                        <div className={`flex items-center gap-2 ${validations.hasNumber ? 'text-green-600' : 'text-gray-500'}`}>
                          {validations.hasNumber ? (
                            <CheckSquare className="h-3.5 w-3.5" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                          <span>One number (0-9)</span>
                        </div>
                        <div className={`flex items-center gap-2 ${validations.hasSpecialChar ? 'text-green-600' : 'text-gray-500'}`}>
                          {validations.hasSpecialChar ? (
                            <CheckSquare className="h-3.5 w-3.5" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                          <span>One special character (!@#$%^&*(),.?":{}|&lt;&gt;)</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsChangePasswordDialogOpen(false);
                  setNewPassword('');
                  setShowNewPassword(false);
                  setSelectedUser(null);
                }}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleChangePassword}
                disabled={!newPassword || !validatePassword(newPassword).isValid}
              >
                <Save className="h-4 w-4 mr-2" />
                Change Password
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Technical Skills Dialog */}
      <Dialog open={skillsDialogOpen} onOpenChange={setSkillsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-5 w-5 text-primary" />
              Technical Skills
            </DialogTitle>
            <DialogDescription>
              List of technical skills for this faculty member
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedUserSkills && formatTechnicalSkills(selectedUserSkills).length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {formatTechnicalSkills(selectedUserSkills).map((skill, index) => (
                    <Badge key={index} variant="outline" className="text-sm py-1 px-3">
                      {skill}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Total: {formatTechnicalSkills(selectedUserSkills).length} skill(s)
                </p>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No technical skills specified</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Password Success Dialog - Shows plain text password for super admin */}
      <AlertDialog open={isPasswordSuccessDialogOpen} onOpenChange={setIsPasswordSuccessDialogOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-green-600" />
              Password Changed Successfully
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>The password has been changed and stored securely in the database (hashed).</p>
              <div className="space-y-2">
                <Label className="text-sm font-medium">New Password (Plain Text):</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 bg-muted rounded-md font-mono text-sm border">
                    {changedPassword}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      copyToClipboard(changedPassword || '');
                    }}
                    className="shrink-0"
                  >
                    <Copy className="h-4 w-4 mr-1" />
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  ⚠️ This is the only time the password will be shown in plain text. Please copy it now if needed.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setIsPasswordSuccessDialogOpen(false);
                setChangedPassword(null);
              }}
            >
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Batch Mapping Dialog */}
      <Dialog open={isBatchMappingOpen} onOpenChange={setIsBatchMappingOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Batch Mapping</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Map multiple students to a specific batch using Excel files or comma-separated roll numbers
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* College and Batch Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary border-b pb-2">Select Target</h3>
              
              {/* Current Batch Info */}
              {batchMappingCollege && batchMappingBatch && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span className="text-sm font-medium text-blue-800">Current Batch Information</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm text-blue-700">
                    <div>
                      <span className="font-medium">College:</span> {colleges.find(c => c.id === batchMappingCollege)?.name}
                    </div>
                    <div>
                      <span className="font-medium">Batch:</span> {batchMappingBatch}
                    </div>
                    <div>
                      <span className="font-medium">Current Students:</span> {users.filter(u => u.role === 'student' && u.college_id === batchMappingCollege && u.batch === batchMappingBatch).length}
                    </div>
                    <div>
                      <span className="font-medium">Total Students in College:</span> {users.filter(u => u.role === 'student' && u.college_id === batchMappingCollege).length}
                    </div>
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="batch-mapping-college" className="text-sm font-medium">College *</Label>
                  <Select 
                    value={batchMappingCollege} 
                                          onValueChange={(value) => {
                        setBatchMappingCollege(value);
                        setBatchMappingBatch('');
                        if (value) {
                          fetchBatches(value);
                        } else {
                          setBatches([]);
                        }
                      }}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select college" />
                    </SelectTrigger>
                    <SelectContent>
                      {colleges.filter(college => college?.id != null).map(college => (
                        <SelectItem key={college.id} value={college.id.toString()}>
                          {college.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="batch-mapping-batch" className="text-sm font-medium">Batch *</Label>
                  <Select 
                    value={batchMappingBatch} 
                    onValueChange={(value) => setBatchMappingBatch(value)}
                    disabled={!batchMappingCollege}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder={!batchMappingCollege ? 'Select college first' : 'Select batch'} />
                    </SelectTrigger>
                    <SelectContent>
                      {loadingBatches ? (
                        <SelectItem value="loading" disabled>Loading batches...</SelectItem>
                      ) : batches.length === 0 ? (
                        <SelectItem value="no-batches" disabled>No batches found for this college</SelectItem>
                      ) : (
                        batches.map(batch => (
                          <SelectItem key={batch.id} value={batch.name}>
                            {batch.name} ({batch.code})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Student Input Methods */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary border-b pb-2">Student Roll Numbers</h3>
              
              {/* Excel File Upload */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Method 1: Upload Excel File</Label>
                <div className="group relative">
                  <input
                    id="batch-mapping-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      setBatchMappingFile(file);
                      setBatchMappingStudents(''); // Clear text input
                    }}
                    className="hidden"
                  />
                  <Label 
                    htmlFor="batch-mapping-file" 
                    className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg transition-all duration-200 group-hover:scale-[1.02] group-hover:shadow-sm border-muted-foreground/30 bg-muted/20 hover:bg-muted/30 hover:border-muted-foreground/50 cursor-pointer"
                  >
                    {!batchMappingFile ? (
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center bg-primary/10 group-hover:bg-primary/20">
                          <Upload className="w-4 w-4 text-primary" />
                        </div>
                        <div className="text-center">
                          <p className="font-medium">Upload Excel File</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Click or drag & drop (should contain roll numbers in first column)
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                          <Table className="w-5 w-5 text-green-600" />
                        </div>
                        <div>
                          <p className="font-medium text-sm text-foreground">
                            {batchMappingFile.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {batchMappingFile.size ? `${(batchMappingFile.size / 1024).toFixed(1)} KB` : '0 KB'}
                          </p>
                        </div>
                      </div>
                    )}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Excel file should have roll numbers in the first column. First row will be treated as header.
                </p>
              </div>

              {/* Text Input */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Method 2: Comma-Separated Values</Label>
                <Textarea
                  value={batchMappingStudents}
                  onChange={(e) => {
                    setBatchMappingStudents(e.target.value);
                    setBatchMappingFile(null); // Clear file input
                    setBatches([]);
                  }}
                  placeholder="Enter roll numbers separated by commas (e.g., STU001, STU002, STU003)"
                  rows={4}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Enter roll numbers separated by commas. Roll numbers will be automatically converted to uppercase.
                </p>
              </div>

              {/* Template Download */}
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    // Generate Excel template for batch mapping
                    const workbook = new ExcelJS.Workbook();
                    const worksheet = workbook.addWorksheet('Roll Numbers');
                    
                    // Add header
                    worksheet.addRow(['Roll Number']);
                    
                    // Add sample data
                    worksheet.addRow(['STU001']);
                    worksheet.addRow(['STU002']);
                    worksheet.addRow(['STU003']);
                    
                    // Style header
                    const headerRow = worksheet.getRow(1);
                    headerRow.eachCell((cell) => {
                      cell.font = { bold: true };
                      cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE0E0E0' }
                      };
                    });
                    
                    // Generate and download
                    workbook.xlsx.writeBuffer().then(buffer => {
                      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                      const url = window.URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.setAttribute('download', 'batch_mapping_template.xlsx');
                      document.body.appendChild(link);
                      link.click();
                      link.remove();
                      window.URL.revokeObjectURL(url);
                      
                      toast({
                        title: "Template Downloaded",
                        description: "Excel template for batch mapping downloaded successfully"
                      });
                    });
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Template
                </Button>
                <p className="text-xs text-muted-foreground">
                  Download Excel template with proper format for roll numbers
                </p>
              </div>
            </div>

            {/* Current Students in Batch */}
            {batchMappingCollege && batchMappingBatch && (
              <div className="space-y-4 pt-4 border-t">
                <h4 className="text-lg font-semibold text-primary">Current Students in {batchMappingBatch}</h4>
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium text-xs">Roll Number</th>
                          <th className="text-left p-2 font-medium text-xs">Student Name</th>
                          <th className="text-left p-2 font-medium text-xs">Department</th>
                          <th className="text-left p-2 font-medium text-xs">Joining Year</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users
                          .filter(u => u.role === 'student' && u.college_id === batchMappingCollege && u.batch === batchMappingBatch)
                          .map((student, index) => (
                            <tr key={student.id} className="border-t hover:bg-muted/30">
                              <td className="p-2 text-xs font-medium">{student.student_id}</td>
                              <td className="p-2 text-xs">{student.name}</td>
                              <td className="p-2 text-xs">{student.department}</td>
                              <td className="p-2 text-xs">{student.joining_year}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {users.filter(u => u.role === 'student' && u.college_id === batchMappingCollege && u.batch === batchMappingBatch).length === 0 && (
                  <div className="text-center py-4 text-muted-foreground">
                    No students currently assigned to this batch
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              <Button 
                onClick={handleBatchMapping} 
                disabled={!batchMappingCollege || !batchMappingBatch || (!batchMappingFile && !batchMappingStudents.trim()) || batchMappingLoading}
                className="flex-1 h-11 text-base font-medium"
              >
                {batchMappingLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                  ) : (
                  <>
                    <Users className="h-4 w-4 mr-2" />
                    Map Students to Batch
                  </>
                )}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setIsBatchMappingOpen(false)} 
                className="flex-1 h-11 text-base font-medium"
              >
                Cancel
              </Button>
            </div>

            {/* Results Display */}
            {showBatchMappingResults && (
              <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-primary">Mapping Results</h4>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={resetBatchMapping}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Start New Mapping
                  </Button>
                </div>
                
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium text-xs">Roll Number</th>
                          <th className="text-left p-2 font-medium text-xs">Student Name</th>
                          <th className="text-left p-2 font-medium text-xs">Status</th>
                          <th className="text-left p-2 font-medium text-xs">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchMappingResults.map((result, index) => (
                          <tr key={index} className={`border-t ${result.success ? 'bg-green-50 hover:bg-green-100' : 'bg-red-50 hover:bg-red-100'}`}>
                            <td className="p-2 text-xs font-medium">{result.rollNumber}</td>
                            <td className="p-2 text-xs">{result.student || 'N/A'}</td>
                            <td className="p-2 text-xs">
                              {result.success ? (
                                <div className="flex items-center gap-1 text-green-700">
                                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                  <span className="font-medium">Success</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-red-700">
                                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                  <span className="font-medium">Failed</span>
                                </div>
                              )}
                            </td>
                            <td className="p-2 text-xs">
                              {result.success ? result.message : result.error}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                
                {/* Results Summary */}
                <div className="p-4 border rounded-lg bg-muted/20">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span className="text-green-700">
                        Success: {batchMappingResults.filter(r => r.success).length}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      <span className="text-red-700">
                        Failed: {batchMappingResults.filter(r => !r.success).length}
                      </span>
                    </div>
                  </div>
                  
                  {batchMappingResults.some(r => !r.success) && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm">
                      <h5 className="font-medium text-red-800 mb-2">Failed Mappings:</h5>
                      <ul className="space-y-1 text-red-700">
                        {batchMappingResults
                          .filter(r => !r.success)
                          .map((result, index) => (
                            <li key={index} className="flex items-center gap-2">
                              <span className="font-medium">{result.rollNumber}</span>
                              <span className="text-red-600">- {result.error}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Multi-Delete Confirmation Dialog */}
      <AlertDialog open={isMultiDeleteDialogOpen} onOpenChange={setIsMultiDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Multiple Users</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedUsers.size} selected users? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete}
              disabled={bulkDeleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleteLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                `Delete ${selectedUsers.size} Users`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Upload Dialog */}
      <Dialog open={isBulkUploadOpen} onOpenChange={setIsBulkUploadOpen}>
        <DialogContent className="max-w-7xl w-[95vw] max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              {bulkUploadRole === 'super-admin' ? 'Bulk Upload Super Admins' : 'Bulk Upload Students'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {bulkUploadRole === 'super-admin' 
                ? 'Upload multiple super admin users using Excel files. Download the template first, fill it with admin data, then upload.'
                : 'Upload multiple students using Excel files. Download the template first, fill it with student data, then upload.'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Role Selection */}
            <div className="space-y-4 p-4 border rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-5 w-5 text-green-600" />
                <Label className="text-sm font-medium text-green-800">Select Upload Type</Label>
              </div>
              <div className="text-sm text-green-700 mb-4">
                <p>Choose the type of users you want to upload.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bulk-role" className="text-sm font-medium text-green-700">User Type *</Label>
                  <Select 
                    value={bulkUploadRole} 
                    onValueChange={(value) => {
                      setBulkUploadRole(value);
                      setBulkUploadCollege('');
                      setBulkUploadDepartment('');
                      setBulkUploadBatch('no-batch');
                      setParsedUsers([]);
                      setShowParsedData(false);
                      setUploadFile(null);
                    }}
                  >
                    <SelectTrigger className="border-green-200 focus:border-green-400">
                      <SelectValue placeholder="Select user type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="super-admin">Super Admin</SelectItem>
                      <SelectItem value="student">Student</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Upload Information */}
            <div className="space-y-4 p-4 border rounded-lg bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-5 w-5 text-purple-600" />
                <Label className="text-sm font-medium text-purple-800">
                  {bulkUploadRole === 'super-admin' ? 'Super Admin Data Upload' : 'Student Data Upload'}
                </Label>
              </div>
              <div className="text-sm text-purple-700">
                <p>
                  {bulkUploadRole === 'super-admin' 
                    ? 'This feature allows you to bulk upload multiple super admin users at once.'
                    : 'This feature allows you to bulk upload multiple students at once.'
                  }
                </p>
                <p className="mt-1">
                  {bulkUploadRole === 'super-admin'
                    ? 'The system will create super admin accounts with the provided information.'
                    : 'The system will create student accounts with the provided information.'
                  }
                </p>
              </div>
            </div>
            
            {/* Institution Selection */}
            {bulkUploadRole === 'student' && (
              <div className="space-y-4 p-4 border rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Building className="h-5 w-5 text-blue-600" />
                  <Label className="text-sm font-medium text-blue-800">Select Institution for Student Assignment</Label>
                </div>
                <div className="text-sm text-blue-700 mb-4">
                  <p>Select the institution details where the students will be assigned.</p>
                </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bulk-college" className="text-sm font-medium text-blue-700">College *</Label>
                  <Select 
                    value={bulkUploadCollege} 
                    onValueChange={(value) => {
                      setBulkUploadCollege(value);
                      setBulkUploadDepartment('');
                      setParsedUsers([]);
                      setShowParsedData(false);
                      if (value !== 'all') {
                        fetchDepartments(value);
                      }
                    }}
                  >
                    <SelectTrigger className="border-blue-200 focus:border-blue-400">
                      <SelectValue placeholder="Select college" />
                    </SelectTrigger>
                    <SelectContent>
                      {colleges.filter(college => college?.id != null).map(college => (
                        <SelectItem key={college.id} value={college.id.toString()}>
                          {college.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bulk-department" className="text-sm font-medium text-blue-700">Department *</Label>
                  <Select 
                    value={bulkUploadDepartment} 
                    onValueChange={(value) => {
                      setBulkUploadDepartment(value);
                      setBulkUploadBatch('no-batch');
                      setParsedUsers([]);
                      setShowParsedData(false);
                    }}
                    disabled={!bulkUploadCollege || bulkUploadCollege === 'all'}
                  >
                    <SelectTrigger className="border-blue-200 focus:border-blue-400">
                      <SelectValue placeholder={!bulkUploadCollege || bulkUploadCollege === 'all' ? 'Select college first' : 'Select department'} />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map(dept => (
                        <SelectItem key={dept.id} value={dept.name}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bulk-batch" className="text-sm font-medium text-blue-700">Batch (Optional)</Label>
                  <Select 
                    value={bulkUploadBatch} 
                    onValueChange={(value) => {
                      setBulkUploadBatch(value === 'no-batch' ? '' : value);
                      setParsedUsers([]);
                      setShowParsedData(false);
                    }}
                                          disabled={bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment)}
                  >
                    <SelectTrigger className="border-blue-200 focus:border-blue-400">
                      <SelectValue placeholder={!bulkUploadCollege || !bulkUploadDepartment ? 'Select college & department first' : 'Select batch (optional)'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-batch">No batch (optional)</SelectItem>
                      {batches.map(batch => (
                        <SelectItem key={batch.id} value={batch.name}>
                          {batch.name} ({batch.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            )}

            {/* Template Download & File Upload */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Bulk Upload Actions</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTemplateHelp(!showTemplateHelp)}
                  className="text-xs"
                >
                  {showTemplateHelp ? 'Hide Help' : 'Show Help'}
                </Button>
              </div>
              
                              {/* Template Help Section */}
                {showTemplateHelp && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
                    <h4 className="font-medium text-blue-800 mb-2">Template Format Help</h4>
                    <div className="space-y-2 text-blue-700">
                      {bulkUploadRole === 'super-admin' ? (
                        <>
                          <p><strong>Required Fields (marked with *):</strong></p>
                          <ul className="list-disc list-inside ml-4 space-y-1">
                            <li><strong>Name *</strong> - Full name of the super admin</li>
                            <li><strong>Email ID *</strong> - Email address (must be unique)</li>
                            <li><strong>Contact</strong> - Phone number (optional)</li>
                            <li><strong>Password</strong> - Login password (optional, will be auto-generated if empty)</li>
                          </ul>
                          <p><strong>Important Notes:</strong></p>
                          <ul className="list-disc list-inside ml-4 space-y-1">
                            <li>Email addresses must be unique in the system</li>
                            <li>If password is not provided, a default password will be generated</li>
                            <li>All super admins will have full system access</li>
                          </ul>
                          <p className="text-xs mt-2"><strong>Column Order:</strong> Name, Email ID, Contact, Password</p>
                        </>
                      ) : (
                        <>
                          <p><strong>Required Fields (marked with *):</strong></p>
                          <ul className="list-disc list-inside ml-4 space-y-1">
                            <li><strong>Name *</strong> - Full name of the student</li>
                            <li><strong>Email ID *</strong> - Email address (must be unique)</li>
                            <li><strong>Phone Number</strong> - Contact number (optional)</li>
                            <li><strong>Roll Number *</strong> - Student's roll number/ID (must be unique)</li>
                            <li><strong>Admission Type</strong> - Regular or lateral (defaults to regular)</li>
                            <li><strong>Batch</strong> - Student batch (optional)</li>
                            <li><strong>Joining Year *</strong> - Year student joined</li>
                            <li><strong>Ending Year *</strong> - Expected graduation year</li>
                          </ul>
                          <p><strong>Important Notes:</strong></p>
                          <ul className="list-disc list-inside ml-4 space-y-1">
                            <li>Email addresses and roll numbers must be unique in the system</li>
                            <li>Students will be assigned to the selected college and department</li>
                            <li>If batch is not specified, it will use the selected batch or be empty</li>
                            <li>Ending year must be greater than joining year</li>
                          </ul>
                          <p className="text-xs mt-2"><strong>Column Order:</strong> Name, Email ID, Phone Number, Roll Number, Admission Type, Batch, Joining Year, Ending Year</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              
              {/* Single Line Actions */}
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {/* Download Template */}
                <div className="flex-1 min-w-0">
                  <Button 
                    variant="outline" 
                    onClick={() => handleDownloadTemplate()}
                    disabled={bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment)}
                    className="w-full h-24 flex flex-col items-center justify-center gap-2 p-3"
                  >
                    <Download className="h-6 w-6 text-primary" />
                    <div className="text-center">
                      <p className="font-medium">Download Template</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {bulkUploadRole === 'super-admin' ? 'Super admin data format' : 'Student data format'} with required fields marked with *
                      </p>
                      <div className="text-xs text-muted-foreground mt-2 text-left">
                        {bulkUploadRole === 'super-admin' ? (
                          <>
                            <p><strong>Required:</strong> Name, Email ID</p>
                            <p><strong>Optional:</strong> Contact, Password</p>
                          </>
                        ) : (
                          <>
                            <p><strong>Required:</strong> Name, Email ID, Roll Number, Joining Year, Ending Year</p>
                            <p><strong>Optional:</strong> Phone Number, Admission Type, Batch</p>
                          </>
                        )}
                      </div>
                    </div>
                  </Button>
                  {bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment) && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Please select college and department first
                    </p>
                  )}
                </div>
                
                {/* Upload File */}
                <div className="flex-1 min-w-0">
                  <div className="group relative">
                    <input
                      id="file-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => {
                        const file = e.target.files[0];
                        setUploadFile(file);
                        setParsedUsers([]);
                        setShowParsedData(false);
                      }}
                      disabled={bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment)}
                      className="hidden"
                    />
                    <Label 
                      htmlFor="file-upload" 
                      className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg transition-all duration-200 group-hover:scale-[1.02] group-hover:shadow-sm ${
                        bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment)
                          ? 'border-muted-foreground/20 bg-muted/10 cursor-not-allowed opacity-50'
                          : 'border-muted-foreground/30 bg-muted/20 hover:bg-muted/30 hover:border-muted-foreground/50 cursor-pointer'
                      }`}
                    >
                      {!uploadFile ? (
                        <div className="flex flex-col items-center justify-center gap-3">
                          <div className="relative">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                              bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment)
                                ? 'bg-muted-foreground/20'
                                : 'bg-primary/10 group-hover:bg-primary/20'
                            }`}>
                              <Upload className={`w-4 h-4 ${
                                bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment)
                                  ? 'text-muted-foreground'
                                  : 'text-primary'
                              }`} />
                            </div>
                            {bulkUploadRole === 'student' && bulkUploadCollege && bulkUploadDepartment ? (
                              <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                                <span className="text-xs text-primary-foreground font-medium">+</span>
                              </div>
                            ) : null}
                          </div>
                          <div className="text-center">
                            <p className="font-medium">Upload File</p>
                            {bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment) ? (
                              <p className="text-xs text-muted-foreground mt-1">
                                Select college and department first
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground mt-1">
                                Click or drag & drop
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-2 text-center">
                          <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                            <Table className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <p className="font-medium text-sm text-foreground">
                              {uploadFile ? uploadFile.name : 'No file'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {uploadFile ? `${(uploadFile.size / 1024).toFixed(1)} KB` : '0 KB'}
                            </p>
                          </div>
                        </div>
                      )}
                    </Label>
                  </div>
                </div>
                
                {/* Parse File */}
                <div className="flex-1 min-w-0">
                  <Button 
                    onClick={handleBulkUpload} 
                    disabled={!uploadFile || uploadLoading || (bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment))}
                    className={`w-full h-24 flex flex-col items-center justify-center gap-2 p-3 transition-colors ${
                      !uploadFile || uploadLoading || (bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment))
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'bg-primary hover:bg-primary/90'
                    }`}
                  >
                    {uploadLoading ? (
                      <>
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <p className="font-medium">Parsing...</p>
                      </>
                    ) : (
                      <>
                        <Upload className="h-6 w-6" />
                        <div className="text-center">
                          <p className="font-medium">Parse File</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {!uploadFile ? 'Select file first' : 
                             (bulkUploadRole === 'student' && (!bulkUploadCollege || !bulkUploadDepartment)) ? 
                             'Select college & department first' : 'Ready to parse'}
                          </p>
                        </div>
                      </>
                    )}
                  </Button>
                </div>
              </div>
              
              {/* Template Format & Parsed Data */}
              <div className="mt-6 p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center justify-between mb-4">
                  <Label className="text-sm font-medium">
                    {showParsedData ? 'Template Format & Parsed Data' : ''}
                  </Label>
                  {showParsedData && (
                    <div className="flex gap-2">
                      <Button 
                        variant="outline"
                        size="sm"
                        onClick={handleResetAndUpload}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reset
                      </Button>
                                              <Button 
                          onClick={handleCreateUsers}
                          disabled={uploadLoading}
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                        >
                          {uploadLoading ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Users className="h-4 w-4 mr-2" />
                              Create Users ({parsedUsers.length})
                            </>
                          )}
                        </Button>
                    </div>
                  )}
                </div>
                
                {!showParsedData ? (
                  // Template Format Only
                  <>
                    {bulkUploadRole === 'super-admin' ? (
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-muted-foreground mb-2">
                          Template Format: <span className="font-normal">Super Admin template contains the following columns:</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div className="font-medium bg-primary/10 p-2 rounded">Name</div>
                          <div className="font-medium bg-primary/10 p-2 rounded">Email ID</div>
                          <div className="font-medium bg-primary/10 p-2 rounded">Contact</div>
                          <div className="font-medium bg-primary/10 p-2 rounded">Password</div>
                        </div>
                      </div>
                    ) : bulkUploadRole === 'student' ? (
                      <div className="space-y-4">
                        <div className="text-sm font-medium text-muted-foreground mb-2">
                          Template Format: <span className="font-normal">Student template contains the following columns:</span>
                        </div>
                        
                        {/* Enhanced Template Grid */}
                        <div className="grid grid-cols-4 gap-3 text-xs">
                          <div className="space-y-2">
                            <div className="font-semibold text-primary border-b pb-1">Basic Information</div>
                            <div className="space-y-1">
                              <div className="font-medium bg-blue-50 border border-blue-200 p-2 rounded text-blue-800">Name *</div>
                              <div className="font-medium bg-blue-50 border border-blue-200 p-2 rounded text-blue-800">Email ID *</div>
                              <div className="font-medium bg-blue-50 border border-blue-200 p-2 rounded text-blue-800">Phone Number</div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="font-semibold text-primary border-b pb-1">Student Details</div>
                            <div className="space-y-1">
                              <div className="font-medium bg-purple-50 border border-purple-200 p-2 rounded text-purple-800">Roll Number *</div>
                              <div className="font-medium bg-purple-50 border border-purple-200 p-2 rounded text-purple-800">Admission Type</div>
                              <div className="font-medium bg-purple-50 border border-purple-200 p-2 rounded text-purple-800">Batch (or leave empty to use selected batch)</div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="font-semibold text-primary border-b pb-1">Academic Years</div>
                            <div className="space-y-1">
                              <div className="font-medium bg-green-50 border border-green-200 p-2 rounded text-green-800">Joining Year</div>
                              <div className="font-medium bg-green-50 border border-green-200 p-2 rounded text-green-800">Ending Year</div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="font-semibold text-primary border-b pb-1">Auto-Filled</div>
                            <div className="space-y-1">
                              <div className="font-medium bg-gray-50 border border-gray-200 p-2 rounded text-gray-600">College</div>
                              <div className="font-medium bg-gray-50 border border-gray-200 p-2 rounded text-gray-600">Department</div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Enhanced Information Boxes */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              <span className="text-sm font-medium text-blue-800">Admission Type Guide</span>
                            </div>
                            <div className="text-xs text-blue-700 space-y-1">
                              <div><strong>Regular:</strong> Standard 4-year program entry</div>
                              <div><strong>Lateral:</strong> Advanced entry (typically 2nd year) - System adds +1 year automatically</div>
                            </div>
                          </div>
                          
                          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              <span className="text-sm font-medium text-green-800">Important Notes</span>
                            </div>
                            <div className="text-xs text-green-700 space-y-1">
                              <div>• Roll numbers stored in CAPS automatically</div>
                              <div>• College & Department auto-filled from selection</div>
                              <div>• Batch can be selected from form or left empty in Excel</div>
                              <div>• Years calculated automatically for lateral students</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">Please select a role type to see the template format.</div>
                    )}
                  </>
                ) : (
                  // Template Format + Parsed Data
                  <div className="space-y-4">
                                          {/* Parsed Data Table */}
                      <div className="border rounded overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-left p-2 font-medium text-xs">Name</th>
                                <th className="text-left p-2 font-medium text-xs">Email</th>
                                <th className="text-left p-2 font-medium text-xs">Roll Number</th>
                                <th className="text-left p-2 font-medium text-xs">Phone</th>
                                <th className="text-left p-2 font-medium text-xs">Batch</th>
                                <th className="text-left p-2 font-medium text-xs">Admission Type</th>
                                <th className="text-left p-2 font-medium text-xs">Joining Year</th>
                                <th className="text-left p-2 font-medium text-xs">Ending Year</th>
                                {showResults && <th className="text-left p-2 font-medium text-xs">Status</th>}
                              </tr>
                            </thead>
                                                      <tbody>
                              {parsedUsers.map((user, index) => {
                                const result = showResults ? userCreationResults[index] : null;
                                const rowClass = result ? 
                                  (result.success ? 'border-t bg-green-50 hover:bg-green-100' : 'border-t bg-red-50 hover:bg-red-100') : 
                                  'border-t hover:bg-muted/30';
                                
                                return (
                                  <tr key={index} className={rowClass}>
                                    <td className="p-2 text-xs font-medium">{user.name || ''}</td>
                                    <td className="p-2 text-xs">{user.email || ''}</td>
                                    <td className="p-2 text-xs font-medium">{user.student_id || ''}</td>
                                    <td className="p-2 text-xs">{user.phone || '-'}</td>
                                    <td className="p-2 text-xs">
                                      {user.batch ? (
                                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                          {user.batch}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </td>
                                    <td className="p-2 text-xs">
                                      {user.admission_type ? (
                                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                          {user.admission_type}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">-</span>
                                      )}
                                    </td>
                                    <td className="p-2 text-xs">{user.joining_year || ''}</td>
                                    <td className="p-2 text-xs">{user.final_year || ''}</td>
                                    {showResults && (
                                      <td className="p-2 text-xs">
                                        {result ? (
                                          result.success ? (
                                            <div className="flex items-center gap-1 text-green-700">
                                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                              <span className="font-medium">Success</span>
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-1 text-red-700">
                                              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                              <span className="font-medium">Failed</span>
                                              <span className="text-xs text-red-600 ml-1">({result.error})</span>
                                            </div>
                                          )
                                        ) : null}
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                        </table>
                      </div>
                    </div>
                    
                    {/* Results Summary */}
                    {showResults && (
                                              <div className="mt-4 p-4 border rounded-lg bg-muted/20">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-medium text-muted-foreground">User Creation Results</h4>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={handleResetAndUpload}
                            >
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Start New Upload
                            </Button>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                              <span className="text-green-700">
                                Success: {userCreationResults.filter(r => r.success).length}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                              <span className="text-red-700">
                                Failed: {userCreationResults.filter(r => !r.success).length}
                              </span>
                            </div>
                          </div>
                          
                          {userCreationResults.some(r => !r.success) && (
                            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm">
                              <h5 className="font-medium text-red-800 mb-2">Failed Creations:</h5>
                              <ul className="space-y-1 text-red-700">
                                {userCreationResults
                                  .filter(r => !r.success)
                                  .map((result, index) => (
                                    <li key={index} className="flex items-center gap-2">
                                      <span className="font-medium">{result.user.name || result.user.student_id || 'Unknown'}</span>
                                      <span className="text-red-600">- {result.error}</span>
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          )}
                        </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagementPage; 
